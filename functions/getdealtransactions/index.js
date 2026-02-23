"use strict";

const { URL } = require("url");
const portalDeals = require("./lib/portalDeals");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

function safeJsonParse(raw) {
    try {
        return raw ? JSON.parse(raw) : {};
    } catch {
        return { _raw: raw };
    }
}

function shortError(message) {
    return String(message || "Unknown error").slice(0, 220);
}

async function getAccessToken() {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("Missing Zoho CRM OAuth env vars");
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
        throw new Error(`Failed to fetch Zoho access token (${res.status})`);
    }

    const data = safeJsonParse(raw);
    if (!data.access_token) {
        throw new Error("No access token returned by Zoho token endpoint");
    }

    return {
        accessToken: data.access_token,
        apiDomain: process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com",
    };
}

function parseAssetIds(raw) {
    if (raw == null) return [];
    const input = Array.isArray(raw) ? raw.join(",") : String(raw);

    const ids = input
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
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
        throw new Error(`Zoho CRM COQL error (${response.status})`);
    }

    const json = safeJsonParse(raw);
    return json.data || [];
}

async function getTransactions({ assetIds }) {
    const { accessToken, apiDomain } = await getAccessToken();
    const crmVersion = process.env.ZOHO_CRM_VERSION || "v6";
    const crmBase = `${apiDomain}/crm/${crmVersion}`;

    const inList = assetIds.map((id) => `'${id}'`).join(",");
    const query =
        `select id, Name, Transaction_Type, Current_Advance_Amount, Asset ` +
        `from Transactions ` +
        `where Asset.id in (${inList})`;

    return runCoql({ accessToken, crmBase, query });
}

module.exports = async (req, res) => {
    const requestId = createRequestId();
    const endpoint = "/server/getdealtransactions";

    try {
        if (req.method !== "GET") {
            return sendJson(res, 405, { error: "Method not allowed. Use GET.", requestId, details: "invalid method", endpoint });
        }

        const parsedUrl = new URL(req.url, "http://dummy-host");
        const rawAssetIds =
            parsedUrl.searchParams.get("assetIds") || req.query?.assetIds || req.params?.assetIds || "";

        const callerEmail = portalDeals.getCallerEmail(req);
        const fallbackEmail = (parsedUrl.searchParams.get("email") || "").trim().toLowerCase();
        const email = callerEmail || fallbackEmail;

        if (!email || !validateEmail(email)) {
            return sendJson(res, 401, {
                error: "Missing authenticated user email context.",
                requestId,
                endpoint,
                details: "missing email",
            });
        }

        const assetIds = parseAssetIds(rawAssetIds);
        console.log("[getdealtransactions] parsed assetIds", { requestId, email, count: assetIds.length });

        if (!assetIds.length) {
            return sendJson(res, 400, { error: "Missing assetIds", requestId, endpoint, details: "missing assetIds" });
        }

        const visibleDeals = await portalDeals.getDealsForPortal({ email, accountId: "" });
        const allowedAssetIds = new Set();
        for (const deal of visibleDeals || []) {
            String(deal.asset_ids || deal.asset_id || "")
                .split(",")
                .map((x) => x.trim())
                .filter((x) => /^\d+$/.test(x))
                .forEach((x) => allowedAssetIds.add(x));
        }

        const unauthorized = assetIds.filter((id) => !allowedAssetIds.has(id));
        if (unauthorized.length) {
            return sendJson(res, 403, {
                error: "One or more assetIds are not authorized for this user.",
                requestId,
                endpoint,
                details: "asset authorization failed",
            });
        }

        let rows;
        try {
            rows = await getTransactions({ assetIds });
        } catch (upstreamError) {
            console.error("[getdealtransactions] upstream error", {
                requestId,
                endpoint,
                message: upstreamError?.message || String(upstreamError),
            });
            return sendJson(res, 502, {
                error: "Upstream failure",
                requestId,
                endpoint,
                details: shortError(upstreamError?.message),
            });
        }

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
        console.error("[getdealtransactions] error", {
            requestId,
            endpoint,
            message: err?.message || String(err),
        });
        return sendJson(res, 500, {
            error: "Internal server error in getdealtransactions.",
            requestId,
            endpoint,
            details: "transaction lookup failed",
        });
    }
};
