"use strict";

const { URL } = require("url");

const ACCOUNT_ID_REGEX = /^[A-Za-z0-9_-]{6,100}$/;

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

    const res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    const raw = await res.text();
    if (!res.ok) throw new Error(`Failed to get access token (${res.status}): ${raw}`);

    const data = raw ? JSON.parse(raw) : {};
    if (!data.access_token) throw new Error("No access_token returned by Zoho");

    const apiDomain = process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com";
    return { accessToken: data.access_token, apiDomain };
}

async function searchBankDetails({ accessToken, crmBase, accountId, avsOnly }) {
    // Bank_Details module search. Your existing criteria uses (Account:equals:<id>)
    let criteria = `((Account:equals:${accountId}))`;
    if (avsOnly) {
        criteria = `((Account:equals:${accountId}) and (AVS:equals:true))`;
    }

    const url = `${crmBase}/Bank_Details/search?criteria=${encodeURIComponent(criteria)}&per_page=200&page=1`;

    const res = await fetch(url, {
        headers: {
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            Accept: "application/json",
        },
    });

    const raw = await res.text();
    if (!res.ok) throw new Error(`Zoho CRM Bank_Details search failed (${res.status}): ${raw}`);

    const json = raw ? JSON.parse(raw) : {};
    const records = json.data || [];

    return records.map((bd) => {
        const accountNumber = bd.Account_Number || "";
        const last4 = accountNumber ? String(accountNumber).slice(-4) : "";
        return {
            id: bd.id,
            bank: bd.Bank || "",
            name: bd.Name || "",
            accountNumberLast4: last4,
            label: `${bd.Bank || "Bank"} – ${bd.Name || "Account"}${last4 ? ` – ****${last4}` : ""}`,
        };
    });
}

module.exports = async (req, res) => {
    try {
        if (req.method !== "GET") {
            return sendJson(res, 405, { error: "Method not allowed. Use GET." });
        }

        const parsedUrl = new URL(req.url, "http://dummy-host");
        const accountId = (parsedUrl.searchParams.get("accountId") || "").trim();
        const avsOnlyRaw = parsedUrl.searchParams.get("avsOnly") || "false";
        const avsOnly = String(avsOnlyRaw).toLowerCase() === "true";

        if (!accountId) {
            return sendJson(res, 400, { error: "Missing 'accountId' query parameter." });
        }

        if (!ACCOUNT_ID_REGEX.test(accountId)) {
            return sendJson(res, 400, { error: "Invalid 'accountId' query parameter." });
        }

        const { accessToken, apiDomain } = await getAccessToken();
        const crmVersion = process.env.ZOHO_CRM_VERSION || "v6";
        const crmBase = `${apiDomain}/crm/${crmVersion}`;

        const bankDetails = await searchBankDetails({ accessToken, crmBase, accountId, avsOnly });

        return sendJson(res, 200, { accountId, avsOnly, bankDetails });
    } catch (err) {
        console.error("Error in getbankdetailsforaccount:", err);
        return sendJson(res, 500, {
            error: "Internal server error in getbankdetailsforaccount.",

        });
    }
};
