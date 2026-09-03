"use strict";
const { URL } = require("url");
const catalyst = require("zcatalyst-sdk-node");
const rateLimitStore = new Map();
function getAllowedOrigins() { return String(process.env.PORTAL_ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean); }
function applyCors(req, res) { const origin = req.headers?.origin; const allowedOrigins = getAllowedOrigins(); if (origin && allowedOrigins.includes(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); } res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization"); }
function handleOptions(req, res) { applyCors(req, res); if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; } return false; }
function sendJson(req, res, statusCode, payload) { applyCors(req, res); res.writeHead(statusCode, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); }
function parseMaybeJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function hasCatalystUserMarker(req) {
  const headers = req?.headers || {};
  return Boolean(headers["x-zc-user-id"] || headers["x-zc-user-cred-token"]);
}
function getCatalystIdentityMeta(req) {
  const headers = req?.headers || {};
  return {
    hasZcUserId: Boolean(headers["x-zc-user-id"]),
    hasZcUserCredToken: Boolean(headers["x-zc-user-cred-token"]),
    userType: String(headers["x-zc-user-type"] || ""),
  };
}
function getNestedValue(obj, path) {
  return path.split(".").reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), obj);
}
function getEmailCandidateFields(sourcePrefix, obj) {
  const fields = [
    "email",
    "email_id",
    "user_email",
    "user_mailid",
    "mail",
    "primary_email",
    "user_details.email",
    "user_details.email_id",
  ];
  return fields.map((field) => ({ source: `${sourcePrefix}.${field}`, value: getNestedValue(obj, field) }));
}
function getFirstEmailCandidate(candidates) {
  const first = candidates.find((entry) => Boolean(normalizeEmail(entry.value)));
  if (!first) return null;
  return { email: normalizeEmail(first.value), source: first.source };
}
function getIdentityCandidates(req) {
  const headers = req?.headers || {};
  const user = req?.user || {};
  const userDetailsRaw = headers["x-zc-user-details"] || headers["x-zc-userdetails"] || "";
  const headerUserDetails = parseMaybeJson(userDetailsRaw);
  return [
    ...getEmailCandidateFields("req.user", user),
    ...getEmailCandidateFields("header.userdetails", headerUserDetails || {}),
    { source: "header.x-zc-user-email", value: headers["x-zc-user-email"] },
    { source: "header.x-zc-useremail", value: headers["x-zc-useremail"] },
  ];
}
function getRefererOrigin(referer) {
  try { return referer ? new URL(referer).origin : ""; } catch { return ""; }
}

