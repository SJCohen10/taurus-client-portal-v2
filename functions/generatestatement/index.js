"use strict";

const crypto = require("crypto");
const { Buffer } = require("buffer");
const { getOAuthAccessToken } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit, parseQuery } = require("./lib/security");
const { getDealsForPortal, getCallerEmail } = require("./lib/portalDeals");

const DEFAULT_SIGNING_SECRET = "change-me";
const WORKDRIVE_BASE = process.env.ZOHO_WORKDRIVE_BASE || "https://www.zohoapis.com/workdrive/api/v1";
const STATEMENTS_FOLDER_NAME = process.env.PORTAL_STATEMENTS_FOLDER_NAME || "Statements";

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeFolderName(value, fallback = "Folder") {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || fallback;
}

function normalizeFolderCompareName(name) {
  return sanitizeFolderName(String(name || ""), "").toLowerCase().trim();
}

function buildCreatorUrl(pageName, assetId) {
  const configuredBase = String(process.env.ZOHO_CREATOR_STATEMENT_BASE || "").trim();
  const defaultBase = "https://creatorapp.zoho.com/administrator_tauruscapital/loan-management-system/#Page";
  const base = configuredBase.startsWith("https://creatorapp.zoho.com/") ? configuredBase : defaultBase;
  return `${base}:${pageName}?CrmAssetId=${assetId}`;
}

// Statement download pages are public Creator page-perma URLs, one per asset
// type. Defaults below work out of the box; new types can be added (or these
// overridden) via the PORTAL_STATEMENT_URL_MAP JSON env var without a code change.
const STATEMENT_URL_DEFAULTS = {
  seller:
    "https://creatorapp.zohopublic.com/administrator_tauruscapital/loan-management-system/page-perma/Seller_Statements_Download_Only/0aGPQhz07F1EqByZUqW5nup4NxZg6arwJxx4PpVaqNsq8WFnCwD0TFORutCSJAOvR19PSfC3v3UmWSqN0DjdgUuqhqPqV4M7vwgs?isc5page=tru",
  "estate agent":
    "https://creatorapp.zohopublic.com/administrator_tauruscapital/loan-management-system/page-perma/Agent_Statements_Download_Only/DBzG0QSdGUTJNqfDf828VPmx1SRU0t3TkgsQFAtrfFwePE1CCUfP0smR6wGDYVw4vbNEkz1baaNQ3OnFKmm7dGbKAAhFdWt7GufD?isc5page=tru",
};

// Data uses "Estate Agent"; allow "agent" to resolve to the same statement.
const STATEMENT_TYPE_ALIASES = { agent: "estate agent" };

function getStatementUrlMap() {
  const map = { ...STATEMENT_URL_DEFAULTS };
  const raw = String(process.env.PORTAL_STATEMENT_URL_MAP || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed || {})) {
        if (typeof v === "string" && v.trim()) map[String(k).trim().toLowerCase()] = v.trim();
      }
    } catch (e) {
      console.warn("[generatestatement] invalid PORTAL_STATEMENT_URL_MAP JSON; using defaults", { message: e.message });
    }
  }
  return map;
}

function resolveStatementUrl(assetId, statementType) {
  const normalizedType = String(statementType || "").trim().toLowerCase();
  if (!normalizedType) {
    const err = new Error("Missing statement type");
    err.statusCode = 400;
    throw err;
  }
  const map = getStatementUrlMap();
  const key = map[normalizedType] ? normalizedType : STATEMENT_TYPE_ALIASES[normalizedType] || normalizedType;
  const base = map[key];
  if (!base) {
    const err = new Error(`No statement is available for "${statementType}" yet`);
    err.statusCode = 400;
    throw err;
  }
  const url = new URL(base);
  url.searchParams.set("CrmAssetId", String(assetId || "").trim());
  return url.toString();
}

function getSigningSecret() {
  const secret = String(process.env.STATEMENT_SIGNING_SECRET || "").trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    const err = new Error("Missing STATEMENT_SIGNING_SECRET");
    err.statusCode = 500;
    throw err;
  }
  return DEFAULT_SIGNING_SECRET;
}

