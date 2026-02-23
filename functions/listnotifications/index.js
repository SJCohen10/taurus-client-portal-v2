"use strict";

const portalDeals = require("./lib/portalDeals");

function createRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
    const requestId = createRequestId();
    const endpoint = "/server/listnotifications";

    try {
        if (req.method !== "GET") {
            return sendJson(res, 405, { error: "Method not allowed. Use GET.", requestId, endpoint, details: "invalid method" });
        }
        const catalyst = require("zcatalyst-sdk-node");
        const app = catalyst.initialize(req);

        const parsedUrl = new URL(req.url, "http://dummy-host");
        const dealId = String(
            req.query?.dealId || req.params?.dealId || parsedUrl.searchParams.get("dealId") || ""
        ).trim();
        const requestedEmail = String(
            req.query?.email || req.params?.email || parsedUrl.searchParams.get("email") || ""
        ).trim().toLowerCase();
        const callerEmail = portalDeals.getCallerEmail(req);
        const email = callerEmail || requestedEmail;
        if (!email) {
            return sendJson(res, 401, {
                error: "Missing authenticated user email context.",
                requestId,
                endpoint,
                details: "missing email",
            });
        }

        const includeRead = String(
            req.query?.includeRead || req.params?.includeRead || parsedUrl.searchParams.get("includeRead") || "false"
        ) === "true";

        if (!dealId) {
            return sendJson(res, 400, { error: "Missing dealId", requestId, endpoint, details: "missing dealId" });
        }

        if (!/^[0-9]{6,30}$/.test(dealId)) {
            return sendJson(res, 400, { error: "Invalid dealId", requestId, endpoint, details: "invalid dealId" });
        }

        const visibleDeals = await portalDeals.getDealsForPortal({ email, accountId: "" });
        const visibleDealIds = new Set((visibleDeals || []).map((d) => String(d.deal_id || "").trim()).filter(Boolean));
        if (!visibleDealIds.has(dealId)) {
            return sendJson(res, 403, {
                error: "Deal is not authorized for this user.",
                requestId,
                endpoint,
                details: "deal authorization failed",
            });
        }

        const zcql = app.zcql();
        const esc = (s) => String(s).replace(/'/g, "''");
        const notificationsTable = String(process.env.PORTAL_NOTIFICATIONS_TABLE || "portal_notifications").trim();
        if (!/^[A-Za-z0-9_]+$/.test(notificationsTable)) {
            return sendJson(res, 500, { error: "Internal error", requestId, endpoint, details: "invalid table name" });
        }

        let query = `SELECT * FROM ${notificationsTable} WHERE deal_id='${esc(dealId)}'`;
        if (email) {
            query += ` AND (audience_email='${esc(email)}' OR audience_email IS NULL)`;
        }
        query += ` ORDER BY created_at DESC`;

        const rows = await zcql.executeZCQLQuery(query);
        const mapped = (rows || []).map((r) => r[notificationsTable] || r);
        const notifications = includeRead ? mapped : mapped.filter((n) => !(n?.is_read === true || String(n?.is_read).toLowerCase() === "true"));

        console.log("[listnotifications]", {
            requestId,
            email,
            dealId,
            includeRead,
            count: notifications.length,
        });

        return sendJson(res, 200, { notifications: notifications || [] });
    } catch (err) {
        console.error("[listnotifications] error", {
            requestId,
            endpoint: "/server/listnotifications",
            message: err?.message || String(err),
        });
        return sendJson(res, 500, { error: "Internal error", requestId, endpoint, details: "datastore read failed" });
    }
};
