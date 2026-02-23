"use strict";

const { Buffer } = require("buffer");

const DEFAULT_PORTAL_UPLOAD_FOLDER_NAME =
    process.env.PORTAL_UPLOAD_FOLDER_NAME || "Portal Document Uploads";

const WORKDRIVE_BASE =
    process.env.ZOHO_WORKDRIVE_BASE ||
    "https://www.zohoapis.com/workdrive/api/v1";

const ALLOWED_MIME_TYPES = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
]);
const MAX_UPLOAD_BYTES = Number(process.env.PORTAL_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
const MAX_BODY_BYTES = Number(process.env.PORTAL_UPLOAD_MAX_BODY_BYTES || 14 * 1024 * 1024);
const CRM_ID_REGEX = /^[0-9]{6,30}$/;
const WORKDRIVE_ID_REGEX = /^[A-Za-z0-9]{8,120}$/;

function createRequestId() {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        let bodyBytes = 0;
        req.on("data", (chunk) => {
            bodyBytes += chunk.length;
            if (bodyBytes > MAX_BODY_BYTES) {
                reject(new Error("Request body too large"));
                req.destroy();
                return;
            }
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
    } catch {
        throw new Error(`Failed to parse WorkDrive token response (${res.status})`);
    }

    if (!res.ok || !data.access_token) {
        throw new Error(`Failed to get WorkDrive access token (${res.status})`);
    }

    return data.access_token;
}

function buildAuthHeaders(accessToken) {
    const headers = {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: "application/vnd.api+json",
    };

    if (process.env.ZOHO_WORKDRIVE_TEAM_ID) {
        headers["X-ZOHO-WORKDRIVE-TEAM-ID"] = process.env.ZOHO_WORKDRIVE_TEAM_ID;
    }

    return headers;
}

function shortError(message) {
    return String(message || "Unknown error").slice(0, 220);
}

function sanitizeFolderName(value, fallback = "Unknown Deal") {
    return String(value || fallback)
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || fallback;
}

function looksLikeInvalidFolderError(err) {
    const msg = `${err?.message || ""} ${err?.raw || ""}`.toLowerCase();
    return msg.includes("invalid") && msg.includes("folder");
}

async function ensurePropertyFolder({ accessToken, parentId, folderName, propertyDescription }) {
    const headers = {
        ...buildAuthHeaders(accessToken),
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
    };

    const safeFolderName = sanitizeFolderName(folderName || "Folder");

    const payload = {
        data: {
            type: "files",
            attributes: {
                name: safeFolderName,
                parent_id: parentId,
                ...(propertyDescription ? { description: String(propertyDescription).slice(0, 500) } : {}),
            },
        },
    };

    const res = await fetch(`${WORKDRIVE_BASE}/files`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        const err = new Error(`WorkDrive folder response was not JSON (${res.status})`);
        err.status = res.status;
        err.raw = text;
        throw err;
    }

    if (!res.ok) {
        const err = new Error(`WorkDrive folder create failed (${res.status})`);
        err.status = res.status;
        err.raw = text;
        throw err;
    }

    return data?.data?.id || null;
}

async function searchForChildFolder({ accessToken, parentFolderId, folderName }) {
    const headers = {
        ...buildAuthHeaders(accessToken),
        Accept: "application/vnd.api+json",
    };

    const safeName = sanitizeFolderName(folderName || "Folder");
    const url =
        `${WORKDRIVE_BASE}/files/${encodeURIComponent(parentFolderId)}/files` +
        `?page[limit]=50&page[offset]=0&filter[type]=folders`;

    try {
        const res = await fetch(url, { method: "GET", headers });
        const text = await res.text();
        const data = JSON.parse(text);

        if (!res.ok) return null;

        const items = Array.isArray(data?.data) ? data.data : [];
        const match = items.find((item) => {
            const n = item?.attributes?.name || "";
            return String(n).trim() === safeName;
        });

        return match?.id || null;
    } catch {
        return null;
    }
}

async function ensureFolder({ accessToken, parentFolderId, folderName }) {
    const safeFolderName = sanitizeFolderName(folderName || "Folder");

    const existingId = await searchForChildFolder({
        accessToken,
        parentFolderId,
        folderName: safeFolderName,
    });
    if (existingId) return existingId;

    // create
    const createdId = await ensurePropertyFolder({
        accessToken,
        parentId: parentFolderId,
        folderName: safeFolderName,
    });
    if (createdId) return createdId;

    // last re-check
    const existingAfterCreate = await searchForChildFolder({
        accessToken,
        parentFolderId,
        folderName: safeFolderName,
    });
    if (existingAfterCreate) return existingAfterCreate;

    throw new Error("WorkDrive folder create failed (unknown)");
}

async function uploadFileToFolder({
    accessToken,
    folderId,
    fileName,
    mimeType,
    fileBase64,
}) {
    const safeName = fileName || "upload.bin";
    const encodedName = encodeURIComponent(safeName);

    const fileBuffer = Buffer.from(fileBase64, "base64");
    const blob = new Blob([fileBuffer], {
        type: mimeType || "application/octet-stream",
    });

    const formData = new FormData();
    formData.append("content", blob, safeName);
    formData.append("parent_id", folderId);
    formData.append("filename", encodedName);
    formData.append("override-name-exist", "false");

    const res = await fetch(`${WORKDRIVE_BASE}/upload`, {
        method: "POST",
        headers: buildAuthHeaders(accessToken),
        body: formData,
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        const err = new Error(`WorkDrive upload response parse failed (${res.status})`);
        err.status = res.status;
        err.raw = text;
        throw err;
    }

    if (!res.ok) {
        const err = new Error(`WorkDrive upload failed (${res.status}): ${data?.message || "upload failed"}`);
        err.status = res.status;
        err.raw = text;
        throw err;
    }

    return data?.data || data;
}

function resolveDealFolderName({ dealId, propertyRefNumber, propertyDescription }) {
    if (dealId && CRM_ID_REGEX.test(String(dealId).trim())) {
        return sanitizeFolderName(`Deal-${String(dealId).trim()}`);
    }
    if (propertyRefNumber) {
        return sanitizeFolderName(String(propertyRefNumber));
    }
    if (propertyDescription) {
        return sanitizeFolderName(String(propertyDescription));
    }
    return "";
}

async function resolveOrCreateDealFolder({
    accessToken,
    rootFolderId,
    dealId,
    propertyRefNumber,
    propertyDescription,
}) {
    const folderName = resolveDealFolderName({ dealId, propertyRefNumber, propertyDescription });
    if (!folderName) return { folderId: null, source: "none" };

    const existing = await searchForChildFolder({
        accessToken,
        parentFolderId: rootFolderId,
        folderName,
    });
    if (existing) {
        return { folderId: existing, source: "existing" };
    }

    const created = await ensurePropertyFolder({
        accessToken,
        parentId: rootFolderId,
        folderName,
        propertyDescription,
    });

    return { folderId: created, source: "created" };
}

async function uploadIntoFolderTree({ accessToken, baseFolderId, fileName, mimeType, fileBase64 }) {
    if (!WORKDRIVE_ID_REGEX.test(String(baseFolderId || "").trim())) {
        throw new Error("invalid parent folder id");
    }

    const portalFolderId = await ensureFolder({
        accessToken,
        parentFolderId: baseFolderId,
        folderName: DEFAULT_PORTAL_UPLOAD_FOLDER_NAME,
    });

    const uploadResult = await uploadFileToFolder({
        accessToken,
        folderId: portalFolderId,
        fileName,
        mimeType,
        fileBase64,
    });

    return { portalFolderId, uploadResult };
}

module.exports = async (req, res) => {
    const requestId = createRequestId();
    const endpoint = "/server/uploaddealdocument";

    try {
        if (req.method !== "POST") {
            return sendJson(res, 405, { error: "Method not allowed. Use POST.", requestId, endpoint, details: "invalid method" });
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
                requestId,
                endpoint,
                details: "missing file payload",
            });
        }

        if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.has(mimeType)) {
            return sendJson(res, 400, {
                error: "Unsupported mimeType. Allowed: application/pdf, image/jpeg, image/png.",
                requestId,
                endpoint,
                details: "invalid mimeType",
            });
        }

        const base64Payload = String(fileBase64).includes(",")
            ? String(fileBase64).split(",").pop()
            : String(fileBase64);

        if (!/^[A-Za-z0-9+/=\s]+$/.test(base64Payload)) {
            return sendJson(res, 400, {
                error: "Invalid fileBase64 payload.",
                requestId,
                endpoint,
                details: "invalid base64",
            });
        }

        const uploadBytes = Buffer.byteLength(base64Payload.replace(/\s/g, ""), "base64");
        if (!Number.isFinite(uploadBytes) || uploadBytes <= 0 || uploadBytes > MAX_UPLOAD_BYTES) {
            return sendJson(res, 400, {
                error: `File exceeds max allowed size of ${MAX_UPLOAD_BYTES} bytes.`,
                requestId,
                endpoint,
                details: "file too large",
            });
        }

        const providedFolderId =
            typeof propertyFolderId === "string" && WORKDRIVE_ID_REGEX.test(propertyFolderId.trim())
                ? propertyFolderId.trim()
                : null;

        const rootFolderId =
            process.env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID ||
            process.env.WORKDRIVE_ROOT_FOLDER_ID ||
            process.env.PORTAL_ROOT_FOLDER_ID ||
            process.env.ZOHO_WORKDRIVE_PARENT_FOLDER_ID ||
            "";

        console.log("[uploaddealdocument] incoming", {
            requestId,
            hasProvidedFolderId: Boolean(providedFolderId),
            hasRootFolderId: Boolean(rootFolderId),
            dealId: dealId ? String(dealId) : "",
        });

        const accessToken = await getWorkDriveAccessToken();

        let baseFolderId = providedFolderId;
        let fallbackUsed = false;
        let fallbackSource = "none";

        if (baseFolderId) {
            try {
                const { portalFolderId, uploadResult } = await uploadIntoFolderTree({
                    accessToken,
                    baseFolderId,
                    fileName,
                    mimeType,
                    fileBase64: base64Payload,
                });

                console.log("[uploaddealdocument] upload complete", {
                    fallbackUsed,
                    finalFolderId: portalFolderId,
                });

                return sendJson(res, 200, {
                    message: "Document uploaded to WorkDrive",
                    folderId: portalFolderId,
                    resolvedPropertyFolderId: baseFolderId,
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
                if (!looksLikeInvalidFolderError(err)) {
                    throw err;
                }
                fallbackUsed = true;
            }
        }

        if (!rootFolderId) {
            return sendJson(res, 400, {
                error: "Invalid propertyFolderId",
                requestId,
                endpoint,
                details: "missing root folder id fallback",
                hint: "Missing/invalid per-deal WorkDrive folder id. Provide Analytics Property Folder Id or enable folder creation under root.",
            });
        }

        const resolved = await resolveOrCreateDealFolder({
            accessToken,
            rootFolderId,
            dealId,
            propertyRefNumber,
            propertyDescription,
        });

        if (!resolved.folderId) {
            return sendJson(res, 400, {
                error: "Invalid propertyFolderId",
                requestId,
                endpoint,
                details: "unable to resolve deal folder",
                hint: "Missing/invalid per-deal WorkDrive folder id. Provide Analytics Property Folder Id or enable folder creation under root.",
            });
        }

        baseFolderId = resolved.folderId;
        fallbackSource = resolved.source;

        const { portalFolderId, uploadResult } = await uploadIntoFolderTree({
            accessToken,
            baseFolderId,
            fileName,
            mimeType,
            fileBase64: base64Payload,
        });

        console.log("[uploaddealdocument] upload complete", {
            fallbackUsed: fallbackUsed || !providedFolderId,
            fallbackSource,
            finalFolderId: portalFolderId,
        });

        return sendJson(res, 200, {
            message: "Document uploaded to WorkDrive",
            folderId: portalFolderId,
            resolvedPropertyFolderId: baseFolderId,
            folderResolution: fallbackUsed || !providedFolderId ? fallbackSource : "provided",
            hint: (fallbackUsed || !providedFolderId) ? "Persist resolvedPropertyFolderId to Analytics Property Folder Id for faster future uploads." : undefined,
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
        console.error("[uploaddealdocument] error", {
            requestId,
            endpoint,
            message: err?.message || String(err),
        });
        return sendJson(res, 500, {
            error: "Internal server error in uploaddealdocument.",
            requestId,
            endpoint,
            details: shortError(err?.message),
        });
    }
};
