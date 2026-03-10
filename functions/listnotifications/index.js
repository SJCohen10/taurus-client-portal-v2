"use strict";

const portalDeals = require("./lib/portalDeals");
const { resolvePortalUserContextByEmail } = require("./lib/portalUserContext");

const NOTIFICATION_QUERY_TIMEOUT_MS = Number(process.env.PORTAL_LIST_NOTIFICATIONS_QUERY_TIMEOUT_MS || 7000);
const AUTH_TIMEOUT_MS = Number(process.env.PORTAL_LIST_NOTIFICATIONS_AUTH_TIMEOUT_MS || 4500);
const FUNCTION_BUDGET_MS = Number(process.env.PORTAL_LIST_NOTIFICATIONS_BUDGET_MS || 9000);
const MAX_NOTIFICATIONS = Number(process.env.PORTAL_LIST_NOTIFICATIONS_LIMIT || 60);
const AUTH_CACHE_TTL_MS = Number(process.env.PORTAL_NOTIFICATION_AUTH_CACHE_TTL_MS || 30 * 1000);

const authCache = new Map();

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function shortError(message) {
  return String(message || "Unknown error").slice(0, 300);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function responseEnvelope({ status = "error", requestId, message, details, data = {} }) {
  return {
    status,
    requestId,
    message,
    ...(details ? { details } : {}),
    ...data,
  };
}

function hasAnalyticsEnv() {
  return Boolean(
    process.env.ZOHO_ANALYTICS_CLIENT_ID &&
      process.env.ZOHO_ANALYTICS_CLIENT_SECRET &&
      process.env.ZOHO_ANALYTICS_REFRESH_TOKEN &&
      process.env.ZOHO_ANALYTICS_OWNER &&
      process.env.ZOHO_ANALYTICS_DB
  );
}

function allowBroadcastWithoutAnalytics() {
  return String(process.env.PORTAL_NOTIFICATIONS_ALLOW_BROADCAST_WITHOUT_ANALYTICS || "false") === "true";
}

function nowMs() {
  return Date.now();
}

async function withTimeout(work, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.statusCode = 504;
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getCachedAuthScope(cacheKey) {
  const cached = authCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt < nowMs()) {
    authCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedAuthScope(cacheKey, value) {
  authCache.set(cacheKey, { value, expiresAt: nowMs() + AUTH_CACHE_TTL_MS });
}

module.exports = async (req, res) => {
  const requestId = createRequestId();
  const endpoint = "/server/listnotifications";
  const startedAt = nowMs();
  const timings = {};

  try {
    if (req.method !== "GET") {
      return sendJson(
        res,
        405,
        responseEnvelope({ status: "error", requestId, message: "Method not allowed. Use GET.", details: "invalid method" })
      );
    }

    const catalyst = require("zcatalyst-sdk-node");
    const app = catalyst.initialize(req);

    const parsedUrl = new URL(req.url, "http://dummy-host");

    const dealId = String(req.query?.dealId || req.params?.dealId || parsedUrl.searchParams.get("dealId") || "").trim();

    const requestedEmail = String(req.query?.email || req.params?.email || parsedUrl.searchParams.get("email") || "")
      .trim()
      .toLowerCase();

    const callerEmail = portalDeals.getCallerEmail(req);
    const email = (callerEmail || requestedEmail || "").trim().toLowerCase();

    if (!email) {
      return sendJson(
        res,
        401,
        responseEnvelope({ status: "error", requestId, message: "Missing authenticated user email context.", details: "missing email" })
      );
    }

    const includeRead =
      String(req.query?.includeRead || req.params?.includeRead || parsedUrl.searchParams.get("includeRead") || "false") === "true";

    if (!dealId) {
      return sendJson(res, 400, responseEnvelope({ status: "error", requestId, message: "Missing dealId", details: "missing dealId" }));
    }

    if (!/^[0-9]{6,30}$/.test(dealId)) {
      return sendJson(res, 400, responseEnvelope({ status: "error", requestId, message: "Invalid dealId", details: "invalid dealId" }));
    }

    if (nowMs() - startedAt > FUNCTION_BUDGET_MS) {
      return sendJson(res, 504, responseEnvelope({ status: "error", requestId, message: "Request budget exceeded", details: "pre-auth budget exceeded" }));
    }

    let analyticsAuthorized = false;
    let resolvedAccountId = "";
    let canViewFirmDeals = false;

    if (hasAnalyticsEnv()) {
      const authCacheKey = `${email}:${dealId}`;
      const cachedAuthScope = getCachedAuthScope(authCacheKey);

      if (cachedAuthScope) {
        analyticsAuthorized = cachedAuthScope.analyticsAuthorized;
        resolvedAccountId = cachedAuthScope.resolvedAccountId;
        canViewFirmDeals = cachedAuthScope.canViewFirmDeals;
      } else {
        try {
          const authStart = nowMs();
          const portalUser = await withTimeout(
            () => resolvePortalUserContextByEmail({ email, requestId }),
            AUTH_TIMEOUT_MS,
            "resolvePortalUserContextByEmail"
          );
          timings.portalUserResolveMs = nowMs() - authStart;

          canViewFirmDeals = Boolean(portalUser?.canViewFirmDeals);
          resolvedAccountId = canViewFirmDeals ? String(portalUser?.accountId || "").trim() : "";

          const visibleDealsStart = nowMs();
          const visibleDeals = await withTimeout(
            () => portalDeals.getDealsForPortal({ email, accountId: resolvedAccountId }),
            AUTH_TIMEOUT_MS,
            "getDealsForPortal"
          );
          timings.visibleDealsLookupMs = nowMs() - visibleDealsStart;

          const visibleDealIds = new Set((visibleDeals || []).map((d) => String(d.deal_id || "").trim()).filter(Boolean));

          if (!visibleDealIds.has(dealId)) {
            return sendJson(
              res,
              403,
              responseEnvelope({ status: "error", requestId, message: "Deal is not authorized for this user.", details: "deal authorization failed" })
            );
          }

          analyticsAuthorized = true;
          setCachedAuthScope(authCacheKey, { analyticsAuthorized, resolvedAccountId, canViewFirmDeals });
        } catch (authErr) {
          console.warn("[listnotifications] Analytics authorization unavailable; falling back to targeted-only mode", {
            requestId,
            email,
            dealId,
            message: authErr?.message || String(authErr),
          });
        }
      }
    }

    const zcql = app.zcql();
    const esc = (s) => String(s).replace(/'/g, "''");

    const notificationsTable = String(process.env.PORTAL_NOTIFICATIONS_TABLE || "portal_notifications").trim();

    const COL_ID = process.env.PORTAL_NOTIF_COL_ID || "ROWID";
    const COL_DEAL_ID = process.env.PORTAL_NOTIF_COL_DEAL_ID || "deal_id";
    const COL_AUDIENCE_EMAIL = process.env.PORTAL_NOTIF_COL_AUDIENCE_EMAIL || "audience_email";
    const COL_IS_READ = process.env.PORTAL_NOTIF_COL_IS_READ || "is_read";
    const COL_CREATED_AT = process.env.PORTAL_NOTIF_COL_CREATED_AT || "created_at";
    const COL_ACCOUNT_ID = process.env.PORTAL_NOTIF_COL_ACCOUNT_ID || "account_id";

    if (!/^[A-Za-z0-9_]+$/.test(notificationsTable)) {
      return sendJson(res, 500, responseEnvelope({ status: "error", requestId, message: "Internal error", details: "invalid table name" }));
    }

    const selectFields = [COL_ID, COL_DEAL_ID, COL_AUDIENCE_EMAIL, "message", COL_CREATED_AT, "read_at", COL_IS_READ, "type", "severity"];
    let query = `SELECT ${selectFields.join(", ")} FROM ${notificationsTable} WHERE ${COL_DEAL_ID}='${esc(dealId)}'`;

    if (analyticsAuthorized || allowBroadcastWithoutAnalytics()) {
      const audienceParts = [`${COL_AUDIENCE_EMAIL}='${esc(email)}'`, `${COL_AUDIENCE_EMAIL} IS NULL`];
      if (resolvedAccountId) {
        audienceParts.push(`${COL_ACCOUNT_ID}='${esc(resolvedAccountId)}'`);
      }
      query += ` AND (${audienceParts.join(" OR ")})`;
    } else {
      query += ` AND ${COL_AUDIENCE_EMAIL}='${esc(email)}'`;
    }

    if (!includeRead) {
      query += ` AND (${COL_IS_READ} IS NULL OR ${COL_IS_READ}=false OR ${COL_IS_READ}='false')`;
    }

    query += ` ORDER BY ${COL_CREATED_AT} DESC LIMIT ${Math.max(1, MAX_NOTIFICATIONS)}`;

    const zcqlStart = nowMs();
    const dbRows = await withTimeout(() => zcql.executeZCQLQuery(query), NOTIFICATION_QUERY_TIMEOUT_MS, "notification query");
    timings.zcqlMs = nowMs() - zcqlStart;

    const mapped = (dbRows || []).map((r) => {
      if (!r || typeof r !== "object") return r;
      const keys = Object.keys(r);
      if (keys.length === 1 && r[keys[0]] && typeof r[keys[0]] === "object") {
        return r[keys[0]];
      }
      return r[notificationsTable] || r;
    });

    const rows = mapped.map((n) => ({
      id: n?.id || n?.ID || n?.ROWID || n?.rowid || n?.[COL_ID] || "",
      deal_id: n?.deal_id || n?.Deal_Id || n?.[COL_DEAL_ID] || dealId,
      audience_email: n?.audience_email || n?.Audience_Email || n?.[COL_AUDIENCE_EMAIL] || null,
      message: n?.message || n?.Message || "",
      created_at: n?.created_at || n?.Created_At || n?.[COL_CREATED_AT] || null,
      read_at: n?.read_at || n?.Read_At || null,
      is_read: n?.is_read || n?.Is_Read || n?.[COL_IS_READ] || false,
      type: n?.type || n?.Type || "",
      severity: n?.severity || n?.Severity || "",
    }));

    timings.totalMs = nowMs() - startedAt;
    console.log("[listnotifications] ok", {
      requestId,
      email,
      dealId,
      includeRead,
      count: rows.length,
      timings,
      analyticsAuthorized,
      canViewFirmDeals,
    });

    return sendJson(
      res,
      200,
      responseEnvelope({
        status: "success",
        requestId,
        message: "Notifications loaded",
        data: { count: rows.length, rows, notifications: rows },
      })
    );
  } catch (err) {
    const totalMs = nowMs() - startedAt;
    console.error("[listnotifications] error", {
      requestId,
      endpoint,
      message: err?.message || String(err),
      statusCode: err?.statusCode || 500,
      totalMs,
      timings,
      stack: err?.stack,
    });

    const statusCode = err?.statusCode || 500;
    return sendJson(
      res,
      statusCode,
      responseEnvelope({
        status: "error",
        requestId,
        message: statusCode === 504 ? "Notification request timed out" : "Internal error",
        details: shortError(err?.message || err),
      })
    );
  }
};
