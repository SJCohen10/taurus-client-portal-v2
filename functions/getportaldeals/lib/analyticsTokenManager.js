"use strict";

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

function parseJsonSafely(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
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

async function refreshAnalyticsAccessToken({ requestId } = {}) {
  const clientId = process.env.ZOHO_ANALYTICS_CLIENT_ID;
  const clientSecret = process.env.ZOHO_ANALYTICS_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_ANALYTICS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Analytics OAuth env vars");
  }

  const accountsBase = process.env.ZOHO_ANALYTICS_ACCOUNTS_URL || process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
  const params = new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });

  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    const res = await fetch(`${accountsBase}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const raw = await res.text();
    const parsed = parseJsonSafely(raw);
    const oauthError = parsed && typeof parsed === "object" ? parsed.error : undefined;
    const oauthErrorDescription = parsed && typeof parsed === "object" ? parsed.error_description : undefined;

    if (res.ok && parsed && parsed.access_token) return parsed;

    const details = {
      requestId,
      accountsBase,
      statusCode: res.status,
      error: oauthError || null,
      error_description: oauthErrorDescription || null,
      responsePreview: String(raw || "").slice(0, 300),
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

    await sleep(BACKOFF_MS[attempt]);
  }

  throw new Error("Failed to get Analytics access token");
}

async function getAccessToken({ requestId } = {}) {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - EARLY_REFRESH_MS) return cachedToken;

  if (!inflightRefreshPromise) {
    inflightRefreshPromise = (async () => {
      const data = await refreshAnalyticsAccessToken({ requestId });
      const expiresInSeconds = Number(data.expires_in || data.expires_in_sec || 3600);
      cachedToken = data.access_token;
      cachedTokenExpiry = Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds * 1000 : 3600 * 1000);
      refreshCounter += 1;
      if (shouldLogDevCounters()) console.log("[analyticsTokenManager:getportaldeals] refreshed", { refreshCounter, expiresInSeconds });
      return cachedToken;
    })().finally(() => {
      inflightRefreshPromise = null;
    });
  } else if (shouldLogDevCounters()) {
    console.log("[analyticsTokenManager:getportaldeals] reusing inflight refresh");
  }

  return inflightRefreshPromise;
}

module.exports = { getAccessToken };
