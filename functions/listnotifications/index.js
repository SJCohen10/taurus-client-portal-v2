"use strict";

const portalDeals = require("./lib/portalDeals");

function createRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function shortError(message) {
    return String(message || "Unknown error").slice(0, 300);
}

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
}

function hasAnalyticsEnv() {
    return Boolean(
        process.env.ZOHO_ANALYTICS_CLIENT_ID &&
        process.env.ZOHO_ANALYTICS_CLIENT_SECRET &&
        process.env.ZOHO_ANALYTICS_REFRESH_TOKEN &&
        process.env.ZOHO_ANALYTICS_OWNER &&
        process.env.ZOHO_ANALYTICS_DB
    );
}

/**
 * Safety policy:
 * - If Analytics is configured: enforce "user can see this deal" by querying Analytics.
 * - If Analytics is NOT configured: do NOT allow broadcast notifications; only return
 *   notifications explicitly targeted to the current user email.
 *
 * Optionally, you can enable broadcast without analytics in DEV by setting:
 *   PORTAL_NOTIFICATIONS_ALLOW_BROADCAST_WITHOUT_ANALYTICS=true
 */
function allowBroadcastWithoutAnalytics() {
    return String(process.env.PORTAL_NOTIFICATIONS_ALLOW_BROADCAST_WITHOUT_ANALYTICS || "false") === "true";
}

module.exports = async (req, res) => {
    const requestId = createRequestId();
    const endpoint = "/server/listnotifications";

    try {
        if (req.method !== "GET") {
            return sendJson(res, 405, {
                error: "Method not allowed. Use GET.",
                requestId,
                endpoint,
                details: "invalid method",
            });
        }

        const catalyst = require("zcatalyst-sdk-node");
        const app = catalyst.initialize(req);

        const parsedUrl = new URL(req.url, "http://dummy-host");

        const dealId = String(
            req.query?.dealId || req.params?.dealId || parsedUrl.searchParams.get("dealId") || ""
        ).trim();

        const requestedEmail = String(
            req.query?.email || req.params?.email || parsedUrl.searchParams.get("email") || ""
        )
            .trim()
            .toLowerCase();

        const callerEmail = portalDeals.getCallerEmail(req);
        const email = (callerEmail || requestedEmail || "").trim().toLowerCase();

        if (!email) {
            return sendJson(res, 401, {
                error: "Missing authenticated user email context.",
                requestId,
                endpoint,
                details: "missing email",
            });
        }

        const includeRead =
            String(
                req.query?.includeRead ||
                req.params?.includeRead ||
                parsedUrl.searchParams.get("includeRead") ||
                "false"
            ) === "true";

        if (!dealId) {
            return sendJson(res, 400, { error: "Missing dealId", requestId, endpoint, details: "missing dealId" });
        }

        if (!/^[0-9]{6,30}$/.test(dealId)) {
            return sendJson(res, 400, { error: "Invalid dealId", requestId, endpoint, details: "invalid dealId" });
        }

        // --- Authorization (only if Analytics env exists) ---
        if (hasAnalyticsEnv()) {
            const visibleDeals = await portalDeals.getDealsForPortal({ email, accountId: "" });
            const visibleDealIds = new Set(
                (visibleDeals || []).map((d) => String(d.deal_id || "").trim()).filter(Boolean)
            );

            if (!visibleDealIds.has(dealId)) {
                return sendJson(res, 403, {
                    error: "Deal is not authorized for this user.",
                    requestId,
                    endpoint,
                    details: "deal authorization failed",
                });
            }
        } else {
            console.warn("[listnotifications] Analytics env missing; skipping deal authorization check", {
                requestId,
                email,
                dealId,
            });
        }

        // --- Data store query ---
        const zcql = app.zcql();
        const esc = (s) => String(s).replace(/'/g, "''");

        const notificationsTable = String(process.env.PORTAL_NOTIFICATIONS_TABLE || "portal_notifications").trim();

        const COL_DEAL_ID = process.env.PORTAL_NOTIF_COL_DEAL_ID || "Deal_Id";
        const COL_AUDIENCE_EMAIL = process.env.PORTAL_NOTIF_COL_AUDIENCE_EMAIL || "Audience_Email";
        const COL_IS_READ = process.env.PORTAL_NOTIF_COL_IS_READ || "Is_Read";
        const COL_CREATED_AT = process.env.PORTAL_NOTIF_COL_CREATED_AT || "Created_At";

        if (!/^[A-Za-z0-9_]+$/.test(notificationsTable)) {
            return sendJson(res, 500, { error: "Internal error", requestId, endpoint, details: "invalid table name" });
        }

        let query = `SELECT * FROM ${notificationsTable} WHERE ${COL_DEAL_ID}='${esc(dealId)}'`;

        // Audience scoping:
        // - With Analytics: allow targeted OR broadcast (NULL)
        // - Without Analytics: safest is targeted only, unless env explicitly allows broadcast
        if (hasAnalyticsEnv() || allowBroadcastWithoutAnalytics()) {
            query += ` AND (${COL_AUDIENCE_EMAIL}='${esc(email)}' OR ${COL_AUDIENCE_EMAIL} IS NULL)`;
        } else {
            query += ` AND ${COL_AUDIENCE_EMAIL}='${esc(email)}'`;
        }

        query += ` ORDER BY ${COL_CREATED_AT} DESC`;

        console.log("[listnotifications] zcql", {
            requestId,
            dealId,
            includeRead,
            email,
            table: notificationsTable,
            analyticsAuth: hasAnalyticsEnv(),
            broadcastAllowedWithoutAnalytics: allowBroadcastWithoutAnalytics(),
            query,
        });

        const rows = await zcql.executeZCQLQuery(query);

        const mapped = (rows || []).map((r) => {
            if (!r || typeof r !== "object") return r;
            const keys = Object.keys(r);
            if (keys.length === 1 && r[keys[0]] && typeof r[keys[0]] === "object") {
                return r[keys[0]];
            }
            return r[notificationsTable] || r;
        });

        const notifications = includeRead
            ? mapped
            : mapped.filter(
                (n) => !(n?.[COL_IS_READ] === true || String(n?.[COL_IS_READ]).toLowerCase() === "true")
            );

        console.log("[listnotifications] ok", {
            requestId,
            dealId,
            includeRead,
            email,
            count: notifications.length,
        });

        return sendJson(res, 200, { notifications: notifications || [] });
    } catch (err) {
        console.error("[listnotifications] error", {
            requestId,
            endpoint,
            message: err?.message || String(err),
            stack: err?.stack,
        });

        return sendJson(res, 500, {
            error: "Internal error",
            requestId,
            endpoint,
            details: shortError(err?.message || err),
        });
    }
};