function verifyToken(token) {
  const [body, sig] = String(token || "").split(".");
  const secret = getSigningSecret();
  const expected = crypto.createHmac("sha256", secret).update(body || "").digest("base64url");
  if (!body || !sig || sig !== expected) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed.exp || Date.now() > Number(parsed.exp)) return null;
  return parsed;
}

function extractAssetIdsFromAllowedRow(row) {
  const ids = new Set();

  const single = String(row.asset_id || "").trim();
  if (single) ids.add(single);

  String(row.asset_ids || "")
    .split(/[,\n;|]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((id) => ids.add(id));

  return [...ids];
}

function buildAuthHeaders(accessToken) {
  const headers = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    Accept: "application/vnd.api+json",
  };

  if (process.env.ZOHO_WORKDRIVE_TEAM_ID) {
    headers["X-ZOHO-WORKDRIVE-TEAM-ID"] = process.env.ZOHO_WORKDRIVE_TEAM_ID;
  }

  return headers;
}

async function getWorkDriveAccessToken({ requestId }) {
  const data = await getOAuthAccessToken({
    clientId: process.env.ZOHO_WORKDRIVE_CLIENT_ID,
    clientSecret: process.env.ZOHO_WORKDRIVE_CLIENT_SECRET,
    refreshToken: process.env.ZOHO_WORKDRIVE_REFRESH_TOKEN,
    requestId,
  });
  return data.access_token;
}

async function searchForChildFolder({ accessToken, parentFolderId, folderName }) {
  const headers = {
    ...buildAuthHeaders(accessToken),
    Accept: "application/vnd.api+json",
  };

  const target = normalizeFolderCompareName(folderName);
  if (!target) return null;

  const limit = 200;
  let offset = 0;

  while (offset < 2000) {
    const url =
      `${WORKDRIVE_BASE}/files/${encodeURIComponent(parentFolderId)}/files` +
      `?page[limit]=${limit}&page[offset]=${offset}`;

    const res = await fetch(url, { method: "GET", headers });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }

    if (!res.ok) return null;

    const items = Array.isArray(data?.data) ? data.data : [];

    for (const item of items) {
      const isFolder =
        item?.attributes?.is_folder === true ||
        String(item?.attributes?.type || "").toLowerCase() === "folder" ||
        String(item?.type || "").toLowerCase().includes("folder");

      if (!isFolder) continue;

      const name = normalizeFolderCompareName(item?.attributes?.name || "");
      if (name === target) return item?.id || null;
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return null;
}

async function ensurePropertyFolder({ accessToken, parentId, folderName }) {
  const headers = {
    ...buildAuthHeaders(accessToken),
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
  };

  const payload = {
    data: {
      type: "files",
      attributes: {
        name: sanitizeFolderName(folderName || "Folder"),
        parent_id: parentId,
      },
    },
  };

  const res = await fetch(`${WORKDRIVE_BASE}/files`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error(`WorkDrive folder response was not JSON (${res.status})`);
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`WorkDrive folder create failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  return data?.data?.id || null;
}

async function ensureFolder({ accessToken, parentFolderId, folderName }) {
  const safeFolderName = sanitizeFolderName(folderName || "Folder");

  const existingId = await searchForChildFolder({
    accessToken,
    parentFolderId,
    folderName: safeFolderName,
  });
  if (existingId) return existingId;

  const createdId = await ensurePropertyFolder({
    accessToken,
    parentId: parentFolderId,
    folderName: safeFolderName,
  });
  if (createdId) return createdId;

  const existingAfterCreate = await searchForChildFolder({
    accessToken,
    parentFolderId,
    folderName: safeFolderName,
  });
  if (existingAfterCreate) return existingAfterCreate;

  throw new Error("WorkDrive folder create failed (unable to resolve existing)");
}

async function uploadFileToFolder({ accessToken, folderId, fileName, mimeType, fileBase64 }) {
  const safeName = fileName || "statement.pdf";
  const encodedName = encodeURIComponent(safeName);

  const fileBuffer = Buffer.from(fileBase64, "base64");
  const blob = new Blob([fileBuffer], {
    type: mimeType || "application/pdf",
  });

  const formData = new FormData();
  formData.append("content", blob, safeName);
  formData.append("parent_id", folderId);
  formData.append("filename", encodedName);
  formData.append("override-name-exist", "false");

  const res = await fetch(`${WORKDRIVE_BASE}/upload`, {
    method: "POST",
    headers: buildAuthHeaders(accessToken),
    body: formData,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error(`WorkDrive upload response parse failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`WorkDrive upload failed (${res.status}): ${data?.message || "upload failed"}`);
    err.status = res.status;
    throw err;
  }

  return data?.data || data;
}

