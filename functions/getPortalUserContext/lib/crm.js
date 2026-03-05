"use strict";

const { URL } = require("url");
const fetch = require("./fetchClient");

function createRequestId() {
  return `ctx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseJsonSafely(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchWithRetry(url, options = {}, { retries = 1, timeoutMs = 5000 } = {}) {
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

async function getOAuthAccessToken({ clientId, clientSecret, refreshToken, accountsBase, requestId }) {
  if (!clientId || !clientSecret || !refreshToken) {
    const missing = [];
    if (!clientId) missing.push("ZOHO_CLIENT_ID");
    if (!clientSecret) missing.push("ZOHO_CLIENT_SECRET");
    if (!refreshToken) missing.push("ZOHO_REFRESH_TOKEN");
    const err = new Error(`Missing server-side Zoho OAuth env vars: ${missing.join(", ")}`);
    err.details = { missing, accountsUrlUsed: accountsBase || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com" };
    throw err;
  }

  const params = new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
  const usedAccountsBase = accountsBase || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
  const tokenUrl = `${usedAccountsBase}/oauth/v2/token`;
  const res = await fetchWithRetry(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  const raw = await res.text();
  const parsed = parseJsonSafely(raw);
  const oauthError = parsed && typeof parsed === "object" ? parsed.error : undefined;
  const oauthErrorDescription = parsed && typeof parsed === "object" ? parsed.error_description : undefined;

  if (!res.ok || !parsed || !parsed.access_token) {
    console.error("OAuth token refresh failed", {
      requestId,
      tokenEndpointBaseUrl: usedAccountsBase,
      statusCode: res.status,
      error: oauthError || null,
      error_description: oauthErrorDescription || null,
      responsePreview: !oauthError && !oauthErrorDescription ? String(raw || "").slice(0, 300) : undefined,
    });
    const err = new Error("Unable to obtain OAuth access token");
    err.details = {
      tokenEndpointBaseUrl: usedAccountsBase,
      statusCode: res.status,
      error: oauthError || null,
      error_description: oauthErrorDescription || null,
      responsePreview: !oauthError && !oauthErrorDescription ? String(raw || "").slice(0, 300) : undefined,
    };
    throw err;
  }

  return parsed;
}

async function getCrmAccessToken({ requestId } = {}) {
  const data = await getOAuthAccessToken({
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_REFRESH_TOKEN,
    requestId,
  });
  return { accessToken: data.access_token, apiDomain: process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com" };
}

function getCrmBase(apiDomain) {
  const crmVersion = process.env.ZOHO_CRM_VERSION || "v8";
  return `${apiDomain}/crm/${crmVersion}`;
}

async function crmRequest({ method = "GET", path, query = {}, body, requestId }) {
  const { accessToken, apiDomain } = await getCrmAccessToken({ requestId });
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

module.exports = { crmRequest, getOAuthAccessToken, createRequestId };
