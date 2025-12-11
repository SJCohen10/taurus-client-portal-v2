"use strict";

const { Buffer } = require("buffer");

const DEFAULT_PORTAL_UPLOAD_FOLDER_NAME =
    process.env.PORTAL_UPLOAD_FOLDER_NAME || "Portal Document Uploads";

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
                const parsed = data ? JSON.parse(data) : {};
                resolve(parsed);
            } catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}

async function getWorkDriveAccessToken() {
    const clientId = process.env.ZOHO_WORKDRIVE_CLIENT_ID;
    const clientSecret = process.env.ZOHO_WORKDRIVE_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_WORKDRIVE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
            "Missing Zoho WorkDrive OAuth env vars: ZOHO_WORKDRIVE_CLIENT_ID, ZOHO_WORKDRIVE_CLIENT_SECRET, ZOHO_WORKDRIVE_REFRESH_TOKEN"
        );
    }

    const params = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
    });

    const res = await fetch("https://accounts.zoho.com/oauth/v2/token", {
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
            `Failed to parse WorkDrive token response (${res.status}): ${text}`
        );
    }

    if (!res.ok || !data.access_token) {
        throw new Error(
            `Failed to get WorkDrive access token (${res.status}): ${data.error || text}`
        );
    }

    return data.access_token;
}

function buildAuthHeaders(accessToken) {
    const headers = {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
    };

    if (process.env.ZOHO_WORKDRIVE_TEAM_ID) {
        headers["X-ZOHO-WORKDRIVE-TEAM-ID"] = process.env.ZOHO_WORKDRIVE_TEAM_ID;
    }

    return headers;
}

async function ensurePropertyFolder({
    accessToken,
    parentId,
    propertyRefNumber,
    propertyDescription,
}) {
    const headers = {
        ...buildAuthHeaders(accessToken),
        "Content-Type": "application/json",
    };

    const body = {
        name: propertyRefNumber || "Unknown Property",
        parent_id: parentId,
    };

    if (propertyDescription) {
        body.description = propertyDescription;
    }

    const res = await fetch("https://workdrive.zoho.com/api/v1/folders", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error(
            `WorkDrive folder response was not JSON (${res.status}): ${text}`
        );
    }

    if (!res.ok) {
        // If folder already exists, fallback to uploading directly to the parent
        console.warn("WorkDrive folder create failed:", data);
        return parentId;
    }

    return data?.data?.id || parentId;
}

async function searchForChildFolder({ accessToken, parentFolderId, folderName }) {
    const headers = {
        ...buildAuthHeaders(accessToken),
        "Content-Type": "application/json",
    };

    try {
        const res = await fetch("https://workdrive.zoho.com/api/v1/search", {
            method: "POST",
            headers,
            body: JSON.stringify({
                search_text: folderName,
                type: "folder",
                parent_id: parentFolderId,
            }),
        });

        const text = await res.text();
        const data = JSON.parse(text);

        if (!res.ok) {
            console.warn("WorkDrive search failed:", data);
            return null;
        }

        if (Array.isArray(data?.data)) {
            const match = data.data.find(
                (item) => item.attributes?.name === folderName
            );
            return match?.id || null;
        }

        return null;
    } catch (err) {
        console.warn("WorkDrive search error:", err);
        return null;
    }
}

async function ensurePortalUploadsFolder({
    accessToken,
    parentFolderId,
    folderName = DEFAULT_PORTAL_UPLOAD_FOLDER_NAME,
}) {
    const headers = {
        ...buildAuthHeaders(accessToken),
        "Content-Type": "application/json",
    };

    const createBody = {
        name: folderName,
        parent_id: parentFolderId,
    };

    const res = await fetch("https://workdrive.zoho.com/api/v1/folders", {
        method: "POST",
        headers,
        body: JSON.stringify(createBody),
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        console.warn("Portal folder creation parse failed:", text);
    }

    if (res.ok) {
        return data?.data?.id || parentFolderId;
    }

    const alreadyExists =
        res.status === 409 ||
        (typeof text === "string" && text.toLowerCase().includes("exists"));

    if (alreadyExists) {
        const existingId = await searchForChildFolder({
            accessToken,
            parentFolderId,
            folderName,
        });

        if (existingId) {
            return existingId;
        }
    }

    console.warn("Portal folder creation failed:", data || text);
    return parentFolderId;
}

async function uploadFileToFolder({
    accessToken,
    folderId,
    fileName,
    mimeType,
    fileBase64,
}) {
    const fileBuffer = Buffer.from(fileBase64, "base64");
    const blob = new Blob([fileBuffer], {
        type: mimeType || "application/octet-stream",
    });
    const formData = new FormData();
    formData.append("file", blob, fileName || "upload.bin");
    formData.append("parent_id", folderId);

    const res = await fetch("https://workdrive.zoho.com/api/v1/upload", {
        method: "POST",
        headers: buildAuthHeaders(accessToken),
        body: formData,
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error(`WorkDrive upload response parse failed: ${text}`);
    }

    if (!res.ok) {
        throw new Error(
            `WorkDrive upload failed (${res.status}): ${data.message || text}`
        );
    }

    return data?.data || data;
}

module.exports = async (req, res) => {
    try {
        if (req.method !== "POST") {
            return sendJson(res, 405, {
                error: "Method not allowed. Use POST.",
            });
        }

        const body = await readJsonBody(req);
        const {
            fileName,
            mimeType,
            fileBase64,
            propertyRefNumber,
            propertyDescription,
            accountId,
            contactEmail,
            assetId,
            propertyFolderId,
            dealId,
        } = body || {};

        if (!fileName || !fileBase64) {
            return sendJson(res, 400, {
                error: "Missing fileName or fileBase64 in request body.",
            });
        }

        const accessToken = await getWorkDriveAccessToken();

        const parentFolderId =
            process.env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID ||
            process.env.ZOHO_WORKDRIVE_PARENT_FOLDER_ID;

        if (!propertyFolderId && !parentFolderId) {
            throw new Error(
                "Missing WorkDrive folder context: provide propertyFolderId or set ZOHO_WORKDRIVE_ROOT_FOLDER_ID/ZOHO_WORKDRIVE_PARENT_FOLDER_ID."
            );
        }

        const baseFolderId = propertyFolderId
            ? propertyFolderId
            : await ensurePropertyFolder({
                accessToken,
                parentId: parentFolderId,
                propertyRefNumber,
                propertyDescription,
            });
        const portalFolderId = await ensurePortalUploadsFolder({
            accessToken,
            parentFolderId: baseFolderId,
        });

        const uploadResult = await uploadFileToFolder({
            accessToken,
            folderId: portalFolderId,
            fileName,
            mimeType,
            fileBase64,
        });

        return sendJson(res, 200, {
            message: "Document uploaded to WorkDrive",
            folderId: portalFolderId,
            file: uploadResult,
            context: {
                propertyRefNumber,
                propertyDescription,
                accountId,
                contactEmail,
                assetId,
                propertyFolderId: baseFolderId,
                portalFolderName: DEFAULT_PORTAL_UPLOAD_FOLDER_NAME,
                dealId,
            },
        });
    } catch (err) {
        console.error("Error in uploaddealdocument:", err);
        return sendJson(res, 500, {
            error: "Internal server error in uploaddealdocument.",
            details: err.message,
        });
    }
};