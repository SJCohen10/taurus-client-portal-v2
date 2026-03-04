"use strict";

const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, enforceRateLimit, parseQuery } = require("./lib/security");
const { getDealsForPortal } = require("./lib/portalDeals");

const ACCOUNT_ID_REGEX = /^[A-Za-z0-9_-]{6,100}$/;

module.exports = async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "GET") return sendJson(req, res, 405, { error: "Method not allowed" });

    const query = parseQuery(req);
    const email = enforceUserContext(req, query.get("email"));
    enforceRateLimit({ key: `getbankdetailsforaccount:${email}`, limit: 30, windowMs: 60000 });

    const accountId = String(query.get("accountId") || "").trim();
    const avsOnly = String(query.get("avsOnly") || "false").toLowerCase() === "true";
    if (!ACCOUNT_ID_REGEX.test(accountId)) return sendJson(req, res, 400, { error: "Invalid accountId" });

    const allowedDeals = await getDealsForPortal({ email, accountId });
    if (!allowedDeals.length) return sendJson(req, res, 403, { error: "Forbidden" });

    let criteria = `((Account:equals:${accountId}))`;
    if (avsOnly) criteria = `((Account:equals:${accountId}) and (AVS:equals:true))`;

    const json = await crmRequest({ method: "GET", path: "/Bank_Details/search", query: { criteria, per_page: 200, page: 1 } });
    const records = json.data || [];
    const bankDetails = records.map((bd) => {
      const accountNumber = bd.Account_Number || "";
      const last4 = accountNumber ? String(accountNumber).slice(-4) : "";
      return { id: bd.id, bank: bd.Bank || "", name: bd.Name || "", accountNumberLast4: last4, label: `${bd.Bank || "Bank"} – ${bd.Name || "Account"}${last4 ? ` – ****${last4}` : ""}` };
    });

    return sendJson(req, res, 200, { accountId, avsOnly, bankDetails });
  } catch (err) {
    console.error("getbankdetailsforaccount failed", { message: err.message });
    return sendJson(req, res, err.statusCode || 500, { error: err.statusCode ? err.message : "Internal server error" });
  }
};
