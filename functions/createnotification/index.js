"use strict";

const { getDealsForPortal } = require("./lib/portalDeals");
const { resolveCatalystUserEmail, logIdentitySource } = require("./lib/catalystIdentity");

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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
  const requestId = createRequestId();

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

    // Identity comes from the platform only: req.user, the x-zc-* namespace, or
    // the Catalyst SDK. A client-supplied email is never an identity source, in
    // any environment. It is still read off the body and compared against the
    // resolved identity, so sending someone else's address is a 403.
    const directEmail = getCallerEmail(req);
    let resolvedIdentity = directEmail ? { email: directEmail, source: "request" } : null;
    if (!resolvedIdentity) {
      try {
        const viaCatalyst = await resolveCatalystUserEmail(req, requestId, "createnotification");
        if (viaCatalyst) resolvedIdentity = viaCatalyst;
      } catch (err) {
        logIdentitySource("createnotification", requestId, "none", req);
        return sendJson(res, 401, { error: "Missing authenticated user email context." });
      }
    }
    logIdentitySource("createnotification", requestId, resolvedIdentity?.source || "none", req);

    if (!resolvedIdentity) {
      return sendJson(res, 401, { error: "Missing authenticated user email context." });
    }

    const email = resolvedIdentity.email;

    if (requestedEmail && email !== requestedEmail) {
      return sendJson(res, 403, { error: "Requested email does not match authenticated user." });
    }

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
