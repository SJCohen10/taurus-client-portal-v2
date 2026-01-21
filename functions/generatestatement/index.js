"use strict";

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}


const { URLSearchParams } = require("url");

let _fetch = typeof fetch === "function" ? fetch : null;

async function getFetch() {
    if (_fetch) return _fetch;

    // Fallback to node-fetch only if present
    const mod = await import("node-fetch");
    _fetch = mod.default;
    return _fetch;
}



function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
        });
        req.on("end", () => {
            try {
                const parsed = data ? JSON.parse(data) : {};
                resolve(parsed);
            } catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}

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

    const accountsBase = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
    const tokenUrl = `${accountsBase}/oauth/v2/token`;
    const fetchFn = await getFetch();
    const res = await fetchFn(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error(
            `Failed to parse access token response (${res.status}): ${text}`
        );
    }

    if (!res.ok || !data.access_token) {
        throw new Error(
            `Failed to get access token (${res.status}): ${data.error || text}`
        );
    }

    return data.access_token;
}

function getCrmBase() {
    const apiDomain = process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com";
    const crmVersion = process.env.ZOHO_CRM_VERSION || "v6";
    return `${apiDomain}/crm/${crmVersion}`;
}

async function fetchAsset(accessToken, assetId) {
    const crmBase = getCrmBase();
    const url = `${crmBase}/Assets/${assetId}`;
    const fetchFn = await getFetch();
    const res = await fetchFn(url, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { }

    if (!res.ok) {
        throw new Error(
            `Failed to fetch CRM Asset ${assetId}: ${data?.message || raw || res.status}`
        );
    }

    return (data.data && data.data[0]) || {};
}

async function fetchTransactions(accessToken, assetId) {
    const crmBase = getCrmBase();
    const url = `${crmBase}/Assets/${assetId}/Transactions`;

    const res = await fetch(url, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { }

    if (!res.ok) {
        throw new Error(
            `Failed to fetch related Transactions for Asset ${assetId}: ${data?.message || raw || res.status}`
        );
    }

    return data.data || [];
}


function pickStatementPage({ transactionTypes }) {
    const lowerTypes = transactionTypes.map((t) => (t || "").toLowerCase());

    if (lowerTypes.includes("rafpay")) return "RAFPAY_Statements";
    if (lowerTypes.includes("aa")) return "AA_Statements";
    if (lowerTypes.includes("seller") || lowerTypes.includes("quick-rates"))
        return "Seller_Statements";
    if (lowerTypes.includes("agent")) return "Agent_Statements";
    if (lowerTypes.includes("agency")) return "Agency_Statements";
    if (lowerTypes.includes("bond")) return "Bond_Statements";
    if (lowerTypes.includes("lwb")) return "LWB_Statements";

    return null;
}

function buildCreatorUrl(pageName, assetId) {
    const base =
        process.env.ZOHO_CREATOR_STATEMENT_BASE ||
        "https://creatorapp.zoho.com/administrator_tauruscapital/loan-management-system/#Page";

    return `${base}:${pageName}?CrmAssetId=${assetId}`;
}

module.exports = async (req, res) => {
    try {
        if (req.method !== "POST") {
            return sendJson(res, 405, {
                error: "Method not allowed. Use POST.",
            });
        }

        const body = await readJsonBody(req);
        const assetId = body.assetId || body.AssetId;

        if (!assetId) {
            return sendJson(res, 400, {
                error: "Missing assetId in request body.",
            });
        }

        const accessToken = await getAccessToken();
        const asset = await fetchAsset(accessToken, assetId);
        const transactions = await fetchTransactions(accessToken, assetId);

        const transactionTypes = transactions.map(
            (t) => t.Transaction_Type || t.transaction_type || ""
        );

        const statementPage = pickStatementPage({ transactionTypes });

        const statementUrl = statementPage
            ? buildCreatorUrl(statementPage, assetId)
            : null;

        return sendJson(res, 200, {
            message: statementUrl
                ? "Statement URL generated via Creator."
                : "No matching statement page found for this asset.",
            statementUrl,
            asset: {
                id: assetId,
                type: asset.Asset_Type || asset.asset_type || null,
                creatorId: asset.Asset_Creator_ID || asset.asset_creator_id || null,
            },
            transactionTypes,
        });
    } catch (err) {
        console.error("Error in generatestatement:", err);
        return sendJson(res, 500, {
            error: "Internal server error in generatestatement.",
            details: err.message,
        });
    }
};