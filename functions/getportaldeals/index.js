"use strict";

const { URL } = require("url");
const { getDealsForPortal } = require("../lib/portalDeals");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


function createRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function resolveEmailForRequest(req, requestedEmail) {
    const callerEmail = getCallerEmail(req);
    const requested = String(requestedEmail || "").trim().toLowerCase();

    if (callerEmail && requested && callerEmail !== requested) {
        const err = new Error("Requested email does not match authenticated user");
        err.statusCode = 403;
        throw err;
    }

    if (callerEmail) return callerEmail;

    if (process.env.NODE_ENV === "production") {
        const err = new Error("Missing authenticated user context");
        err.statusCode = 401;
        throw err;
    }

    return requested;
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
            return sendJson(res, 405, { error: "Method not allowed. Use GET.", requestId });
        }

        const parsedUrl = new URL(req.url, "http://dummy-host");
        const requestedEmail = (parsedUrl.searchParams.get("email") || "").trim().toLowerCase();
        const email = resolveEmailForRequest(req, requestedEmail);
        if (!email) {
            return sendJson(res, 400, {
                error: "Missing 'email' query parameter.",
                requestId,
            });
        }

        if (email && !EMAIL_REGEX.test(email)) {
            return sendJson(res, 400, {
                error: "Invalid email query parameter.",
                requestId,
            });
        }

        const deals = await getDealsForPortal({ email, requestId });

        return sendJson(res, 200, {
            count: deals.length,
            deals,
            requestId,
        });
    } catch (err) {
        console.error("Error in getportaldeals:", { requestId, message: err?.message || String(err), details: err?.details || null });
        if (err?.statusCode) {
            return sendJson(res, err.statusCode, { error: err.message, requestId });
        }
        return sendJson(res, 500, {
            error: "Internal server error in getportaldeals.",
            requestId,

        });
    }
};

module.exports._internals = { getCallerEmail, resolveEmailForRequest };
