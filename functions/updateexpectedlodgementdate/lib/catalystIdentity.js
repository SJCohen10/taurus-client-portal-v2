"use strict";

// Ported from getPortalUserContext/lib/security.js.
//
// The x-zc-* email headers do not resolve in this environment, which is why
// setting NODE_ENV=production on the guarded endpoints returned 401 for every
// caller. getPortalUserContext was unaffected because it asks the Catalyst SDK
// for the current user instead of trusting a header. This module is that path,
// so the other endpoints can resolve identity the same way.
//
// Unlike the getPortalUserContext original, resolveCatalystUserEmail here never
// throws: it returns null when it cannot resolve. This step is purely additive
// for now, so a failure must fall through to the existing resolution order
// rather than turn into a 401.

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

// Returns { email, source } or null. Never throws.
async function resolveCatalystUserEmail(req, requestId, fnName) {
  const headers = req?.headers || {};
  const userId = String(headers["x-zc-user-id"] || "").trim();
  const meta = getCatalystIdentityMeta(req);
  if (!meta.hasZcUserId && !meta.hasZcUserCredToken) return null;

  const attempts = [];
  let userManagement;

  try {
    const app = catalyst.initialize(req, { type: "advancedio" });
    userManagement = app.userManagement();
  } catch (err) {
    console.warn(`${fnName} Catalyst SDK initialize failed`, {
      requestId,
      hasZcUserId: meta.hasZcUserId,
      userType: meta.userType,
      message: err.message,
    });
    return null;
  }

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

  console.warn(`${fnName} Catalyst identity present but no email resolved`, {
    requestId,
    hasZcUserId: meta.hasZcUserId,
    userType: meta.userType,
    attempts,
  });
  return null;
}

// One line per request so the Catalyst logs show which tier actually resolved
// the identity, before anything is removed from the resolution order.
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
