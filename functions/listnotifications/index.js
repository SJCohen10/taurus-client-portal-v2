"use strict";

const portalDeals = require("./lib/portalDeals");
const { resolvePortalUserContextByEmail } = require("./lib/portalUserContext");

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

        // --- Authorization (only if Analytics env exists and token retrieval succeeds) ---
        let analyticsAuthorized = false;
        let resolvedAccountId = "";
        let canViewFirmDeals = false;

        if (hasAnalyticsEnv()) {
            try {
                try {
                    const portalUser = await resolvePortalUserContextByEmail({ email, requestId });
                    canViewFirmDeals = Boolean(portalUser?.canViewFirmDeals);
                    resolvedAccountId = canViewFirmDeals ? String(portalUser?.accountId || "").trim() : "";
                } catch (portalUserErr) {
                    // Preserve secure behavior if CRM context lookup fails by keeping email-only scope.
                    console.warn("[listnotifications] CRM portal user resolution failed; defaulting to email-only authorization", {
                        requestId,
                        email,
                        dealId,
                        message: portalUserErr?.message || String(portalUserErr),
                    });
                }

                const visibleDeals = await portalDeals.getDealsForPortal({ email, accountId: resolvedAccountId });
                const visibleDealIdList = (visibleDeals || []).map((d) => String(d.deal_id || "").trim()).filter(Boolean);
                const visibleDealIds = new Set(visibleDealIdList);

                console.log("[listnotifications] analytics authorization context", {
                    requestId,
                    email,
                    dealId,
                    accountId: resolvedAccountId || null,
                    canViewFirmDeals,
                    visibleDealCount: visibleDealIdList.length,
                    sampleVisibleDealIds: visibleDealIdList.slice(0, 10),
                });

                if (!visibleDealIds.has(dealId)) {
                    return sendJson(res, 403, {
                        error: "Deal is not authorized for this user.",
                        requestId,
                        endpoint,
                        details: "deal authorization failed",
                    });
                }

                analyticsAuthorized = true;
            } catch (authErr) {
                // Degrade gracefully instead of returning 500 when Analytics OAuth is unavailable.
                // In this mode we force targeted-email notifications only (no broadcasts).
                console.warn("[listnotifications] Analytics authorization unavailable; falling back to targeted-only mode", {
                    requestId,
                    email,
                    dealId,
                    accountId: resolvedAccountId || null,
                    canViewFirmDeals,
                    message: authErr?.message || String(authErr),
                });
            }
        } else {
            console.warn("[listnotifications] Analytics env missing; skipping deal authorization check", {
                requestId,
                email,
                dealId,
                accountId: null,
                canViewFirmDeals,
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
        if (analyticsAuthorized || allowBroadcastWithoutAnalytics()) {
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
            analyticsAuth: analyticsAuthorized,
            broadcastAllowedWithoutAnalytics: allowBroadcastWithoutAnalytics(),
            query,
        });

        const dbRows = await zcql.executeZCQLQuery(query);

        const mapped = (dbRows || []).map((r) => {
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

        const rows = notifications.map((n) => ({
            ...n,
            id: n?.id || n?.ID || n?.ROWID || n?.rowid || "",
            deal_id: n?.deal_id || n?.Deal_Id || n?.[COL_DEAL_ID] || dealId,
            audience_email: n?.audience_email || n?.Audience_Email || n?.[COL_AUDIENCE_EMAIL] || null,
            message: n?.message || n?.Message || "",
            created_at: n?.created_at || n?.Created_At || n?.[COL_CREATED_AT] || null,
            read_at: n?.read_at || n?.Read_At || null,
            is_read: n?.is_read || n?.Is_Read || n?.[COL_IS_READ] || false,
            type: n?.type || n?.Type || "",
            severity: n?.severity || n?.Severity || "",
        }));

        console.log("[listnotifications] ok", {
            requestId,
            dealId,
            includeRead,
            email,
            count: rows.length,
        });

        return sendJson(res, 200, {
            count: rows.length,
            rows,
            notifications: rows,
        });
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
