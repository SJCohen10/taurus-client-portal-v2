"use strict";

const { URL } = require("url");

async function fetchWithRetry(url, options = {}, { retries = 2, timeoutMs = 8000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.status >= 500 && i < retries) continue;
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (i === retries) throw err;
    }
  }
  throw lastErr || new Error("Request failed");
}

async function getOAuthAccessToken({ clientId, clientSecret, refreshToken, accountsBase }) {
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Missing server-side Zoho OAuth env vars");
  const params = new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
  const tokenUrl = `${accountsBase || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com"}/oauth/v2/token`;
  const res = await fetchWithRetry(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!res.ok || !data.access_token) throw new Error("Unable to obtain OAuth access token");
  return data;
}

async function getCrmAccessToken() {
  const data = await getOAuthAccessToken({
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  });
  return { accessToken: data.access_token, apiDomain: process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com" };
}

function getCrmBase(apiDomain) {
  const crmVersion = process.env.ZOHO_CRM_VERSION || "v8";
  return `${apiDomain}/crm/${crmVersion}`;
}

async function crmRequest({ method = "GET", path, query = {}, body }) {
  const { accessToken, apiDomain } = await getCrmAccessToken();
  const url = new URL(`${getCrmBase(apiDomain)}${path}`);
  Object.entries(query || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v)); });

  const res = await fetchWithRetry(url.toString(), {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  const parsed = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    const err = new Error("CRM request failed");
    err.statusCode = res.status;
    throw err;
  }
  return parsed;
}

module.exports = { crmRequest, getOAuthAccessToken };
