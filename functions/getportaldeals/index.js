"use strict";

const { URL } = require("url");

// Helper to send JSON responses
function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

/**
 * Get a fresh Zoho Analytics access token using the dedicated
 * Analytics OAuth client + refresh token.
 */
async function getAnalyticsAccessToken() {
    const clientId = process.env.ZOHO_ANALYTICS_CLIENT_ID;
    const clientSecret = process.env.ZOHO_ANALYTICS_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_ANALYTICS_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
            "Missing Zoho Analytics OAuth env vars: ZOHO_ANALYTICS_CLIENT_ID, ZOHO_ANALYTICS_CLIENT_SECRET, ZOHO_ANALYTICS_REFRESH_TOKEN"
        );
    }

    const params = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
    });

    const tokenUrl = "https://accounts.zoho.com/oauth/v2/token";

    const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(
            `Failed to parse Analytics token response (${res.status}): ${text}`
        );
    }

    if (!res.ok || !data.access_token) {
        throw new Error(
            `Failed to get Analytics access token (${res.status}): ${data.error || text
            }`
        );
    }

    return data.access_token;
}

/**
 * Very simple CSV parser:
 * - splits lines on newline
 * - splits columns on comma
 * - strips surrounding double-quotes
 * Assumes your data does NOT contain commas inside values.
 */
function parseCsv(text) {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    if (lines.length < 2) {
        return [];
    }

    const stripQuotes = (s) =>
        s.replace(/^"(.*)"$/, "$1"); // remove surrounding quotes if present

    const headers = lines[0].split(",").map(stripQuotes);

    const rows = lines.slice(1).map((line) => {
        const values = line.split(",");
        const obj = {};
        headers.forEach((h, idx) => {
            const raw = values[idx] || "";
            obj[h] = stripQuotes(raw);
        });
        return obj;
    });

    return rows;
}

/**
 * Fetch deals for the portal from Zoho Analytics using CSV export.
 */
async function getDealsForPortal({ email, accountId }) {
    const accessToken = await getAnalyticsAccessToken();

    const base =
        process.env.ZOHO_ANALYTICS_BASE || "https://analyticsapi.zoho.com/api";
    const owner = process.env.ZOHO_ANALYTICS_OWNER;
    const db = process.env.ZOHO_ANALYTICS_DB;
    const table =
        process.env.ZOHO_ANALYTICS_PORTAL_DEALS_TABLE || "Portal_Deals_View";

    if (!owner || !db) {
        throw new Error(
            "Missing Analytics env vars: ZOHO_ANALYTICS_OWNER, ZOHO_ANALYTICS_DB"
        );
    }

    // Build criteria based on email/accountId
    const criteriaParts = [];
    if (email) {
        criteriaParts.push(`"Contact_Email"='${email}'`);
    }
    if (accountId) {
        criteriaParts.push(`"Account_Id"='${accountId}'`);
    }
    const criteria = criteriaParts.length ? criteriaParts.join(" OR ") : "1=0";

    const url = new URL(
        `${base}/${encodeURIComponent(owner)}/${encodeURIComponent(
            db
        )}/${encodeURIComponent(table)}`
    );

    // v1 EXPORT API params – ask for CSV instead of JSON
    url.searchParams.set("ZOHO_ACTION", "EXPORT");
    url.searchParams.set("ZOHO_OUTPUT_FORMAT", "CSV");
    url.searchParams.set("ZOHO_ERROR_FORMAT", "JSON");
    url.searchParams.set("ZOHO_API_VERSION", "1.0");
    url.searchParams.set("ZOHO_CRITERIA", criteria);

    console.log("Calling Zoho Analytics EXPORT API (CSV):", url.toString());

    const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
    });

    const text = await res.text();
    console.log("Analytics raw CSV response:", text);

    // If Analytics returned JSON error instead of CSV, detect it
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
        // Looks like JSON – try to parse and surface error
        try {
            const errJson = JSON.parse(trimmed);
            if (errJson.response && errJson.response.error) {
                const err = errJson.response.error;
                throw new Error(
                    `Zoho Analytics error ${err.code || ""}: ${err.message || ""}`
                );
            } else {
                throw new Error(
                    `Unexpected JSON response from Analytics: ${trimmed}`
                );
            }
        } catch (e) {
            throw new Error(
                `Zoho Analytics returned JSON but parsing failed: ${e.message}; raw=${trimmed}`
            );
        }
    }

    // Otherwise treat as CSV
    const rows = parseCsv(text);

    // Map into a clean shape for the frontend based on your columns:
    // "Property Ref Number","Created time","Paralegal","Contact_Email"
    return rows.map((row) => ({
        property_ref_number: row["Property Ref Number"] || null,
        created_time: row["Created time"] || null,
        paralegal_name: row["Paralegal"] || null,
        contact_email: row["Contact_Email"] || null,
    }));
}

/**
 * Entry point:
 *   GET /server/getportaldeals?email=...&accountId=...
 */
module.exports = async (req, res) => {
    try {
        const parsedUrl = new URL(req.url, "http://dummy-host");
        const email = parsedUrl.searchParams.get("email") || "";
        const accountId = parsedUrl.searchParams.get("accountId") || "";

        console.log("getportaldeals called with:", { email, accountId });

        if (!email && !accountId) {
            return sendJson(res, 400, {
                error: "Missing 'email' or 'accountId' query parameter.",
            });
        }

        const deals = await getDealsForPortal({ email, accountId });

        return sendJson(res, 200, {
            count: deals.length,
            deals,
        });
    } catch (err) {
        console.error("Error in getportaldeals:", err);
        return sendJson(res, 500, {
            error: "Internal server error in getportaldeals.",
            details: err.message,
        });
    }
};
