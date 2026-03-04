"use strict";

const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit } = require("./lib/security");
const { getDealsForPortal } = require("./lib/portalDeals");

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (!DATE_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "POST") return sendJson(req, res, 405, { error: "Method not allowed" });

    const body = await readJsonBody(req);
    assertAllowedKeys(body, ["email", "dealId", "expectedLodgementDate"]);

    const email = enforceUserContext(req, body.email);
    enforceRateLimit({ key: `updateexpectedlodgementdate:${email}`, limit: 15, windowMs: 60000 });

    const dealId = String(body.dealId || "").trim();
    const expectedLodgementDate = String(body.expectedLodgementDate || "").trim();

    if (!/^\d+$/.test(dealId)) return sendJson(req, res, 400, { error: "dealId must be numeric" });
    if (!isValidDate(expectedLodgementDate)) return sendJson(req, res, 400, { error: "expectedLodgementDate must be YYYY-MM-DD" });

    const allowed = await getDealsForPortal({ email });
    if (!allowed.some((d) => String(d.deal_id) === dealId)) return sendJson(req, res, 403, { error: "Forbidden" });

    const payload = { data: [{ Expected_Lodgement_Date: expectedLodgementDate }] };
    const parsed = await crmRequest({ method: "PUT", path: `/Deals/${dealId}`, body: payload });
    const item = parsed?.data?.[0] || {};
    if (String(item.status || "").toLowerCase() !== "success") return sendJson(req, res, 502, { error: "CRM deal update failed" });

    return sendJson(req, res, 200, { success: true });
  } catch (error) {
    console.error("updateexpectedlodgementdate failed", { message: error.message });
    return sendJson(req, res, error.statusCode || 500, { error: error.statusCode ? error.message : "Internal server error" });
  }
};
