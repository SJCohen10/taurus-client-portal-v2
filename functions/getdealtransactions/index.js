"use strict";

const { URL } = require("url");
const fetch = require("node-fetch");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}


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

    const data = raw ? JSON.parse(raw) : {};
    if (!data.access_token) {
        throw new Error("No access token returned by Zoho CRM OAuth token endpoint.");
    }
    return {
        accessToken: data.access_token,
        apiDomain: process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com",
    };
}


function parseAssetIds(raw) {
    if (!raw) return [];
    const ids = String(raw)
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^[0-9]+$/.test(value));

    return Array.from(new Set(ids)).slice(0, 50);
}

function validateEmail(email) {
    return EMAIL_REGEX.test(email);
}


async function runCoql({ accessToken, crmBase, query }) {
    const coqlUrl = `${crmBase}/coql`;

    const response = await fetch(coqlUrl, {
        method: "POST",
        headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ select_query: query }),
    });
    const raw = await response.text();
    if (!response.ok) {
        throw new Error(`Zoho CRM COQL error (${response.status}): ${raw}`);
    }
    const json = raw ? JSON.parse(raw) : {};
    return json.data || [];
}


async function getTransactions({ assetIds }) {
    const { accessToken, apiDomain } = await getAccessToken();
    const crmVersion = process.env.ZOHO_CRM_VERSION || "v6";
    const crmBase = `${apiDomain}/crm/${crmVersion}`;

    const inList = assetIds.map((id) => `'${id}'`).join(",");
    const query = `select id, Name, Transaction_Type, Current_Advance_Amount, Asset from Transactions where Asset in (${inList})`;

    return runCoql({ accessToken, crmBase, query });
}


module.exports = async (req, res) => {
    try {
        const parsedUrl = new URL(req.url, "http://dummy-host");
        const email = (parsedUrl.searchParams.get("email") || "").trim();
        const rawAssetIds = parsedUrl.searchParams.get("assetIds") || "";

        if (!email || !validateEmail(email)) {
            return sendJson(res, 400, {
                error: "Missing or invalid 'email' query parameter.",
            });
        }

        const assetIds = parseAssetIds(rawAssetIds);
        if (!assetIds.length) {
            return sendJson(res, 400, {
                error: "No valid assetIds provided. Use comma-separated numeric CRM Asset IDs.",
            });
        }

        const rows = await getTransactions({ assetIds });

        const transactions = rows.map((record) => ({
            id: record.id || null,
            name: record.Name || "",
            type: record.Transaction_Type || "",
            advance_amount: record.Current_Advance_Amount ?? null,
            asset_id: record.Asset?.id || null,
        }));

        return sendJson(res, 200, {
            assetIds,
            count: transactions.length,
            transactions,
        });
    } catch (err) {
        console.error("getdealtransactions error:", err);
        return sendJson(res, 500, {
            error: "Internal server error in getdealtransactions.",
            details: err.message,
        });
    }
};