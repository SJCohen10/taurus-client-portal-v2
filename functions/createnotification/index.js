"use strict";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
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
    const catalyst = require("zcatalyst-sdk-node");
    const app = catalyst.initialize(req);

    const body = parseBody(req);

    const dealId = String(body.dealId || "").trim();
    const message = String(body.message || "").trim();

    if (!dealId) return sendJson(res, 400, { error: "Missing dealId" });
    if (!message) return sendJson(res, 400, { error: "Missing message" });

    const table = app.datastore().table("portal_notifications");

    const row = {
      deal_id: dealId,
      account_id: body.accountId ? String(body.accountId) : null,
      audience_email: body.audienceEmail ? String(body.audienceEmail).toLowerCase() : null,
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