function getAuthContextDebugMeta(req) {
  const headers = req?.headers || {};
  const user = req?.user || null;
  const candidates = getIdentityCandidates(req).map((entry) => {
    const email = normalizeEmail(entry.value);
    return { source: entry.source, present: Boolean(email), domain: email.includes("@") ? email.split("@")[1] : "" };
  });
  const parsedUserDetails = parseMaybeJson(headers["x-zc-user-details"] || headers["x-zc-userdetails"] || "");
  const presentIdentityHeaders = [
    "x-zc-user-email",
    "x-zc-useremail",
    "x-catalyst-user-email",
    "x-user-email",
    "x-forwarded-user-email",
    "x-zc-user-details",
    "x-zc-userdetails",
  ].filter((name) => Boolean(headers[name]));
  return {
    host: headers.host || "",
    origin: headers.origin || "",
    refererOrigin: getRefererOrigin(headers.referer || headers.referrer || ""),
    hadReqUser: Boolean(user),
    reqUserKeys: user ? Object.keys(user) : [],
    presentIdentityHeaders,
    hasUserDetailsHeader: Boolean(headers["x-zc-user-details"] || headers["x-zc-userdetails"]),
    userDetailsParsed: Boolean(parsedUserDetails),
    parsedUserDetailsKeys: parsedUserDetails && typeof parsedUserDetails === "object" ? Object.keys(parsedUserDetails) : [],
    candidateEmails: candidates,
    hasAnyCandidateEmail: candidates.some((entry) => entry.present),
    hasZcUserId: getCatalystIdentityMeta(req).hasZcUserId,
    userType: getCatalystIdentityMeta(req).userType,
  };
}
async function resolveCatalystUserEmail(req, requestId) {
  const headers = req?.headers || {};
  const userId = String(headers["x-zc-user-id"] || "").trim();
  const meta = getCatalystIdentityMeta(req);
  if (!meta.hasZcUserId && !meta.hasZcUserCredToken) return null;

  const app = catalyst.initialize(req, { type: "advancedio" });
  const userManagement = app.userManagement();
  const attempts = [];

  try {
    const currentUser = await userManagement.getCurrentUser();
    attempts.push("current_user");
    const resolved = getFirstEmailCandidate(getEmailCandidateFields("catalyst.currentUser", currentUser || {}));
    if (resolved) return resolved;
  } catch (err) {
    attempts.push("current_user_failed");
    console.warn("getPortalUserContext Catalyst current user lookup failed", {
      requestId,
      hasZcUserId: meta.hasZcUserId,
      userType: meta.userType,
      message: err.message,
    });
  }

  if (userId) {
    try {
      const userById = await userManagement.getUserDetails(userId);
      attempts.push("user_details");
      const resolved = getFirstEmailCandidate(getEmailCandidateFields("catalyst.userDetails", userById || {}));
      if (resolved) return resolved;
    } catch (err) {
      attempts.push("user_details_failed");
      console.warn("getPortalUserContext Catalyst user id lookup failed", {
        requestId,
        hasZcUserId: meta.hasZcUserId,
        userType: meta.userType,
        message: err.message,
      });
    }
  }

  const err = new Error("Authenticated Catalyst user did not include an email context");
  err.statusCode = 401;
  err.details = { catalystIdentityPresent: true, hasZcUserId: meta.hasZcUserId, userType: meta.userType, attempts };
  throw err;
}
function getAuthenticatedEmail(req) {
  const resolved = getFirstEmailCandidate(getIdentityCandidates(req));
  return resolved?.email || "";
}
async function resolveUserContext(req, requestedEmail, requestId) {
  const requested = normalizeEmail(requestedEmail);
  const directResolved = getFirstEmailCandidate(getIdentityCandidates(req));
  let resolved = directResolved ? { email: directResolved.email, source: directResolved.source } : null;

  if (!resolved && hasCatalystUserMarker(req)) {
    resolved = await resolveCatalystUserEmail(req, requestId);
  }

  if (resolved?.email && requested && resolved.email !== requested) { const err = new Error("User mismatch"); err.statusCode = 403; throw err; }
  if (resolved?.email) return resolved;
  const err = new Error("Missing authenticated user context");
  err.statusCode = 401;
  throw err;
}
async function enforceUserContext(req, requestedEmail, requestId) { return (await resolveUserContext(req, requestedEmail, requestId)).email; }
function assertAllowedKeys(obj, allowed) { const bad = Object.keys(obj || {}).filter((k) => !allowed.includes(k)); if (bad.length) { const err = new Error(`Unexpected keys: ${bad.join(",")}`); err.statusCode = 400; throw err; } }
function readJsonBody(req, maxBytes = 1024 * 1024) { return new Promise((resolve, reject) => { let data = ""; let total = 0; req.on("data", (chunk) => { total += chunk.length; if (total > maxBytes) { const err = new Error("Request body too large"); err.statusCode = 413; reject(err); req.destroy(); return; } data += chunk; }); req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { const err = new Error("Invalid JSON"); err.statusCode = 400; reject(err); } }); req.on("error", reject); }); }
function enforceRateLimit({ key, limit = 30, windowMs = 60000 }) { const now = Date.now(); const item = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs }; if (now > item.resetAt) { item.count = 0; item.resetAt = now + windowMs; } item.count += 1; rateLimitStore.set(key, item); if (item.count > limit) { const err = new Error("Rate limit exceeded"); err.statusCode = 429; throw err; } }
function parseQuery(req) { return new URL(req.url, "http://localhost").searchParams; }
module.exports = { handleOptions, sendJson, getAuthenticatedEmail, getAuthContextDebugMeta, resolveUserContext, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit, parseQuery };
