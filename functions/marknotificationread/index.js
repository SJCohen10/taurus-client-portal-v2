"use strict";

function sendJson(res, statusCode, payload) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
}

function parseBody(req) {
    if (req.body == null) return {};

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
    try {
        const catalyst = require("zcatalyst-sdk-node");
        const app = catalyst.initialize(req);

        const body = parseBody(req);
        const id = String(body.id || "").trim();

        if (!id) return sendJson(res, 400, { error: "Missing id" });

        const table = app.datastore().table("portal_notifications");

        // UpdateRow requires id plus changed fields
        const updated = await table.updateRow({ ROWID: id, is_read: true });


        return sendJson(res, 200, { notification: updated });
    } catch (err) {
        console.error("marknotificationread error", err);
        return sendJson(res, 500, { error: "Internal error", details: err.message });
    }
};
