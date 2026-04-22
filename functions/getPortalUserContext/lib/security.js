"use strict";
const { URL } = require("url");
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
function getIdentityCandidates(req) {
  const headers = req?.headers || {};
  const user = req?.user || {};
  const userDetailsRaw = headers["x-zc-user-details"] || headers["x-zc-userdetails"] || "";
  const headerUserDetails = parseMaybeJson(userDetailsRaw);
  return [
    { source: "req.user.email", value: user.email },
    { source: "req.user.mail", value: user.mail },
    { source: "req.user.email_id", value: user.email_id },
    { source: "req.user.primary_email", value: user.primary_email },
    { source: "req.user.user_details.email_id", value: user?.user_details?.email_id },
    { source: "header.userdetails.email", value: headerUserDetails?.email },
    { source: "header.userdetails.email_id", value: headerUserDetails?.email_id },
    { source: "header.x-zc-user-email", value: headers["x-zc-user-email"] },
    { source: "header.x-zc-useremail", value: headers["x-zc-useremail"] },
    { source: "header.x-catalyst-user-email", value: headers["x-catalyst-user-email"] },
    { source: "header.x-user-email", value: headers["x-user-email"] },
    { source: "header.x-forwarded-user-email", value: headers["x-forwarded-user-email"] },
  ];
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
    hadReqUser: Boolean(user),
    reqUserKeys: user ? Object.keys(user) : [],
    presentIdentityHeaders,
    hasUserDetailsHeader: Boolean(headers["x-zc-user-details"] || headers["x-zc-userdetails"]),
    userDetailsParsed: Boolean(parsedUserDetails),
    parsedUserDetailsKeys: parsedUserDetails && typeof parsedUserDetails === "object" ? Object.keys(parsedUserDetails) : [],
    candidateEmails: candidates,
    hasAnyCandidateEmail: candidates.some((entry) => entry.present),
  };
}
function getAuthenticatedEmail(req) {
  const candidates = getIdentityCandidates(req);
  const first = candidates.find((entry) => Boolean(normalizeEmail(entry.value)));
  return normalizeEmail(first?.value || "");
}
function resolveUserContext(req, requestedEmail) {
  const authEmail = getAuthenticatedEmail(req);
  const requested = normalizeEmail(requestedEmail);
  const allowQueryOverrideInProd = String(process.env.PORTAL_ALLOW_EMAIL_QUERY_OVERRIDE || "false").toLowerCase() === "true";
  const allowRequestedFallback = process.env.NODE_ENV !== "production" || allowQueryOverrideInProd;
  if (authEmail && requested && authEmail !== requested) { const err = new Error("User mismatch"); err.statusCode = 403; throw err; }
  if (authEmail) return { email: authEmail, source: "authenticated_user" };
  if (requested && allowRequestedFallback) return { email: requested, source: allowQueryOverrideInProd ? "query_override" : "query_fallback" };
  const err = new Error("Missing authenticated user context");
  err.statusCode = 401;
  throw err;
}
function enforceUserContext(req, requestedEmail) { return resolveUserContext(req, requestedEmail).email; }
function assertAllowedKeys(obj, allowed) { const bad = Object.keys(obj || {}).filter((k) => !allowed.includes(k)); if (bad.length) { const err = new Error(`Unexpected keys: ${bad.join(",")}`); err.statusCode = 400; throw err; } }
function readJsonBody(req, maxBytes = 1024 * 1024) { return new Promise((resolve, reject) => { let data = ""; let total = 0; req.on("data", (chunk) => { total += chunk.length; if (total > maxBytes) { const err = new Error("Request body too large"); err.statusCode = 413; reject(err); req.destroy(); return; } data += chunk; }); req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { const err = new Error("Invalid JSON"); err.statusCode = 400; reject(err); } }); req.on("error", reject); }); }
function enforceRateLimit({ key, limit = 30, windowMs = 60000 }) { const now = Date.now(); const item = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs }; if (now > item.resetAt) { item.count = 0; item.resetAt = now + windowMs; } item.count += 1; rateLimitStore.set(key, item); if (item.count > limit) { const err = new Error("Rate limit exceeded"); err.statusCode = 429; throw err; } }
function parseQuery(req) { return new URL(req.url, "http://localhost").searchParams; }
module.exports = { handleOptions, sendJson, getAuthenticatedEmail, getAuthContextDebugMeta, resolveUserContext, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit, parseQuery };
