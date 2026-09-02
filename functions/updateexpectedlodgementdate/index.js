"use strict";

const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit } = require("./lib/security");
const { getDealsForPortal } = require("./lib/portalDeals");

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const AUTHZ_TIMEOUT_MS = Number(process.env.PORTAL_EXPECTED_DATE_AUTHZ_TIMEOUT_MS || 5000);
const CRM_WRITE_TIMEOUT_MS = Number(process.env.PORTAL_EXPECTED_DATE_CRM_TIMEOUT_MS || 7000);

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isValidDate(value) {
  if (!DATE_REGEX.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseCanViewFirmDeals(value) {
  return value === true || value === "true" || value === "Yes";
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

async function resolveAuthorizationScope(email) {
  const search = await crmRequest({ method: "GET", path: "/Contacts/search", query: { email } });
  const contact = (search?.data || [])[0] || {};
  const accountLookup = contact.Account_Name || contact.Account || {};
  const canViewFirmDeals = parseCanViewFirmDeals(contact.Can_View_Firm_Deals);
  return {
    accountId: canViewFirmDeals ? String(accountLookup.id || "").trim() : "",
  };
}

module.exports = async (req, res) => {
  const requestId = createRequestId();

  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "POST") return sendJson(req, res, 405, responseEnvelope({ requestId, message: "Method not allowed" }));

    const body = await readJsonBody(req);
    assertAllowedKeys(body, ["email", "dealId", "expectedLodgementDate"]);

    const email = await enforceUserContext(req, body.email, requestId, "updateexpectedlodgementdate");
    enforceRateLimit({ key: `updateexpectedlodgementdate:${email}`, limit: 15, windowMs: 60000 });

    const dealId = String(body.dealId || "").trim();
    const expectedLodgementDate = String(body.expectedLodgementDate || "").trim();

    if (!/^\d+$/.test(dealId)) return sendJson(req, res, 400, responseEnvelope({ requestId, message: "dealId must be numeric" }));
    if (!isValidDate(expectedLodgementDate)) return sendJson(req, res, 400, responseEnvelope({ requestId, message: "expectedLodgementDate must be YYYY-MM-DD" }));

    const scope = await withTimeout(() => resolveAuthorizationScope(email), AUTHZ_TIMEOUT_MS, "resolveAuthorizationScope");
    const allowed = await withTimeout(() => getDealsForPortal({ email, accountId: scope.accountId }), AUTHZ_TIMEOUT_MS, "getDealsForPortal");
    if (!allowed.some((d) => String(d.deal_id) === dealId)) return sendJson(req, res, 403, responseEnvelope({ requestId, message: "Forbidden" }));

    const payload = {
      data: [
        {
          id: String(dealId),
          Expected_Lodgement_Date: expectedLodgementDate,
        },
      ],
    };

    const parsed = await withTimeout(
      () => crmRequest({ method: "PUT", path: "/Deals", body: payload, requestId }),
      CRM_WRITE_TIMEOUT_MS,
      "update CRM deal"
    );
    const item = parsed?.data?.[0] || {};
    if (String(item.status || "").toLowerCase() !== "success") return sendJson(req, res, 502, responseEnvelope({ requestId, message: "CRM deal update failed" }));

    return sendJson(req, res, 200, responseEnvelope({ status: "success", requestId, message: "Expected lodgement date updated", data: { success: true } }));
  } catch (error) {
    console.error("updateexpectedlodgementdate failed", { requestId, message: error.message });
    const status = error.statusCode || 500;
    return sendJson(req, res, status, responseEnvelope({ requestId, message: status === 504 ? "Update expected lodgement date timed out" : "Internal server error", details: error.statusCode ? error.message : undefined }));
  }
};
