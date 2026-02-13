"use strict";

const { URL } = require("url");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_ID_REGEX = /^[A-Za-z0-9_-]{6,100}$/;

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
        const escapedEmail = email.replace(/'/g, "\\'");
        criteriaParts.push(`"Contact_Email"='${escapedEmail}'`);
    }
    if (accountId) {
        const escapedAccountId = accountId.replace(/'/g, "\\'");
        criteriaParts.push(`"Account_Id"='${escapedAccountId}'`);
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



    const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
    });

    const text = await res.text();


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


    function parseNumber(val) {
        if (val === undefined || val === null || val === "") return null;
        const numeric = Number(String(val).replace(/[^0-9.-]/g, ""));
        return Number.isNaN(numeric) ? null : numeric;
    }


    // Map into a clean shape for the frontend based on your columns:
    // "Property Ref Number","Property Description","Created time","Paralegal","Contact_Email"
    return rows.map((row) => {

        const assetId =
            row["Asset Id"] ||
            row["Asset_Id"] ||
            row["Asset ID"] ||
            row["asset_id"] ||
            null;

        const assetCreatorId =
            row["Asset Creator ID"] ||
            row["Asset_Creator_ID"] ||
            row["Asset Creator Id"] ||
            null;

        const sellerAccountId =
            row["Seller_Account_Id"] || null;


        const accountId =
            row["Account_Id"] || row["Account Id"] || row["Account_ID"] || null;

        const propertyFolderId =
            row["Property Folder Id"] ||
            row["Property_Folder_Id"] ||
            row["Property Folder"] ||
            null;

        const assetIds =
            row["Asset IDs"] || row["Asset_IDs"] || row["Asset Ids"] || null;

        const assetCreatorIds =
            row["Asset Creator IDs"] || row["Asset_Creator_IDs"] || null;

        const currentBalance = parseNumber(row["Current Balance"]);
        const upsellAvailable = parseNumber(row["Upsell Available"]);


        return {
            property_ref_number: row["Property Ref Number"] || null,
            property_description: row["Property Description"] || null,
            created_time: row["Created time"] || null,
            contact_email: row["Contact_Email"] || null,
            status: row["Status"] || null,
            amount: parseNumber(row["Amount"]),
            current_balance: currentBalance,
            upsell_available: upsellAvailable,
            lodged: row["Lodged"] || null,
            registered: row["Registered"] || null,
            asset_id: assetId,
            asset_creator_id: assetCreatorId,
            account_id: accountId,
            property_folder_id: propertyFolderId,
            asset_ids: assetIds,
            asset_creator_ids: assetCreatorIds,
            seller_account_id: sellerAccountId,
            deal_id: row["Deal_Id"] || null,
            expectedLodgementDate: row["Expected_Lodgement_Date"] || null,
        };

    });

}

/**
 * Entry point:
 *   GET /server/getportaldeals?email=...&accountId=...
 */
module.exports = async (req, res) => {
    try {
        const parsedUrl = new URL(req.url, "http://dummy-host");
        const email = (parsedUrl.searchParams.get("email") || "").trim().toLowerCase();
        const accountId = (parsedUrl.searchParams.get("accountId") || "").trim();



        if (!email && !accountId) {
            return sendJson(res, 400, {
                error: "Missing 'email' or 'accountId' query parameter.",
            });
        }

        if (email && !EMAIL_REGEX.test(email)) {
            return sendJson(res, 400, {
                error: "Invalid email query parameter.",
            });
        }

        if (accountId && !ACCOUNT_ID_REGEX.test(accountId)) {
            return sendJson(res, 400, {
                error: "Invalid accountId query parameter.",
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

        });
    }
};
