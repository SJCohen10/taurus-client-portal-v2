"use strict";

const crypto = require("crypto");
const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit, parseQuery } = require("./lib/security");
const { getDealsForPortal, getCallerEmail } = require("./lib/portalDeals");

const ACCOUNT_ID_REGEX = /^[0-9]{6,30}$/;

function buildCreatorUrl(pageName, assetId) {
  const configuredBase = String(process.env.ZOHO_CREATOR_STATEMENT_BASE || "").trim();
  const defaultBase = "https://creatorapp.zoho.com/administrator_tauruscapital/loan-management-system/#Page";
  const base = configuredBase.startsWith("https://creatorapp.zoho.com/") ? configuredBase : defaultBase;
  return `${base}:${pageName}?CrmAssetId=${assetId}`;
}

function signToken(payload) {
  const secret = process.env.STATEMENT_SIGNING_SECRET || "change-me";
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const [body, sig] = String(token || "").split(".");
  const secret = process.env.STATEMENT_SIGNING_SECRET || "change-me";
  const expected = crypto.createHmac("sha256", secret).update(body || "").digest("base64url");
  if (!body || !sig || sig !== expected) return null;
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
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

module.exports = async (req, res) => {
  try {
    if (handleOptions(req, res)) return;

    if (req.method === "GET") {
      const token = parseQuery(req).get("token");
      const parsed = verifyToken(token);
      if (!parsed) return sendJson(req, res, 401, { error: "Invalid token" });
      res.writeHead(302, { Location: parsed.url, "Cache-Control": "no-store" });
      return res.end();
    }

    if (req.method !== "POST") return sendJson(req, res, 405, { error: "Method not allowed" });
    const body = await readJsonBody(req);
    assertAllowedKeys(body, ["email", "assetId", "accountId"]);

    const bodyEmail = String(body.email || "").trim().toLowerCase();
    const callerEmail = getCallerEmail(req);
    const requestedEmail = bodyEmail || callerEmail;

    const email = enforceUserContext(req, requestedEmail);

    console.info("[generatestatement] resolved user context", {
      bodyEmail,
      callerEmail,
      resolvedEmail: email,
    });

    if (!email) {
      return sendJson(req, res, 401, { error: "Unable to resolve portal user email" });
    }

    enforceRateLimit({ key: `generatestatement:${email}`, limit: 10, windowMs: 60000 });

    const assetId = String(body.assetId || "").trim();
    if (!/^\d+$/.test(assetId)) return sendJson(req, res, 400, { error: "Invalid assetId" });

    console.info("[generatestatement] fetching allowed deals", { email });
    const allowed = await getDealsForPortal({ email });

    console.info("[generatestatement] auth check", {
      email,
      requestedAssetId: assetId,
      allowedCount: allowed.length,
      sample: allowed.slice(0, 5).map((row) => ({
        deal_id: row.deal_id,
        asset_id: row.asset_id,
        asset_ids: row.asset_ids,
        extractedAssetIds: extractAssetIdsFromAllowedRow(row),
      })),
    });

    const isAllowed = allowed.some((row) =>
      extractAssetIdsFromAllowedRow(row).includes(assetId)
    );

    if (!isAllowed) {
      console.warn("[generatestatement] forbidden asset access", {
        email,
        requestedAssetId: assetId,
        allowedCount: allowed.length,
        sample: allowed.slice(0, 5).map((row) => ({
          deal_id: row.deal_id,
          asset_id: row.asset_id,
          asset_ids: row.asset_ids,
          extractedAssetIds: extractAssetIdsFromAllowedRow(row),
        })),
      });

      return sendJson(req, res, 403, { error: "Forbidden" });
    }

    const asset = (await crmRequest({ method: "GET", path: `/Assets/${assetId}` }))?.data?.[0] || {};
    const assetType = String(asset.Asset_Type || "").trim().toLowerCase();
    let statementPage = null;
    if (assetType.includes("seller")) statementPage = "Seller_Statements";
    else if (assetType.includes("agent")) statementPage = "Agent_Statements";
    else if (assetType.includes("agency")) statementPage = "Agency_Statements";
    else if (assetType.includes("bond")) statementPage = "Bond_Statements";
    else if (assetType.includes("rafpay")) statementPage = "RAFPAY_Statements";
    else if (assetType === "aa" || assetType.includes(" aa")) statementPage = "AA_Statements";
    else if (assetType.includes("lwb")) statementPage = "LWB_Statements";
    if (!statementPage) return sendJson(req, res, 404, { error: "No statement template for this asset" });

    const creatorUrl = buildCreatorUrl(statementPage, assetId);
    return sendJson(req, res, 200, { ok: true, statementUrl: creatorUrl });
  } catch (err) {
    console.error("generatestatement failed", {
      message: err.message,
      statusCode: err.statusCode || 500,
      details: err.details || null,
      stack: err.stack || null,
    });
    return sendJson(req, res, err.statusCode || 500, {
      error: err.statusCode ? err.message : "Internal server error",
    });
  }
};
