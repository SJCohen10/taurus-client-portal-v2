"use strict";

const crypto = require("crypto");
const { Buffer } = require("buffer");
const { crmRequest, getOAuthAccessToken } = require("./lib/crm");
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
  if (Date.now() > Number(parsed.exp || 0)) return null;
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
      if (!parsed) return sendJson(req, res, 401, { error: "Invalid token", requestId });
      res.writeHead(302, { Location: parsed.url, "Cache-Control": "no-store" });
      return res.end();
    }

    if (req.method !== "POST") return sendJson(req, res, 405, { error: "Method not allowed", requestId });
    const body = await readJsonBody(req);
    assertAllowedKeys(body, ["email", "assetId", "accountId"]);

    const bodyEmail = String(body.email || "").trim().toLowerCase();
    const callerEmail = getCallerEmail(req);
    const requestedEmail = bodyEmail || callerEmail;

    const email = enforceUserContext(req, requestedEmail);

    console.info("[generatestatement] resolved user context", {
      requestId,
      bodyEmail,
      callerEmail,
      resolvedEmail: email,
    });

    if (!email) {
      return sendJson(req, res, 401, { error: "Unable to resolve portal user email", requestId });
    }

    enforceRateLimit({ key: `generatestatement:${email}`, limit: 10, windowMs: 60000 });

    const assetId = String(body.assetId || "").trim();
    if (!/^\d+$/.test(assetId)) return sendJson(req, res, 400, { error: "Invalid assetId", requestId });

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

      return sendJson(req, res, 403, { error: "Forbidden", requestId });
    }

    const asset = (await crmRequest({ method: "GET", path: `/Assets/${assetId}`, requestId }))?.data?.[0] || {};
    const assetType = String(asset.Asset_Type || "").trim().toLowerCase();
    let statementPage = null;
    if (assetType.includes("seller")) statementPage = "Seller_Statements";
    else if (assetType.includes("agent")) statementPage = "Agent_Statements";
    else if (assetType.includes("agency")) statementPage = "Agency_Statements";
    else if (assetType.includes("bond")) statementPage = "Bond_Statements";
    else if (assetType.includes("rafpay")) statementPage = "RAFPAY_Statements";
    else if (assetType === "aa" || assetType.includes(" aa")) statementPage = "AA_Statements";
    else if (assetType.includes("lwb")) statementPage = "LWB_Statements";
    if (!statementPage) return sendJson(req, res, 404, { error: "No statement template for this asset", requestId });

    const creatorUrl = buildCreatorUrl(statementPage, assetId);

    const statementStorage = {
      attempted: false,
      saved: false,
      dealId: deal?.deal_id || null,
      dealFolderId: deal?.property_folder_id || null,
      statementsFolderId: null,
      fileName: null,
      fileId: null,
      fileUrl: null,
      reason: null,
      message: null,
    };

    const baseDealFolderId = String(deal?.property_folder_id || "").trim();
    if (!baseDealFolderId) {
      statementStorage.attempted = true;
      statementStorage.reason = "missing_deal_folder";
      statementStorage.message = "Statement generated, but this deal has no mapped WorkDrive folder yet.";
      return sendJson(req, res, 200, { ok: true, statementUrl: creatorUrl, statementStorage, requestId });
    }

    if (!process.env.ZOHO_WORKDRIVE_CLIENT_ID || !process.env.ZOHO_WORKDRIVE_CLIENT_SECRET || !process.env.ZOHO_WORKDRIVE_REFRESH_TOKEN) {
      statementStorage.attempted = true;
      statementStorage.reason = "missing_workdrive_oauth";
      statementStorage.message = "Statement generated, but WorkDrive OAuth env vars are missing for statement file storage.";
      return sendJson(req, res, 200, { ok: true, statementUrl: creatorUrl, statementStorage, requestId });
    }

    statementStorage.attempted = true;
    const accessToken = await getWorkDriveAccessToken({ requestId });
    const statementsFolderId = await ensureFolder({
      accessToken,
      parentFolderId: baseDealFolderId,
      folderName: STATEMENTS_FOLDER_NAME,
    });
    statementStorage.statementsFolderId = statementsFolderId;

    // TODO: Wire binary PDF retrieval here if/when CRM/Creator statement generation provides file content.
    const statementFileBase64 = null;

    if (!statementFileBase64) {
      statementStorage.reason = "no_statement_binary_available";
      statementStorage.message = "Statements folder resolved, but the current statement function only returns a Creator URL and does not provide PDF file content to save.";
      return sendJson(req, res, 200, { ok: true, statementUrl: creatorUrl, statementStorage, requestId });
    }

    const fileName = buildStatementFileName({ deal, assetId });
    const uploadResult = await uploadFileToFolder({
      accessToken,
      folderId: statementsFolderId,
      fileName,
      mimeType: "application/pdf",
      fileBase64: statementFileBase64,
    });

    statementStorage.saved = true;
    statementStorage.fileName = fileName;
    statementStorage.fileId = uploadResult?.id || null;
    statementStorage.fileUrl = uploadResult?.attributes?.permalink || uploadResult?.permalink || null;
    statementStorage.message = "Statement generated and saved to WorkDrive.";

    return sendJson(req, res, 200, {
      ok: true,
      statementUrl: creatorUrl,
      statementStorage,
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
