"use strict";

const { URL } = require("url");
const fetch = require("node-fetch");

/**
 * Send JSON response
 */
function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

/**
 * Get Zoho CRM access token via refresh token
 */
async function getAccessToken() {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
            "Missing Zoho CRM OAuth env vars: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN"
        );
    }

    const params = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
    });

    const accountsBase = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
    const tokenUrl = `${accountsBase}/oauth/v2/token`;

    const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    const raw = await res.text();
    if (!res.ok) {
        throw new Error(`Failed to fetch Zoho access token (${res.status}): ${raw}`);
    }

    const data = JSON.parse(raw);
    return {
        accessToken: data.access_token,
        apiDomain: process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com",
    };
}

/**
 * Parse incoming assetIds query param
 */
function parseAssetIds(raw) {
    if (!raw) return [];
    const parts = String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[0-9]+$/.test(s)); // numeric only
    return Array.from(new Set(parts)).slice(0, 50); // dedupe + limit 50
}

/**
 * Run COQL query
 */
async function runCoql({ accessToken, crmBase, query }) {
    const url = `${crmBase}/coql`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ select_query: query }),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`COQL error (${res.status}): ${text}`);
    }
    const json = JSON.parse(text);
    return json.data || [];
}

/**
 * Get transactions from CRM given assetIds
 */
async function getTransactions({ assetIds }) {
    const { accessToken, apiDomain } = await getAccessToken();
    const crmVersion = process.env.ZOHO_CRM_VERSION || "v6";
    const crmBase = `${apiDomain}/crm/${crmVersion}`;

    const inList = assetIds.map((id) => `'${id}'`).join(",");
    const query = `
    select id, Name, Transaction_Type, Current_Advance_Amount, Asset
    from Transactions
    where Asset in (${inList})
  `;

    return runCoql({ accessToken, crmBase, query });
}

/**
 * Entry point
 */
module.exports = async (req, res) => {
    try {
        const parsedUrl = new URL(req.url, "http://dummy");
        const email = (parsedUrl.searchParams.get("email") || "").trim();
        const rawAssetIds = parsedUrl.searchParams.get("assetIds") || "";

        if (!email) return sendJson(res, 400, { error: "Missing 'email' param" });

        const assetIds = parseAssetIds(rawAssetIds);
        if (!assetIds.length) {
            return sendJson(res, 400, {
                error:
                    "No valid assetIds provided. Must be comma-separated numeric Zoho IDs.",
            });
        }

        const rows = await getTransactions({ assetIds });

        const transactions = rows.map((t) => ({
            id: t.id,
            name: t.Name,
            type: t.Transaction_Type,
            advance_amount: t.Current_Advance_Amount,
            asset_id: t.Asset?.id || null,
        }));

        return sendJson(res, 200, {
            assetIds,
            count: transactions.length,
            transactions,
        });
    } catch (err) {
        console.error("getdealtransactions error:", err);
        sendJson(res, 500, { error: err.message });
    }
};
