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

// req.user is populated by the platform, so it is the one identity the request
// itself can carry. Request headers are not: they are client-controllable and
// carry no provenance, which is what audit finding 4 confirmed in production.
function getPlatformEmail(req) {
    return String(req?.user?.email || "").trim().toLowerCase();
}

// Identity comes from platform-attested sources only: req.user, then the
// Catalyst SDK reading the caller's own session. No request header is an
// identity source, in any environment - not the x-zc-* namespace either. The
// client-supplied email is still read off the query string and compared against
// the resolved identity, so requesting someone else's address is a 403.
async function resolveEmailForRequest(req, requestedEmail, requestId) {
    const requested = String(requestedEmail || "").trim().toLowerCase();
    const platformEmail = getPlatformEmail(req);
    let resolved = platformEmail ? { email: platformEmail, source: "req.user" } : null;

    if (!resolved) {
        try {
            const viaCatalyst = await resolveCatalystUserEmail(req, requestId, "getportaldeals");
            // identitySource records the tier, not the SDK's own detailed
            // source (catalyst.currentUser.<field>).
            if (viaCatalyst?.email) resolved = { email: viaCatalyst.email, source: "sdk" };
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
        // Unresolved identity is logged above and by logIdentitySource; the client
        // gets a generic message rather than the internal reason.
        if (err?.statusCode === 401) {
            return sendJson(res, 401, {
                error: "We couldn't verify your account. Please sign in again.",
                requestId,
            });
        }
        if (err?.statusCode) {
            return sendJson(res, err.statusCode, { error: err.message, requestId });
        }
        return sendJson(res, 500, {
            error: "We couldn't load your deals. Please refresh the page. If this continues, contact your Taurus Account Manager.",
            requestId,

        });
    }
};

module.exports._internals = { getPlatformEmail, resolveEmailForRequest };
