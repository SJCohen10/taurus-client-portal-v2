"use strict";

const { crmRequest } = require("../lib/crm");
const { handleOptions, sendJson, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit } = require("../lib/security");
const { getDealsForPortal } = require("../getdealtransactions/lib/portalDeals");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeContent(value) {
  return String(value || "").replace(/[<>]/g, "").trim();
}

module.exports = async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "POST") return sendJson(req, res, 405, { error: "Method not allowed" });

    const body = await readJsonBody(req);
    assertAllowedKeys(body, ["email", "recordType", "recordId", "content"]);

    const email = enforceUserContext(req, body.email);
    enforceRateLimit({ key: `createnote:${email}`, limit: 20, windowMs: 60000 });

    if (!EMAIL_REGEX.test(email)) return sendJson(req, res, 400, { error: "Invalid user context" });

    const recordType = String(body.recordType || "").trim();
    const recordId = String(body.recordId || "").trim();
    const content = sanitizeContent(body.content);
    if (!["Deal", "Asset"].includes(recordType)) return sendJson(req, res, 400, { error: "recordType must be Deal or Asset" });
    if (!/^\d+$/.test(recordId)) return sendJson(req, res, 400, { error: "recordId must be numeric" });
    if (!content || content.length > 2000) return sendJson(req, res, 400, { error: "content must be 1-2000 chars" });

    const allowed = await getDealsForPortal({ email });
    const canAccess = allowed.some((d) => String(recordType === "Deal" ? d.deal_id : d.asset_id) === recordId);
    if (!canAccess) return sendJson(req, res, 403, { error: "Forbidden" });

    const seModule = recordType === "Deal" ? "Deals" : "Assets";
    const payload = { data: [{ Note_Title: `Portal note (${email})`, Note_Content: content }] };
    const parsed = await crmRequest({ method: "POST", path: `/${seModule}/${recordId}/Notes`, body: payload });
    const item = parsed?.data?.[0] || {};
    if (String(item.status || "").toLowerCase() !== "success") return sendJson(req, res, 502, { error: "CRM note creation failed" });

    return sendJson(req, res, 200, { success: true, noteId: item.details?.id || null });
  } catch (error) {
    console.error("createnote failed", { message: error.message });
    return sendJson(req, res, error.statusCode || 500, { error: error.statusCode ? error.message : "Internal server error" });
  }
};
