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
// req.user is populated by the platform, so it is the only candidate the request
// itself can carry. The x-zc-user-email / x-zc-useremail headers and the
// JSON-parsed x-zc-user-details blob were candidates here until audit finding 4
// confirmed a session-less request carrying one resolved as that user. They are
// client-controllable and carry no provenance, so they are gone.
//
// getAuthContextDebugMeta below still reports on those headers for observability.
// It feeds no decision.
function getIdentityCandidates(req) {
  const user = req?.user || {};
  return [...getEmailCandidateFields("req.user", user)];
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
// Returns { email, source } when the SDK resolves an email from the caller's own
// session, or null when it resolves nothing - the caller turns null into a 401.
//
// The SDK is attempted unconditionally. Gating it on x-zc-user-id /
// x-zc-user-cred-token put a client-controllable header in the control flow, and
// meant a genuine session arriving without a marker was rejected unheard.
//
// getCurrentUser is the only identity source. getUserDetails(x-zc-user-id) was a
// lookup keyed on a client-supplied id - a header-derived identity in SDK
// clothing - so it no longer participates.
//
// initialize is wrapped here. This fork did not wrap it, which was survivable
// only while the marker gate meant it never ran on an anonymous request.
async function resolveCatalystUserEmail(req, requestId) {
  const meta = getCatalystIdentityMeta(req);
  const attempts = [];
  let userManagement = null;

  try {
    const app = catalyst.initialize(req, { type: "advancedio" });
    userManagement = app.userManagement();
  } catch (err) {
    attempts.push("initialize_failed");
    console.warn("getPortalUserContext Catalyst SDK initialize failed", {
      requestId,
      hasZcUserId: meta.hasZcUserId,
      userType: meta.userType,
      message: err.message,
    });
  }

  let sdkResolved = null;

  if (userManagement) {
    try {
      const currentUser = await userManagement.getCurrentUser();
      attempts.push("current_user");
      sdkResolved = getFirstEmailCandidate(getEmailCandidateFields("catalyst.currentUser", currentUser || {}));
    } catch (err) {
      attempts.push("current_user_failed");
      console.warn("getPortalUserContext Catalyst current user lookup failed", {
        requestId,
        hasZcUserId: meta.hasZcUserId,
        userType: meta.userType,
        message: err.message,
      });
    }
  }

  return sdkResolved;
}
function getAuthenticatedEmail(req) {
  const resolved = getFirstEmailCandidate(getIdentityCandidates(req));
  return resolved?.email || "";
}
// Identity comes from platform-attested sources only: req.user, then the Catalyst
// SDK reading the caller's own session. No request header is an identity source.
// The client-supplied email is still compared against the resolved identity, so
// requesting someone else's address is a 403.
async function resolveUserContext(req, requestedEmail, requestId) {
  const requested = normalizeEmail(requestedEmail);
  const directResolved = getFirstEmailCandidate(getIdentityCandidates(req));
  let resolved = directResolved ? { email: directResolved.email, source: "req.user" } : null;

  // No marker gate: the SDK is attempted whenever req.user did not resolve, and
  // returns null rather than throwing when it resolves nothing.
  if (!resolved) {
    const viaCatalyst = await resolveCatalystUserEmail(req, requestId);
    // identitySource records the tier, not the SDK's own detailed source.
    if (viaCatalyst?.email) resolved = { email: viaCatalyst.email, source: "sdk" };
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
