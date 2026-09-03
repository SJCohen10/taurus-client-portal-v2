"use strict";

const { URL } = require("url");
const { getDealsForPortal } = require("./lib/portalDeals");
const { fetchPendingDealsFromCrm } = require("./lib/crmPendingDeals");
const { resolveCatalystUserEmail, logIdentitySource } = require("./lib/catalystIdentity");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Merge freshly-submitted CRM deals into the Analytics list, Analytics-first:
// when a deal_id exists in both, the richer Analytics row wins and the synthetic
// pending row is dropped.
function mergeDealsAnalyticsFirst(analyticsDeals, pendingDeals) {
    const seen = new Set();
    const merged = [];
    for (const deal of analyticsDeals || []) {
        const id = String(deal?.deal_id || "").trim();
        if (id) seen.add(id);
        merged.push(deal);
    }
    for (const deal of pendingDeals || []) {
        const id = String(deal?.deal_id || "").trim();
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        merged.push(deal);
    }
    return merged;
}


function createRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

// Identity comes from the platform only: req.user, the x-zc-* namespace, or the
// Catalyst SDK. A client-supplied email is never an identity source, in any
// environment. It is still read off the query string and compared against the
// resolved identity, so requesting someone else's address is a 403.
async function resolveEmailForRequest(req, requestedEmail, requestId) {
    const requested = String(requestedEmail || "").trim().toLowerCase();
    const callerEmail = getCallerEmail(req);
    let resolved = callerEmail ? { email: callerEmail, source: "request" } : null;

    if (!resolved) {
        try {
            const viaCatalyst = await resolveCatalystUserEmail(req, requestId, "getportaldeals");
            if (viaCatalyst) resolved = viaCatalyst;
        } catch (err) {
            logIdentitySource("getportaldeals", requestId, "none", req);
            throw err;
        }
    }

    if (!resolved) {
        logIdentitySource("getportaldeals", requestId, "none", req);
        const err = new Error("Missing authenticated user context");
        err.statusCode = 401;
        throw err;
    }

    logIdentitySource("getportaldeals", requestId, resolved.source, req);

    if (requested && resolved.email !== requested) {
        const err = new Error("Requested email does not match authenticated user");
        err.statusCode = 403;
        throw err;
    }

    return resolved.email;
}

// Helper to send JSON responses
function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

/**
 * Entry point:
 *   GET /server/getportaldeals?email=...
 */
module.exports = async (req, res) => {
    const requestId = createRequestId();
    try {
        if (req.method !== "GET") {
            return sendJson(res, 405, { error: "That request couldn't be completed.", requestId });
        }

        const parsedUrl = new URL(req.url, "http://dummy-host");
        const requestedEmail = (parsedUrl.searchParams.get("email") || "").trim().toLowerCase();
        const email = await resolveEmailForRequest(req, requestedEmail, requestId);
        if (!email) {
            return sendJson(res, 400, {
                error: "We couldn't verify your account. Please sign in again.",
                requestId,
            });
        }

        if (email && !EMAIL_REGEX.test(email)) {
            return sendJson(res, 400, {
                error: "We couldn't verify your account. Please sign in again.",
                requestId,
            });
        }

        const [deals, pendingDeals] = await Promise.all([
            getDealsForPortal({ email, requestId }),
            fetchPendingDealsFromCrm({ email, requestId }).catch((err) => {
                console.warn("getportaldeals pending CRM merge skipped", {
                    requestId,
                    message: err?.message || String(err),
                    statusCode: err?.statusCode,
                    body: err?.body,
                    query: err?.query,
                });
                return [];
            }),
        ]);

        const merged = mergeDealsAnalyticsFirst(deals, pendingDeals);

        return sendJson(res, 200, {
            count: merged.length,
            deals: merged,
            pendingCount: pendingDeals.length,
            requestId,
        });
    } catch (err) {
        console.error("Error in getportaldeals:", { requestId, message: err?.message || String(err), details: err?.details || null });
        if (err?.statusCode) {
            return sendJson(res, err.statusCode, { error: err.message, requestId });
        }
        return sendJson(res, 500, {
            error: "We couldn't load your deals. Please refresh the page. If this continues, contact your Taurus Account Manager.",
            requestId,

        });
    }
};

module.exports._internals = { getCallerEmail, resolveEmailForRequest };
