"use strict";

const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, enforceRateLimit, parseQuery } = require("./lib/security");
const portalDeals = require("./lib/portalDeals");

const AUTHZ_TIMEOUT_MS = Number(process.env.PORTAL_DEAL_TRANSACTIONS_AUTHZ_TIMEOUT_MS || 5000);
const CRM_QUERY_TIMEOUT_MS = Number(process.env.PORTAL_DEAL_TRANSACTIONS_CRM_TIMEOUT_MS || 7000);

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function responseEnvelope({ status = "error", requestId, message, details, data = {} }) {
  return { status, requestId, message, ...(details ? { details } : {}), ...data };
}

async function withTimeout(work, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.statusCode = 504;
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseCanViewFirmDeals(value) {
  return value === true || value === "true" || value === "Yes";
}

async function resolveAuthorizationScope(email) {
  const search = await crmRequest({ method: "GET", path: "/Contacts/search", query: { email } });
  const contact = (search?.data || [])[0] || {};
  const accountLookup = contact.Account_Name || contact.Account || {};
  const canViewFirmDeals = parseCanViewFirmDeals(contact.Can_View_Firm_Deals);
  return {
    accountId: canViewFirmDeals ? String(accountLookup.id || "").trim() : "",
  };
}

function parseAssetIds(raw) {
  if (raw == null) return [];
  const input = Array.isArray(raw) ? raw.join(",") : String(raw);
  const ids = input.split(",").map((value) => value.trim()).filter((value) => /^\d+$/.test(value));
  return Array.from(new Set(ids)).slice(0, 50);
}

module.exports = async (req, res) => {
  const requestId = createRequestId();

  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "GET") return sendJson(req, res, 405, responseEnvelope({ requestId, message: "Method not allowed. Use GET." }));

    const query = parseQuery(req);
    const email = enforceUserContext(req, query.get("email"));
    enforceRateLimit({ key: `getdealtransactions:${email}`, limit: 30, windowMs: 60000 });

    const assetIds = parseAssetIds(query.get("assetIds") || "");
    if (!assetIds.length) return sendJson(req, res, 400, responseEnvelope({ requestId, message: "Missing assetIds" }));

    const scope = await withTimeout(() => resolveAuthorizationScope(email), AUTHZ_TIMEOUT_MS, "resolveAuthorizationScope");
    const visibleDeals = await withTimeout(
      () => portalDeals.getDealsForPortal({ email, accountId: scope.accountId }),
      AUTHZ_TIMEOUT_MS,
      "getDealsForPortal"
    );

    const allowedAssetIds = new Set();
    for (const deal of visibleDeals || []) {
      String(deal.asset_ids || deal.asset_id || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => /^\d+$/.test(x))
        .forEach((x) => allowedAssetIds.add(x));
    }

    const unauthorized = assetIds.filter((id) => !allowedAssetIds.has(id));
    if (unauthorized.length) {
      return sendJson(req, res, 403, responseEnvelope({ requestId, message: "One or more assetIds are not authorized for this user." }));
    }

    const inList = assetIds.map((id) => `'${id}'`).join(",");
    const select_query = `select id, Name, Transaction_Type, Current_Advance_Amount, Paid_Date, Asset from Transactions where Asset.id in (${inList})`;
    const coql = await withTimeout(
      () => crmRequest({ method: "POST", path: "/coql", body: { select_query }, requestId }),
      CRM_QUERY_TIMEOUT_MS,
      "fetch transactions"
    );

    const transactions = (coql.data || []).map((record) => ({
      id: record.id || null,
      name: record.Name || "",
      type: record.Transaction_Type || "",
      advance_amount: record.Current_Advance_Amount ?? null,
      paid_date: record.Paid_Date || null,
      asset_id: record.Asset?.id || null,
    }));

    return sendJson(
      req,
      res,
      200,
      responseEnvelope({ status: "success", requestId, message: "Transactions loaded", data: { assetIds, count: transactions.length, transactions } })
    );
  } catch (err) {
    console.error("getdealtransactions failed", { requestId, message: err.message });
    const status = err.statusCode || 500;
    return sendJson(
      req,
      res,
      status,
      responseEnvelope({ requestId, message: status === 504 ? "Get deal transactions timed out" : "Internal server error", details: err.statusCode ? err.message : undefined })
    );
  }
};
