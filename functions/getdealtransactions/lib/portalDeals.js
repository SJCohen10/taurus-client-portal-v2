"use strict";

const { URL } = require("url");
const fetch = require("./fetchClient");

function getCallerEmail(req) {
  const headers = req?.headers || {};
  const direct =
    req?.user?.email ||
    headers["x-zc-user-email"] ||
    headers["x-zc-useremail"] ||
    headers["x-catalyst-user-email"] ||
    headers["x-user-email"] ||
    headers["x-forwarded-user-email"] ||
    "";
  return String(direct || "").trim().toLowerCase();
}

async function getAnalyticsAccessToken() {
  const clientId = process.env.ZOHO_ANALYTICS_CLIENT_ID;
  const clientSecret = process.env.ZOHO_ANALYTICS_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_ANALYTICS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Analytics OAuth env vars");
  }

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const accountsBase = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
  const tokenUrl = `${accountsBase}/oauth/v2/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse Analytics token response (${res.status})`);
  }

  if (!res.ok || !data.access_token) {
    throw new Error(`Failed to get Analytics access token (${res.status})`);
  }

  return data.access_token;
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    current += ch;
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1).map((values) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (values[idx] || "").trim();
    });
    return obj;
  });
}

async function getDealsForPortal({ email, accountId }) {
  const accessToken = await getAnalyticsAccessToken();
  const base = process.env.ZOHO_ANALYTICS_BASE || "https://analyticsapi.zoho.com/api";
  const owner = process.env.ZOHO_ANALYTICS_OWNER;
  const db = process.env.ZOHO_ANALYTICS_DB;
  const table = process.env.ZOHO_ANALYTICS_PORTAL_DEALS_TABLE || "Portal_Deals_View";

  if (!owner || !db) throw new Error("Missing Analytics owner/db env vars");

  const criteriaParts = [];
  if (email) criteriaParts.push(`"Contact_Email"='${String(email).replace(/'/g, "\\'")}'`);
  if (accountId) criteriaParts.push(`"Account_Id"='${String(accountId).replace(/'/g, "\\'")}'`);
  const criteria = criteriaParts.length ? criteriaParts.join(" OR ") : "1=0";

  const url = new URL(`${base}/${encodeURIComponent(owner)}/${encodeURIComponent(db)}/${encodeURIComponent(table)}`);
  url.searchParams.set("ZOHO_ACTION", "EXPORT");
  url.searchParams.set("ZOHO_OUTPUT_FORMAT", "CSV");
  url.searchParams.set("ZOHO_ERROR_FORMAT", "JSON");
  url.searchParams.set("ZOHO_API_VERSION", "1.0");
  url.searchParams.set("ZOHO_CRITERIA", criteria);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    throw new Error("Zoho Analytics returned JSON error response");
  }

  const rows = parseCsv(text);
  return rows.map((row) => ({
    deal_id: row["Deal_Id"] || null,
    asset_id: row["Asset Id"] || row["Asset_Id"] || row["Asset ID"] || row["asset_id"] || null,
    asset_ids: row["Asset IDs"] || row["Asset_IDs"] || row["Asset Ids"] || null,
  }));
}

module.exports = {
  getCallerEmail,
  getDealsForPortal,
};