function resolveDealForAsset({ allowedDeals, assetId }) {
  return allowedDeals.find((row) => extractAssetIdsFromAllowedRow(row).includes(assetId)) || null;
}

function buildStatementFileName({ deal, assetId }) {
  const dealRef =
    String(deal?.property_ref_number || deal?.deal_id || assetId || "statement").trim() || "statement";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return sanitizeFolderName(`Statement - ${dealRef} - ${timestamp}.pdf`, "statement.pdf");
}

module.exports = async (req, res) => {
  const requestId = createRequestId();
  try {
    if (handleOptions(req, res)) return;

    if (req.method === "GET") {
      const token = parseQuery(req).get("token");
      const parsed = verifyToken(token);
      if (!parsed) return sendJson(req, res, 401, { error: "That link is no longer valid. Please open the statement again from your deal.", requestId });
      res.writeHead(302, { Location: parsed.url, "Cache-Control": "no-store" });
      return res.end();
    }

    if (req.method !== "POST") return sendJson(req, res, 405, { error: "That request couldn't be completed.", requestId });
    const body = await readJsonBody(req);
    assertAllowedKeys(body, ["email", "assetId", "accountId", "statementType"]);

    const bodyEmail = String(body.email || "").trim().toLowerCase();
    const callerEmail = getCallerEmail(req);
    const requestedEmail = bodyEmail || callerEmail;

    const email = await enforceUserContext(req, requestedEmail, requestId, "generatestatement");

    console.info("[generatestatement] resolved user context", {
      requestId,
      bodyEmail,
      callerEmail,
      resolvedEmail: email,
    });

    if (!email) {
      return sendJson(req, res, 401, { error: "We couldn't verify your account. Please sign in again.", requestId });
    }

    enforceRateLimit({ key: `generatestatement:${email}`, limit: 10, windowMs: 60000 });

    const assetId = String(body.assetId || "").trim();
    if (!/^\d+$/.test(assetId)) return sendJson(req, res, 400, { error: "We couldn't identify this transaction. Please refresh the page. If this continues, contact your Taurus Account Manager.", requestId });

    console.info("[generatestatement] fetching allowed deals", { requestId, email });
    const allowed = await getDealsForPortal({ email, requestId });

    const deal = resolveDealForAsset({ allowedDeals: allowed, assetId });

    console.info("[generatestatement] auth check", {
      requestId,
      email,
      requestedAssetId: assetId,
      allowedCount: allowed.length,
      resolvedDealId: deal?.deal_id || null,
    });

    if (!deal) {
      console.warn("[generatestatement] forbidden asset access", {
        requestId,
        email,
        requestedAssetId: assetId,
        allowedCount: allowed.length,
      });

      return sendJson(req, res, 403, { error: "You don't have access to this statement. Please contact your Taurus Account Manager.", requestId });
    }

    const statementUrl = resolveStatementUrl(assetId, body.statementType);

    console.info("[generatestatement] resolved statement url", {
      requestId,
      assetId,
      statementType: String(body.statementType || "").trim(),
    });

    return sendJson(req, res, 200, {
      ok: true,
      statementUrl,
      statementMode: "download",
      requestId,
    });
  } catch (err) {
    console.error("generatestatement failed", {
      requestId,
      message: err.message,
      statusCode: err.statusCode || 500,
      details: err.details || null,
      stack: err.stack || null,
    });
    return sendJson(req, res, err.statusCode || 500, {
      error: err.statusCode ? err.message : "Internal server error",
      requestId,
    });
  }
};
