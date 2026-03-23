"use strict";

const { getDealsForPortal } = require("../lib/portalDeals");

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function getCallerEmail(req) {
  const headers = req?.headers || {};
  const direct =
    req?.user?.email ||
    headers["x-zc-user-email"] ||
    headers["x-zc-useremail"] ||
    headers["x-catalyst-user-email"] ||
    headers["x-user-email"] ||
    headers["x-forwarded-user-email"] ||
    "";
  return String(direct || "").trim().toLowerCase();
}

// Catalyst Advanced I/O often gives req.body as an object if JSON,
// but sometimes it can be a string. Handle both.
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "Method not allowed. Use POST." });
    }
    const catalyst = require("zcatalyst-sdk-node");
    const app = catalyst.initialize(req);

    const body = parseBody(req);

    const dealId = String(body.dealId || "").trim();
    const message = String(body.message || "").trim();
    const requestedEmail = String(body.email || body.audienceEmail || "").trim().toLowerCase();
    const callerEmail = getCallerEmail(req);
    const email = callerEmail || requestedEmail;

    if (!email) return sendJson(res, 401, { error: "Missing authenticated user email context." });

    if (!dealId) return sendJson(res, 400, { error: "Missing dealId" });
    if (!/^[0-9]{6,30}$/.test(dealId)) return sendJson(res, 400, { error: "Invalid dealId" });
    if (!message) return sendJson(res, 400, { error: "Missing message" });

    const visibleDeals = await getDealsForPortal({ email });
    const visibleDealIds = new Set((visibleDeals || []).map((d) => String(d.deal_id || "").trim()).filter(Boolean));
    const isAuthorized = visibleDealIds.has(dealId);

    console.log("[createnotification] authorization", {
      email,
      requestedDealId: dealId,
      visibleDealCount: Array.isArray(visibleDeals) ? visibleDeals.length : 0,
      visibleDealSample: Array.isArray(visibleDeals)
        ? visibleDeals.slice(0, 5).map((d) => String(d?.deal_id || "").trim()).filter(Boolean)
        : [],
      isAuthorized,
    });

    if (!isAuthorized) return sendJson(res, 403, { error: "Deal is not authorized for this user." });

    const table = app.datastore().table("portal_notifications");

    const row = {
      deal_id: dealId,
      account_id: body.accountId ? String(body.accountId) : null,
      audience_email: email,
      message,
      type: String(body.type || "INFO"),
      severity: String(body.severity || "info"),
      is_read: false,
      created_at: new Date().toISOString(),
      expires_at: body.expiresAt ? String(body.expiresAt) : null,
    };

    const inserted = await table.insertRow(row);
    return sendJson(res, 200, { notification: inserted });
  } catch (err) {
    console.error("createnotification error", err);
    return sendJson(res, 500, { error: "Internal error", details: err.message });
  }
};
