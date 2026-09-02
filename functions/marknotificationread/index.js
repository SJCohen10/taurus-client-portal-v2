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
            return sendJson(res, 405, { error: "Method not allowed. Use POST." });
        }
        const catalyst = require("zcatalyst-sdk-node");
        const app = catalyst.initialize(req);

        const body = await parseBody(req);
        const id = String(body.id || "").trim();
        const requestedEmail = String(body.email || "").trim().toLowerCase();

        // Resolution order: direct request identity -> Catalyst SDK -> client-supplied
        // email. The SDK step is the one that actually works in this environment; the
        // client-supplied email stays last for now and is removed once the logs confirm
        // the SDK is resolving identity.
        const directEmail = portalDeals.getCallerEmail(req);
        let resolvedIdentity = directEmail ? { email: directEmail, source: "request" } : null;
        if (!resolvedIdentity) {
            const viaCatalyst = await resolveCatalystUserEmail(req, requestId, "marknotificationread");
            if (viaCatalyst) resolvedIdentity = viaCatalyst;
        }
        const callerEmail = resolvedIdentity?.email || "";
        logIdentitySource(
            "marknotificationread",
            requestId,
            resolvedIdentity?.source || (requestedEmail ? "client.requestedEmail" : "none"),
            req
        );

        if (callerEmail && requestedEmail && callerEmail !== requestedEmail) {
            return sendJson(res, 403, { error: "Requested email does not match authenticated user." });
        }

        if (!callerEmail && process.env.NODE_ENV === "production") {
            return sendJson(res, 401, { error: "Missing authenticated user email context." });
        }

        const email = callerEmail || requestedEmail;

        if (!email) return sendJson(res, 401, { error: "Missing authenticated user email context." });

        if (!id) return sendJson(res, 400, { error: "Missing id" });
        if (!/^[0-9]{1,30}$/.test(id)) return sendJson(res, 400, { error: "Invalid id" });


        const zcql = app.zcql();
        const esc = (v) => String(v).replace(/'/g, "''");
        const rows = await zcql.executeZCQLQuery(`SELECT * FROM portal_notifications WHERE ROWID='${esc(id)}' LIMIT 1`);
        const existing = (rows && rows[0] && (rows[0].portal_notifications || rows[0])) || null;
        if (!existing) return sendJson(res, 404, { error: "Notification not found" });

        const audienceEmail = String(existing.audience_email || "").trim().toLowerCase();
        if (audienceEmail && audienceEmail !== email) {
            return sendJson(res, 403, { error: "Notification is not authorized for this user." });
        }


        const table = app.datastore().table("portal_notifications");

        // UpdateRow requires id plus changed fields
        const updated = await table.updateRow({ ROWID: id, is_read: true });


        return sendJson(res, 200, { notification: updated });
    } catch (err) {
        console.error("marknotificationread error", err);
        return sendJson(res, 500, { error: "Internal error", details: err.message });
    }
};
