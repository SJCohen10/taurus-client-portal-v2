"use strict";

const crypto = require("crypto");
const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit, parseQuery } = require("./lib/security");
const { getDealsForPortal } = require("./lib/portalDeals");

function buildCreatorUrl(pageName, assetId) {
  const base = process.env.ZOHO_CREATOR_STATEMENT_BASE || "https://creatorapp.zoho.com/administrator_tauruscapital/loan-management-system/#Page";
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
    assertAllowedKeys(body, ["email", "assetId"]);

    const email = enforceUserContext(req, body.email);
    enforceRateLimit({ key: `generatestatement:${email}`, limit: 10, windowMs: 60000 });

    const assetId = String(body.assetId || "").trim();
    if (!/^\d+$/.test(assetId)) return sendJson(req, res, 400, { error: "Invalid assetId" });

    const allowed = await getDealsForPortal({ email });
    if (!allowed.some((d) => String(d.asset_id) === assetId || String(d.asset_ids || "").split(",").map((x) => x.trim()).includes(assetId))) {
      return sendJson(req, res, 403, { error: "Forbidden" });
    }

    const asset = (await crmRequest({ method: "GET", path: `/Assets/${assetId}` }))?.data?.[0] || {};
    const assetType = String(asset.Asset_Type || "").trim().toLowerCase();
    let statementPage = null;
    if (assetType.includes("seller")) statementPage = "Seller_Statements";
    else if (assetType.includes("agent")) statementPage = "Agent_Statements";
    else if (assetType.includes("agency")) statementPage = "Agency_Statements";
    else if (assetType.includes("bond")) statementPage = "Bond_Statements";
    if (!statementPage) return sendJson(req, res, 404, { error: "No statement template for this asset" });

    const creatorUrl = buildCreatorUrl(statementPage, assetId);
    const token = signToken({ url: creatorUrl, exp: Date.now() + 5 * 60 * 1000 });
    return sendJson(req, res, 200, { statementUrl: `/server/generatestatement?token=${encodeURIComponent(token)}`, expiresInSeconds: 300 });
  } catch (err) {
    console.error("generatestatement failed", { message: err.message });
    return sendJson(req, res, err.statusCode || 500, { error: err.statusCode ? err.message : "Internal server error" });
  }
};
