"use strict";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
        });
        req.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (error) {
                reject(error);
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

    const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    const raw = await response.text();
    if (!response.ok) {
        throw new Error(`Failed to fetch Zoho access token (${response.status}): ${raw}`);
    }

    const data = raw ? JSON.parse(raw) : {};
    if (!data.access_token) {
        throw new Error("No access token returned by Zoho OAuth token endpoint.");
    }

    return {
        accessToken: data.access_token,
        apiDomain: process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com",
    };
}

function isValidDate(value) {
    if (!DATE_REGEX.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return false;
    return date.toISOString().slice(0, 10) === value;
}

module.exports = async (req, res) => {
    try {
        if (req.method !== "POST") {
            return sendJson(res, 405, { error: "Method not allowed" });
        }

        const body = await readJsonBody(req);
        const email = String(body.email || "").trim();
        const dealId = String(body.dealId || "").trim();
        const expectedLodgementDate = String(body.expectedLodgementDate || "").trim();

        if (!email || !EMAIL_REGEX.test(email)) {
            return sendJson(res, 400, { error: "Missing or invalid 'email'." });
        }

        if (!/^\d+$/.test(dealId)) {
            return sendJson(res, 400, { error: "dealId must be a numeric CRM ID." });
        }

        if (!expectedLodgementDate || !isValidDate(expectedLodgementDate)) {
            return sendJson(res, 400, { error: "expectedLodgementDate must be YYYY-MM-DD." });
        }

        const { accessToken, apiDomain } = await getAccessToken();
        const url = `${apiDomain}/crm/v8/Deals/${dealId}`;

        const payload = {
            data: [
                {
                    Expected_Lodgement_Date: expectedLodgementDate,
                },
            ],
        };

        const response = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Zoho-oauthtoken ${accessToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(payload),
        });

        const raw = await response.text();
        if (!response.ok) {
            return sendJson(res, response.status, {
                error: "Failed to update CRM deal.",
                details: raw,
            });
        }

        const parsed = raw ? JSON.parse(raw) : {};
        const item = parsed?.data?.[0] || {};

        if (String(item.status || "").toLowerCase() !== "success") {
            return sendJson(res, 500, {
                error: "Zoho CRM deal update did not succeed.",
                details: item,
            });
        }

        return sendJson(res, 200, { success: true });
    } catch (error) {
        console.error("Error in updateexpectedlodgementdate:", error);
        return sendJson(res, 500, {
            error: "Internal server error in updateexpectedlodgementdate.",
            details: error.message,
        });
    }
};