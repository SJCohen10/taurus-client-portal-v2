"use strict";

const { URL } = require("url");
const fetch = require("node-fetch");

// Small helper
function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

// Reuse the OAuth token fetch (could be moved to a shared util later)
async function getAccessToken() {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
            "Missing Zoho OAuth environment variables: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN"
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

    if (!res.ok) {
        const text = await res.text();
        throw new Error(
            `Failed to get access token (${res.status}): ${text || "No response body"}`
        );
    }

    const data = await res.json();
    if (!data.access_token) {
        throw new Error("No access_token returned by Zoho");
    }

    return data.access_token;
}

/**
 * Fetch deals for the portal from Zoho Analytics.
 * 
 * Strategy:
 * - You create a table/view in Zoho Analytics, e.g. `Portal_Deals_View`
 * - It already joins Deals + Accounts + Contacts, filters out irrelevant stuff, etc.
 * - We call its Reports API with a filter on contact email and/or account id.
 */
async function getDealsForPortal({ email, accountId }) {
    const accessToken = await getAccessToken();

    // TODO: adjust these for your actual Analytics setup
    const analyticsBase =
        process.env.ZOHO_ANALYTICS_BASE ||
        "https://analyticsapi.zoho.com/api";
    const analyticsOwner = process.env.ZOHO_ANALYTICS_OWNER; // e.g. "you@yourdomain.com"
    const analyticsDb = process.env.ZOHO_ANALYTICS_DB;       // e.g. "Taurus_Production"
    const analyticsTable = process.env.ZOHO_ANALYTICS_PORTAL_DEALS_TABLE || "Portal_Deals_View";

    if (!analyticsOwner || !analyticsDb) {
        throw new Error(
            "Missing Analytics env vars: ZOHO_ANALYTICS_OWNER, ZOHO_ANALYTICS_DB"
        );
    }

    // Basic filter: deals where Contact_Email = email OR Account_Id = accountId
    // You can tighten this once you know exactly how the view is structured.
    const criteriaParts = [];
    if (email) {
        criteriaParts.push(`"Contact_Email"='${email}'`);
    }
    if (accountId) {
        criteriaParts.push(`"Account_Id"='${accountId}'`);
    }
    const criteria = criteriaParts.join(" OR ") || "1=0"; // no criteria => no rows

    const url = new URL(
        `${analyticsBase}/${encodeURIComponent(
            analyticsOwner
        )}/${encodeURIComponent(analyticsDb)}/tables/${encodeURIComponent(
            analyticsTable
        )}/data`
    );
    url.searchParams.set("ZOHO_CRITERIA", criteria);
    url.searchParams.set("ZOHO_OUTPUT_FORMAT", "JSON");
    url.searchParams.set("ZOHO_ERROR_FORMAT", "JSON");
    url.searchParams.set("ZOHO_SELECTED_COLUMNS", "All"); // or specify
    url.searchParams.set("ZOHO_LIMIT", "200"); // pagination later if needed

    const res = await fetch(url.toString(), {
        headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(
            `Zoho Analytics deals fetch failed (${res.status}): ${text || "No response body"
            }`
        );
    }

    const data = await res.json();

    // Shape this into a simple array of deals for the frontend
    const rows = data.data || data.rows || [];
    return rows.map((row) => {
        return {
            deal_id: row.Deal_Id || row.Deal_ID || row.id,
            deal_name: row.Deal_Name || row.Name,
            stage: row.Stage || row.Deal_Stage,
            status: row.Status || null,
            amount: row.Amount || row.Deal_Amount || null,
            product: row.Product || row.Product_Type || null,
            account_name: row.Account_Name || row.Firm_Name || null,
            contact_name: row.Contact_Name || null,
            created_time: row.Created_Time || row.Created_At || null,
            // Add whatever fields you expose in Portal_Deals_View
        };
    });
}

/**
 * Function Entry Point
 * GET /server/getportaldeals?email=...&accountId=...
 */
module.exports = async (req, res) => {
    try {
        const parsedUrl = new URL(req.url, "http://dummy-host");
        const email = parsedUrl.searchParams.get("email") || "";
        const accountId = parsedUrl.searchParams.get("accountId") || "";

        if (!email && !accountId) {
            return sendJson(res, 400, {
                error: "Missing 'email' or 'accountId' parameter.",
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
