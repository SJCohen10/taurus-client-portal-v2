"use strict";
const { URL } = require("url");
const { resolveCatalystUserEmail, logIdentitySource } = require("./catalystIdentity");
const rateLimitStore = new Map();
function getAllowedOrigins() { return String(process.env.PORTAL_ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean); }
function applyCors(req, res) { const origin = req.headers?.origin; const allowedOrigins = getAllowedOrigins(); if (origin && allowedOrigins.includes(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); } res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization"); }
function handleOptions(req, res) { applyCors(req, res); if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; } return false; }
function sendJson(req, res, statusCode, payload) { applyCors(req, res); res.writeHead(statusCode, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); }
function getAuthenticatedEmail(req) { const headers = req?.headers || {}; const email = req?.user?.email || headers["x-zc-user-email"] || headers["x-zc-useremail"] || headers["x-catalyst-user-email"] || headers["x-user-email"] || ""; return String(email).trim().toLowerCase(); }
// Resolution order: direct request identity (req.user, x-zc-* headers) -> Catalyst
// SDK -> the client-supplied email. The SDK step is the one that actually works
// in this environment; the client-supplied email stays last for now and is
// removed once the logs confirm the SDK is resolving identity.
async function resolveUserContext(req, requestedEmail, requestId, fnName) {
  const requested = String(requestedEmail || "").trim().toLowerCase();
  const direct = getAuthenticatedEmail(req);
  let resolved = direct ? { email: direct, source: "request" } : null;

  if (!resolved) {
    const viaCatalyst = await resolveCatalystUserEmail(req, requestId, fnName);
    if (viaCatalyst) resolved = { email: viaCatalyst.email, source: viaCatalyst.source };
  }

  if (!resolved && process.env.NODE_ENV === "production") { const err = new Error("Missing authenticated user context"); err.statusCode = 401; throw err; }
  if (resolved && requested && resolved.email !== requested) { const err = new Error("User mismatch"); err.statusCode = 403; throw err; }
  return resolved || { email: requested, source: requested ? "client.requestedEmail" : "none" };
}
async function enforceUserContext(req, requestedEmail, requestId, fnName) {
  const resolved = await resolveUserContext(req, requestedEmail, requestId, fnName);
  logIdentitySource(fnName, requestId, resolved.source, req);
  return resolved.email;
}
function assertAllowedKeys(obj, allowed) { const bad = Object.keys(obj || {}).filter((k) => !allowed.includes(k)); if (bad.length) { const err = new Error(`Unexpected keys: ${bad.join(",")}`); err.statusCode = 400; throw err; } }
function readJsonBody(req, maxBytes = 1024 * 1024) { return new Promise((resolve, reject) => { let data = ""; let total = 0; req.on("data", (chunk) => { total += chunk.length; if (total > maxBytes) { const err = new Error("Request body too large"); err.statusCode = 413; reject(err); req.destroy(); return; } data += chunk; }); req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { const err = new Error("Invalid JSON"); err.statusCode = 400; reject(err); } }); req.on("error", reject); }); }
function enforceRateLimit({ key, limit = 30, windowMs = 60000 }) { const now = Date.now(); const item = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs }; if (now > item.resetAt) { item.count = 0; item.resetAt = now + windowMs; } item.count += 1; rateLimitStore.set(key, item); if (item.count > limit) { const err = new Error("Rate limit exceeded"); err.statusCode = 429; throw err; } }
function parseQuery(req) { return new URL(req.url, "http://localhost").searchParams; }
module.exports = { handleOptions, sendJson, getAuthenticatedEmail, resolveUserContext, enforceUserContext, assertAllowedKeys, readJsonBody, enforceRateLimit, parseQuery };
