"use strict";

const { URL } = require("url");
const fetch = global.fetch || require("node-fetch");
const { resolvePortalUserContextByEmail } = require("./portalUserContext");

const EARLY_REFRESH_MS = 60 * 1000;
const BACKOFF_MS = [500, 1000, 2000, 4000];

let cachedToken = null;
let cachedTokenExpiry = 0;
let inflightRefreshPromise = null;
let refreshCounter = 0;

function shouldLogDevCounters() {
  return process.env.NODE_ENV !== "production" || process.env.CATALYST_STAGE === "Development";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonSafely(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRetryableOAuthThrottle({ error, errorDescription }) {
  const err = String(error || "").toLowerCase();
  const desc = String(errorDescription || "").toLowerCase();
  return err.includes("access denied") || desc.includes("too many requests continuously");
}

function isNonRetryableOAuthError({ error }) {
  const err = String(error || "").toLowerCase();
  return err.includes("invalid_client") || err.includes("invalid_code") || err.includes("invalid_grant");
}

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

async function refreshAnalyticsAccessToken() {
  const clientId = process.env.ZOHO_ANALYTICS_CLIENT_ID;
  const clientSecret = process.env.ZOHO_ANALYTICS_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_ANALYTICS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Analytics OAuth env vars");
  }

  const accountsBase = process.env.ZOHO_ANALYTICS_ACCOUNTS_URL || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  let lastError;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    const res = await fetch(`${accountsBase}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const text = await res.text();
    const data = parseJsonSafely(text);
    const oauthError = data && typeof data === "object" ? data.error : undefined;
    const oauthErrorDescription = data && typeof data === "object" ? data.error_description : undefined;

    if (res.ok && data && data.access_token) {
      return { ...data, accountsBase };
    }

    const details = {
      accountsBase,
      statusCode: res.status,
      error: oauthError || null,
      error_description: oauthErrorDescription || null,
      responsePreview: String(text || "").slice(0, 300),
    };

    const retryable = isRetryableOAuthThrottle({ error: oauthError, errorDescription: oauthErrorDescription });
    const nonRetryable = isNonRetryableOAuthError({ error: oauthError });
    const hasNextAttempt = attempt < BACKOFF_MS.length - 1;

    if (!retryable || nonRetryable || !hasNextAttempt) {
      console.error("Analytics OAuth refresh failed", details);
      const err = new Error(`Failed to get Analytics access token (${res.status})`);
      err.details = details;
      throw err;
    }

    lastError = details;
    await sleep(BACKOFF_MS[attempt]);
  }

  const err = new Error("Failed to get Analytics access token");
  err.details = lastError;
  throw err;
}

async function getAnalyticsAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - EARLY_REFRESH_MS) {
    return cachedToken;
  }

  if (!inflightRefreshPromise) {
    inflightRefreshPromise = (async () => {
      const data = await refreshAnalyticsAccessToken();
      const expiresInSeconds = Number(data.expires_in || data.expires_in_sec || 3600);
      cachedToken = data.access_token;
      cachedTokenExpiry = Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 3600 * 1000);
      refreshCounter += 1;
      if (shouldLogDevCounters()) {
        console.log("[analyticsTokenManager] refreshed", {
          refreshCount: refreshCounter,
          expiresInSeconds,
          accountsBase: data.accountsBase,
        });
      }
      return cachedToken;
    })().finally(() => {
      inflightRefreshPromise = null;
    });
  } else if (shouldLogDevCounters()) {
    console.log("[analyticsTokenManager] reusing inflight refresh");
  }

  return inflightRefreshPromise;
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

function mapPortalDealRow(row) {
  return {
    deal_id: row["Deal_Id"] || null,
    asset_id: row["Asset Id"] || row["Asset_Id"] || row["Asset ID"] || row["asset_id"] || null,
    asset_ids: row["Asset IDs"] || row["Asset_IDs"] || row["Asset Ids"] || null,
  };
}

async function fetchPortalDealsByCriteria({ accessToken, criteria }) {
  const base = process.env.ZOHO_ANALYTICS_BASE || "https://analyticsapi.zoho.com/api";
  const owner = process.env.ZOHO_ANALYTICS_OWNER;
  const db = process.env.ZOHO_ANALYTICS_DB;
  const table = process.env.ZOHO_ANALYTICS_PORTAL_DEALS_TABLE || "Portal_Deals_View";

  if (!owner || !db) throw new Error("Missing Analytics owner/db env vars");

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

  return parseCsv(text);
}

function dedupeDealsById(deals) {
  const unique = [];
  const seen = new Set();

  for (const deal of deals) {
    const key = String(deal?.deal_id || "").trim();
    if (!key) {
      unique.push(deal);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(deal);
  }

  return unique;
}

async function getDealsForPortal({ email, requestId }) {
  const portalUser = await resolvePortalUserContextByEmail({ email, requestId });
  const resolvedAccountId = String(portalUser?.accountId || "").trim();
  const canViewFirmDeals = Boolean(portalUser?.canViewFirmDeals);
  const safeEmail = String(email || "").trim().toLowerCase();

  const accessToken = await getAnalyticsAccessToken();

  const escapedEmail = safeEmail.replace(/'/g, "\\'");
  const myRows = safeEmail
    ? await fetchPortalDealsByCriteria({
      accessToken,
      criteria: `"Contact_Email"='${escapedEmail}'`,
    })
    : [];

  let firmRows = [];
  if (canViewFirmDeals && resolvedAccountId) {
    const escapedAccountId = resolvedAccountId.replace(/'/g, "\\'");
    firmRows = await fetchPortalDealsByCriteria({
      accessToken,
      criteria: `"Account_Id"='${escapedAccountId}'`,
    });
  }

  const normalizedMyDeals = myRows.map(mapPortalDealRow);
  const normalizedFirmDeals = firmRows.map(mapPortalDealRow);
  const dedupedDeals = dedupeDealsById([...normalizedMyDeals, ...normalizedFirmDeals]);

  console.info("[getDealsForPortal] visibility resolved", {
    requestId: requestId || null,
    email: safeEmail,
    resolvedAccountId: resolvedAccountId || null,
    canViewFirmDeals,
    myDealsCount: normalizedMyDeals.length,
    firmDealsCount: normalizedFirmDeals.length,
    dedupedCount: dedupedDeals.length,
    first10DealIds: dedupedDeals.slice(0, 10).map((deal) => String(deal?.deal_id || "").trim()),
  });

  return dedupedDeals;
}

module.exports = {
  getCallerEmail,
  getDealsForPortal,
  getAnalyticsAccessToken,
};
