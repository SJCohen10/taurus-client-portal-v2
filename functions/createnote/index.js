"use strict";

const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit } = require("./lib/security");
const { getDealsForPortal } = require("./lib/portalDeals");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUTHZ_TIMEOUT_MS = Number(process.env.PORTAL_CREATE_NOTE_AUTHZ_TIMEOUT_MS || 5000);
const CRM_WRITE_TIMEOUT_MS = Number(process.env.PORTAL_CREATE_NOTE_CRM_TIMEOUT_MS || 7000);

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeContent(value) {
  return String(value || "").replace(/[<>]/g, "").trim();
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

module.exports = async (req, res) => {
  const requestId = createRequestId();

  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "POST") return sendJson(req, res, 405, responseEnvelope({ requestId, message: "That request couldn't be completed." }));

    const body = await readJsonBody(req);
    assertAllowedKeys(body, ["email", "recordType", "recordId", "content"]);

    const email = await enforceUserContext(req, body.email, requestId, "createnote");
    enforceRateLimit({ key: `createnote:${email}`, limit: 20, windowMs: 60000 });

    if (!EMAIL_REGEX.test(email)) return sendJson(req, res, 400, responseEnvelope({ requestId, message: "We couldn't verify your account. Please sign in again." }));

    const recordType = String(body.recordType || "").trim();
    const recordId = String(body.recordId || "").trim();
    const content = sanitizeContent(body.content);
    if (!["Deal", "Asset"].includes(recordType)) return sendJson(req, res, 400, responseEnvelope({ requestId, message: "We couldn't save your note against this deal. Please contact your Taurus Account Manager." }));
    if (!/^\d+$/.test(recordId)) return sendJson(req, res, 400, responseEnvelope({ requestId, message: "We couldn't save your note against this deal. Please contact your Taurus Account Manager." }));
    if (!content || content.length > 2000) return sendJson(req, res, 400, responseEnvelope({ requestId, message: "A note must be between 1 and 2000 characters." }));

    const scope = await withTimeout(() => resolveAuthorizationScope(email), AUTHZ_TIMEOUT_MS, "resolveAuthorizationScope");
    const allowed = await withTimeout(() => getDealsForPortal({ email, accountId: scope.accountId }), AUTHZ_TIMEOUT_MS, "getDealsForPortal");
    const canAccess = allowed.some((d) => String(recordType === "Deal" ? d.deal_id : d.asset_id) === recordId);
    if (!canAccess) return sendJson(req, res, 403, responseEnvelope({ requestId, message: "You don't have access to this deal. Please contact your Taurus Account Manager." }));

    const seModule = recordType === "Deal" ? "Deals" : "Assets";
    const payload = { data: [{ Note_Title: `Portal note (${email})`, Note_Content: content }] };
    const parsed = await withTimeout(
      () => crmRequest({ method: "POST", path: `/${seModule}/${recordId}/Notes`, body: payload, requestId }),
      CRM_WRITE_TIMEOUT_MS,
      "create CRM note"
    );
    const item = parsed?.data?.[0] || {};
    if (String(item.status || "").toLowerCase() !== "success") {
      return sendJson(req, res, 502, responseEnvelope({ requestId, message: "We couldn't save your note. Please contact your Taurus Account Manager." }));
    }

    return sendJson(req, res, 200, responseEnvelope({ status: "success", requestId, message: "Note created", data: { success: true, noteId: item.details?.id || null } }));
  } catch (error) {
    console.error("createnote failed", { requestId, message: error.message });
    const status = error.statusCode || 500;
    return sendJson(req, res, status, responseEnvelope({ requestId, message: status === 504 ? "That took too long. Please contact your Taurus Account Manager." : "We couldn't save your note. Please contact your Taurus Account Manager." }));
  }
};
