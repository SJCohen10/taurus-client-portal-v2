"use strict";

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
    try {
        if (req.method !== "GET") {
            return sendJson(res, 405, { error: "Method not allowed. Use GET." });
        }
        const catalyst = require("zcatalyst-sdk-node");
        const app = catalyst.initialize(req);

        const parsedUrl = new URL(req.url, "http://dummy-host");
        const dealId = String(
            req.query?.dealId || req.params?.dealId || parsedUrl.searchParams.get("dealId") || ""
        ).trim();
        const email = String(
            req.query?.email || req.params?.email || parsedUrl.searchParams.get("email") || ""
        ).trim().toLowerCase();
        const includeRead = String(
            req.query?.includeRead || req.params?.includeRead || parsedUrl.searchParams.get("includeRead") || "false"
        ) === "true";

        if (!dealId) {
            return sendJson(res, 400, { error: "Missing dealId" });
        }

        if (!/^[0-9]{6,30}$/.test(dealId)) {
            return sendJson(res, 400, { error: "Invalid dealId" });
        }

        const zcql = app.zcql();

        // escape quotes for ZCQL
        const esc = (s) => String(s).replace(/'/g, "''");

        let query = `SELECT * FROM portal_notifications WHERE deal_id='${esc(dealId)}'`;

        if (email) {
            query += ` AND (audience_email='${esc(email)}' OR audience_email IS NULL)`;
        }

        if (!includeRead) {
            query += ` AND (is_read=false OR is_read IS NULL)`;
        }

        query += ` ORDER BY created_at DESC`;

        const rows = await zcql.executeZCQLQuery(query);
        const notifications = (rows || []).map((r) => r.portal_notifications || r);

        return sendJson(res, 200, { notifications });
    } catch (err) {
        console.error("listnotifications error", err);
        return sendJson(res, 500, { error: "Internal error", details: err.message });
    }
};
