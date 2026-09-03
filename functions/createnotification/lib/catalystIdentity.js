"use strict";

// Ported from getPortalUserContext/lib/security.js.
//
// The x-zc-* email headers do not resolve in this environment, so the Catalyst
// SDK is the path that actually returns an email for an authenticated portal
// user. Logs from the commit that introduced this confirmed the SDK is the
// resolving tier on every guarded endpoint.
//
// resolveCatalystUserEmail throws 401 when a Catalyst identity marker is present
// but no email can be read from it. A marker means the caller is authenticated,
// so failing to read their email is an error, not a reason to fall back to
// anything the client supplied.

const catalyst = require("zcatalyst-sdk-node");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
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

// Returns { email, source } when the SDK resolves an email.
// Returns null when there is no Catalyst identity marker at all, leaving the
// caller to reject the request.
// Throws 401 when a marker is present but no email could be read from it.
async function resolveCatalystUserEmail(req, requestId, fnName) {
  const headers = req?.headers || {};
  const userId = String(headers["x-zc-user-id"] || "").trim();
  const meta = getCatalystIdentityMeta(req);
  if (!meta.hasZcUserId && !meta.hasZcUserCredToken) return null;

  const attempts = [];
  let userManagement = null;

  try {
    const app = catalyst.initialize(req, { type: "advancedio" });
    userManagement = app.userManagement();
  } catch (err) {
    attempts.push("initialize_failed");
    console.warn(`${fnName} Catalyst SDK initialize failed`, {
      requestId,
      hasZcUserId: meta.hasZcUserId,
      userType: meta.userType,
      message: err.message,
    });
  }

  if (userManagement) {
    try {
      const currentUser = await userManagement.getCurrentUser();
      attempts.push("current_user");
      const resolved = getFirstEmailCandidate(getEmailCandidateFields("catalyst.currentUser", currentUser || {}));
      if (resolved) return resolved;
    } catch (err) {
      attempts.push("current_user_failed");
      console.warn(`${fnName} Catalyst current user lookup failed`, {
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
        console.warn(`${fnName} Catalyst user id lookup failed`, {
          requestId,
          hasZcUserId: meta.hasZcUserId,
          userType: meta.userType,
          message: err.message,
        });
      }
    }
  }

  const err = new Error("Authenticated Catalyst user did not include an email context");
  err.statusCode = 401;
  err.details = { catalystIdentityPresent: true, hasZcUserId: meta.hasZcUserId, userType: meta.userType, attempts };
  throw err;
}

// One line per request so the Catalyst logs show which tier resolved the
// identity. Kept in place deliberately while the guards are being tightened.
function logIdentitySource(fnName, requestId, source, req) {
  const meta = getCatalystIdentityMeta(req);
  console.info(`${fnName} identity resolved`, {
    requestId,
    identitySource: source || "none",
    hasZcUserId: meta.hasZcUserId,
    hasZcUserCredToken: meta.hasZcUserCredToken,
    userType: meta.userType,
  });
}

module.exports = {
  normalizeEmail,
  getEmailCandidateFields,
  getFirstEmailCandidate,
  hasCatalystUserMarker,
  getCatalystIdentityMeta,
  resolveCatalystUserEmail,
  logIdentitySource,
};
