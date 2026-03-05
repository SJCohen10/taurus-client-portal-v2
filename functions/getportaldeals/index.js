"use strict";

const { URL } = require("url");
const fetch = global.fetch || require("node-fetch");
const analyticsTokenManager = require("./lib/analyticsTokenManager");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_ID_REGEX = /^[A-Za-z0-9_-]{6,100}$/;


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
 * Get a fresh Zoho Analytics access token using the dedicated
 * Analytics OAuth client + refresh token.
 */
/**
 * CSV parser with quoted-field support:
 * - handles commas/newlines inside quoted values
 * - handles escaped double quotes ("")
 */
function parseCsv(text) {
    const rows = [];
    let current = "";
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];

        if (ch === '"') {
            if (inQuotes && text[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === ',' && !inQuotes) {
            row.push(current);
            current = "";
            continue;
        }

        if ((ch === "\n" || ch === "\r") && !inQuotes) {
            if (ch === "\r" && text[i + 1] === "\n") i += 1;
            row.push(current);
            current = "";
            if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
            row = [];
            continue;
        }

        current += ch;
    }

    if (current.length || row.length) {
        row.push(current);
        if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
    }

    if (!rows.length) return [];

    const headers = rows[0].map((h) => String(h || "").trim());
    return rows.slice(1).map((values) => {
        const obj = {};
        headers.forEach((h, idx) => {
            obj[h] = (values[idx] || "").trim();
        });
        return obj;
    });
}

/**
 * Fetch deals for the portal from Zoho Analytics using CSV export.
 */
async function getDealsForPortal({ email, accountId, requestId }) {
    const accessToken = await analyticsTokenManager.getAccessToken({ requestId });

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

        const seller = row["Seller"] || row["seller"] || row["Seller Name"] || null;

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
            seller,
        };

    });

}

/**
 * Entry point:
 *   GET /server/getportaldeals?email=...&accountId=...
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
        const accountId = (parsedUrl.searchParams.get("accountId") || "").trim();



        if (!email && !accountId) {
            return sendJson(res, 400, {
                error: "Missing 'email' or 'accountId' query parameter.",
                requestId,
            });
        }

        if (email && !EMAIL_REGEX.test(email)) {
            return sendJson(res, 400, {
                error: "Invalid email query parameter.",
                requestId,
            });
        }

        if (accountId && !ACCOUNT_ID_REGEX.test(accountId)) {
            return sendJson(res, 400, {
                error: "Invalid accountId query parameter.",
                requestId,
            });
        }

        const deals = await getDealsForPortal({ email, accountId, requestId });

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

module.exports._internals = { getDealsForPortal, getCallerEmail, resolveEmailForRequest };
