"use strict";

const portalDeals = require("./lib/portalDeals");
const { resolveCatalystUserEmail, logIdentitySource } = require("./lib/catalystIdentity");

function createRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
}

async function parseBody(req) {
    if (req.body == null) {
        // Some Catalyst runtimes don't pre-populate req.body for custom functions.
        // Fall back to reading the raw request stream.
        const raw = await new Promise((resolve) => {
            const chunks = [];
            req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            req.on("error", () => resolve(""));
        });

        if (!raw) return {};
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    // Catalyst / Node may provide Buffer
    if (Buffer.isBuffer(req.body)) {
        try {
            return JSON.parse(req.body.toString("utf8"));
        } catch {
            return {};
        }
    }

    // If already parsed
    if (typeof req.body === "object") return req.body;

    // If string
    if (typeof req.body === "string") {
        try {
            return JSON.parse(req.body);
        } catch {
            return {};
        }
    }

    return {};
}


module.exports = async (req, res) => {
    const requestId = createRequestId();

    try {
        if (req.method !== "POST") {
            return sendJson(res, 405, { error: "That request couldn't be completed." });
        }
        const catalyst = require("zcatalyst-sdk-node");
        const app = catalyst.initialize(req);

        const body = await parseBody(req);
        const id = String(body.id || "").trim();
        const requestedEmail = String(body.email || "").trim().toLowerCase();

        // Identity comes from the platform only: req.user, the x-zc-* namespace, or
        // the Catalyst SDK. A client-supplied email is never an identity source, in
        // any environment. It is still read off the body and compared against the
        // resolved identity, so sending someone else's address is a 403.
        const directEmail = portalDeals.getCallerEmail(req);
        let resolvedIdentity = directEmail ? { email: directEmail, source: "request" } : null;
        if (!resolvedIdentity) {
            try {
                const viaCatalyst = await resolveCatalystUserEmail(req, requestId, "marknotificationread");
                if (viaCatalyst) resolvedIdentity = viaCatalyst;
            } catch (err) {
                logIdentitySource("marknotificationread", requestId, "none", req);
                return sendJson(res, 401, { error: "We couldn't verify your account. Please sign in again." });
            }
        }
        logIdentitySource("marknotificationread", requestId, resolvedIdentity?.source || "none", req);

        if (!resolvedIdentity) {
            return sendJson(res, 401, { error: "We couldn't verify your account. Please sign in again." });
        }

        const email = resolvedIdentity.email;

        if (requestedEmail && email !== requestedEmail) {
            return sendJson(res, 403, { error: "We couldn't verify your account. Please sign in again." });
        }

        if (!id) return sendJson(res, 400, { error: "We couldn't identify that notification. Please refresh the page. If this continues, contact your Taurus Account Manager." });
        if (!/^[0-9]{1,30}$/.test(id)) return sendJson(res, 400, { error: "We couldn't identify that notification. Please refresh the page. If this continues, contact your Taurus Account Manager." });


        const zcql = app.zcql();
        const esc = (v) => String(v).replace(/'/g, "''");
        const rows = await zcql.executeZCQLQuery(`SELECT * FROM portal_notifications WHERE ROWID='${esc(id)}' LIMIT 1`);
        const existing = (rows && rows[0] && (rows[0].portal_notifications || rows[0])) || null;
        if (!existing) return sendJson(res, 404, { error: "We couldn't find that notification. Please refresh the page. If this continues, contact your Taurus Account Manager." });

        const audienceEmail = String(existing.audience_email || "").trim().toLowerCase();
        if (audienceEmail && audienceEmail !== email) {
            return sendJson(res, 403, { error: "You don't have access to that notification. Please contact your Taurus Account Manager." });
        }


        const table = app.datastore().table("portal_notifications");

        // UpdateRow requires id plus changed fields
        const updated = await table.updateRow({ ROWID: id, is_read: true });


        return sendJson(res, 200, { notification: updated });
    } catch (err) {
        console.error("marknotificationread error", err);
        return sendJson(res, 500, { error: "We couldn't update that notification. Please contact your Taurus Account Manager.", requestId });
    }
};
