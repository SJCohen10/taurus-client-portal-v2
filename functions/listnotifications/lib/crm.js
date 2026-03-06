"use strict";

const { URL } = require("url");
const fetch = global.fetch || require("node-fetch");

const EARLY_REFRESH_MS = 60 * 1000;

let cachedToken = null;
let cachedTokenExpiry = 0;
let inflightRefreshPromise = null;

async function refreshCrmAccessToken() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing CRM OAuth env vars");
  }

  const accountsBase = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch(`${accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const raw = await res.text();
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }

  if (!res.ok || !parsed.access_token) {
    const err = new Error("Unable to obtain CRM access token");
    err.details = { statusCode: res.status, responsePreview: String(raw || "").slice(0, 300) };
    throw err;
  }

  return {
    accessToken: parsed.access_token,
    expiresInSeconds: Number(parsed.expires_in || parsed.expires_in_sec || 3600),
    apiDomain: process.env.ZOHO_API_DOMAIN || parsed.api_domain || "https://www.zohoapis.com",
  };
}

async function getCrmAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - EARLY_REFRESH_MS) {
    return cachedToken;
  }

  if (!inflightRefreshPromise) {
    inflightRefreshPromise = (async () => {
      const tokenData = await refreshCrmAccessToken();
      cachedToken = tokenData;
      cachedTokenExpiry = Date.now() + tokenData.expiresInSeconds * 1000;
      return cachedToken;
    })().finally(() => {
      inflightRefreshPromise = null;
    });
  }

  return inflightRefreshPromise;
}

async function crmRequest({ method = "GET", path, query = {}, requestId }) {
  const tokenData = await getCrmAccessToken();
  const crmVersion = process.env.ZOHO_CRM_VERSION || "v8";
  const url = new URL(`${tokenData.apiDomain}/crm/${crmVersion}${path}`);

  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${tokenData.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-request-id": String(requestId || ""),
    },
  });

  const raw = await res.text();
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    const err = new Error("CRM request failed");
    err.statusCode = res.status;
    err.details = { path, statusCode: res.status };
    throw err;
  }

  return parsed;
}

module.exports = {
  crmRequest,
};
