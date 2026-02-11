"use strict";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function normalizeRecordType(recordType) {
    if (recordType === "Deal") {
        return "Deals";
    }

    if (recordType === "Asset") {
        return "Assets";
    }

    return null;
}

module.exports = async (req, res) => {
    try {
        if (req.method !== "POST") {
            return sendJson(res, 405, { error: "Method not allowed" });
        }

        const body = await readJsonBody(req);
        const email = String(body.email || "").trim();
        const recordType = String(body.recordType || "").trim();
        const recordId = String(body.recordId || "").trim();
        const content = String(body.content || "").trim();

        if (!email || !EMAIL_REGEX.test(email)) {
            return sendJson(res, 400, { error: "Missing or invalid 'email'." });
        }

        const seModule = normalizeRecordType(recordType);
        if (!seModule) {
            return sendJson(res, 400, { error: "recordType must be 'Deal' or 'Asset'." });
        }

        if (!/^\d+$/.test(recordId)) {
            return sendJson(res, 400, { error: "recordId must be a numeric CRM ID." });
        }

        if (!content) {
            return sendJson(res, 400, { error: "content is required." });
        }

        if (content.length > 5000) {
            return sendJson(res, 400, { error: "content exceeds 5000 characters." });
        }

        const { accessToken, apiDomain } = await getAccessToken();
        const crmVersion = process.env.ZOHO_CRM_VERSION || "v6";
        const url = `${apiDomain}/crm/${crmVersion}/Notes`;

        const payload = {
            data: [
                {
                    Note_Title: `Portal note (${email})`,
                    Note_Content: content,
                    Parent_Id: {
                        id: recordId,
                    },
                    se_module: seModule,
                },
            ],
        };

        const response = await fetch(url, {
            method: "POST",
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
                error: "Failed to create CRM note.",
                details: raw,
            });
        }

        const parsed = raw ? JSON.parse(raw) : {};
        const item = parsed?.data?.[0] || {};

        if (item.status && item.status.toLowerCase() !== "success") {
            return sendJson(res, 500, {
                error: "Zoho CRM note creation did not succeed.",
                details: item,
            });
        }

        return sendJson(res, 200, {
            success: true,
            noteId: item.details?.id || null,
        });
    } catch (error) {
        console.error("Error in createnote:", error);
        return sendJson(res, 500, {
            error: "Internal server error in createnote.",
            details: error.message,
        });
    }
};