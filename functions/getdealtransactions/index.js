"use strict";

const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, enforceRateLimit, parseQuery } = require("./lib/security");
const portalDeals = require("./lib/portalDeals");

function parseAssetIds(raw) {
  if (raw == null) return [];
  const input = Array.isArray(raw) ? raw.join(",") : String(raw);
  const ids = input.split(",").map((value) => value.trim()).filter((value) => /^\d+$/.test(value));
  return Array.from(new Set(ids)).slice(0, 50);
}

module.exports = async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "GET") return sendJson(req, res, 405, { error: "Method not allowed. Use GET." });

    const query = parseQuery(req);
    const email = enforceUserContext(req, query.get("email"));
    enforceRateLimit({ key: `getdealtransactions:${email}`, limit: 30, windowMs: 60000 });

    const assetIds = parseAssetIds(query.get("assetIds") || "");
    if (!assetIds.length) return sendJson(req, res, 400, { error: "Missing assetIds" });

    const visibleDeals = await portalDeals.getDealsForPortal({ email, accountId: "" });
    const allowedAssetIds = new Set();
    for (const deal of visibleDeals || []) {
      String(deal.asset_ids || deal.asset_id || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => /^\d+$/.test(x))
        .forEach((x) => allowedAssetIds.add(x));
    }

    const unauthorized = assetIds.filter((id) => !allowedAssetIds.has(id));
    if (unauthorized.length) return sendJson(req, res, 403, { error: "One or more assetIds are not authorized for this user." });

    const inList = assetIds.map((id) => `'${id}'`).join(",");
    const select_query = `select id, Name, Transaction_Type, Current_Advance_Amount, Asset from Transactions where Asset.id in (${inList})`;
    const coql = await crmRequest({ method: "POST", path: "/coql", body: { select_query } });

    const transactions = (coql.data || []).map((record) => ({
      id: record.id || null,
      name: record.Name || "",
      type: record.Transaction_Type || "",
      advance_amount: record.Current_Advance_Amount ?? null,
      asset_id: record.Asset?.id || null,
    }));

    return sendJson(req, res, 200, { assetIds, count: transactions.length, transactions });
  } catch (err) {
    console.error("getdealtransactions failed", { message: err.message });
    return sendJson(req, res, err.statusCode || 500, { error: err.statusCode ? err.message : "Internal server error" });
  }
};
