"use strict";

const { URL } = require("url");
const fetch = global.fetch || require("node-fetch");

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

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseJsonSafely(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isDevelopmentDiagnosticsEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.CATALYST_STAGE === "Development";
}

function toResponsePreview(raw, maxLength = 300) {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function extractCrmErrorFields(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { code: null, message: null };
  }

  if (parsed.code || parsed.message) {
    return {
      code: parsed.code || null,
      message: parsed.message || null,
    };
  }

  if (Array.isArray(parsed.data) && parsed.data.length) {
    const first = parsed.data[0] || {};
    return {
      code: first.code || null,
      message: first.message || null,
    };
  }

  return { code: null, message: null };
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

async function refreshOAuthAccessToken({ clientId, clientSecret, refreshToken, accountsBase, requestId }) {
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Missing server-side Zoho OAuth env vars");

  const usedAccountsBase = accountsBase || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  let lastError;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    const res = await fetchWithRetry(`${usedAccountsBase}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const raw = await res.text();
    const parsed = parseJsonSafely(raw);
    const oauthError = parsed && typeof parsed === "object" ? parsed.error : undefined;
    const oauthErrorDescription = parsed && typeof parsed === "object" ? parsed.error_description : undefined;

    if (res.ok && parsed && parsed.access_token) {
      return { ...parsed, accountsBase: usedAccountsBase };
    }

    const errorDetails = {
      tokenEndpointBaseUrl: usedAccountsBase,
      statusCode: res.status,
      error: oauthError || null,
      error_description: oauthErrorDescription || null,
      responsePreview: String(raw || "").slice(0, 300),
    };

    const retryable = isRetryableOAuthThrottle({ error: oauthError, errorDescription: oauthErrorDescription });
    const nonRetryable = isNonRetryableOAuthError({ error: oauthError });
    const hasNextAttempt = attempt < BACKOFF_MS.length - 1;

    if (!retryable || nonRetryable || !hasNextAttempt) {
      console.error("OAuth token refresh failed", {
        requestId,
        accountsBase: usedAccountsBase,
        statusCode: res.status,
        error: oauthError || null,
        error_description: oauthErrorDescription || null,
        responsePreview: String(raw || "").slice(0, 300),
      });
      const err = new Error("Unable to obtain OAuth access token");
      err.details = errorDetails;
      throw err;
    }

    lastError = errorDetails;
    await sleep(BACKOFF_MS[attempt]);
  }

  const err = new Error("Unable to obtain OAuth access token");
  err.details = lastError;
  throw err;
}

async function getOAuthAccessToken({ clientId, clientSecret, refreshToken, accountsBase, requestId } = {}) {
  return refreshOAuthAccessToken({ clientId, clientSecret, refreshToken, accountsBase, requestId });
}

async function getCrmAccessToken({ requestId } = {}) {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - EARLY_REFRESH_MS) {
    return { accessToken: cachedToken, apiDomain: process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com" };
  }

  if (!inflightRefreshPromise) {
    inflightRefreshPromise = (async () => {
      const data = await refreshOAuthAccessToken({
        clientId: process.env.ZOHO_CLIENT_ID,
        clientSecret: process.env.ZOHO_CLIENT_SECRET,
        refreshToken: process.env.ZOHO_REFRESH_TOKEN,
        requestId,
      });

      const expiresInSeconds = Number(data.expires_in || data.expires_in_sec || 3600);
      cachedToken = data.access_token;
      cachedTokenExpiry = Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 3600 * 1000);

      refreshCounter += 1;
      if (shouldLogDevCounters()) {
        console.log("[crmTokenManager] refreshed", {
          refreshCount: refreshCounter,
          expiresInSeconds,
          accountsBase: data.accountsBase,
        });
      }

      return {
        accessToken: cachedToken,
        apiDomain: process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com",
      };
    })().finally(() => {
      inflightRefreshPromise = null;
    });
  } else if (shouldLogDevCounters()) {
    console.log("[crmTokenManager] reusing inflight refresh");
  }

  return inflightRefreshPromise;
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
  const parsed = parseJsonSafely(raw);
  if (!res.ok) {
    const crmError = extractCrmErrorFields(parsed);
    const diagnostics = {
      path,
      statusCode: res.status,
      code: crmError.code,
      message: crmError.message,
      responsePreview: toResponsePreview(raw),
    };
    console.error("CRM request failed", { requestId, ...diagnostics });
    const err = new Error("CRM request failed");
    err.statusCode = res.status;
    if (isDevelopmentDiagnosticsEnabled()) {
      err.details = diagnostics;
    }
    throw err;
  }
  return parsed && typeof parsed === "object" ? parsed : {};
}

module.exports = { crmRequest, getOAuthAccessToken, createRequestId, getCrmAccessToken };
