"use strict";

// Ported from getPortalUserContext/lib/security.js.
//
// The Catalyst SDK is the only identity source here, and the only one with any
// provenance: it reads the caller's own session off the request. The x-zc-*
// email headers were a second tier until audit finding 4 confirmed a
// session-less request carrying one resolved as that user, so they are gone.
//
// resolveCatalystUserEmail returns null when it cannot resolve an email, and the
// caller turns that into a 401. It no longer throws a 401 of its own: with the
// marker gate removed it is attempted on anonymous requests too, where "no
// identity" is the expected answer rather than an error.
//
// lib/ is duplicated per function (finding 15), so this change is applied to each
// copy individually rather than shared.

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

// TEMP-FINDING4-DIAG - remove once a real logged-in session is confirmed to
// resolve via the SDK in production.
//
// Logs what the SDK resolved, so that confirmation is positive rather than
// inferred from the absence of a 401. It also reports whether the old
// getUserDetails(x-zc-user-id) tier WOULD have resolved, because if
// getCurrentUser turns out not to work that is the first thing worth knowing.
// That tier is diagnostic only: its result is never returned and never feeds the
// identity decision. Nothing in here throws - diagnostics must not fail a
// request - and nothing in here is read by the caller.
async function logFinding4Diag({ fnName, requestId, req, meta, attempts, sdkResolved, userManagement }) {
  let userDetailsWouldResolve = null;
  const userId = String(req?.headers?.["x-zc-user-id"] || "").trim();

  if (userManagement && userId) {
    try {
      const userById = await userManagement.getUserDetails(userId);
      userDetailsWouldResolve = Boolean(
        getFirstEmailCandidate(getEmailCandidateFields("catalyst.userDetails", userById || {}))
      );
    } catch {
      userDetailsWouldResolve = false;
    }
  }

  try {
    console.info("TEMP-FINDING4-DIAG", {
      fn: fnName,
      requestId,
      hadReqUser: Boolean(req?.user),
      reqUserEmail: normalizeEmail(req?.user?.email) || null,
      sdkEmail: sdkResolved?.email || null,
      sdkSource: sdkResolved?.source || null,
      sdkAttempts: attempts,
      hasZcUserId: meta.hasZcUserId,
      hasZcUserCredToken: meta.hasZcUserCredToken,
      userType: meta.userType,
      // Diagnostic only - this tier no longer feeds the identity decision.
      userDetailsWouldResolve,
    });
  } catch {
    // Never let a log line break a request.
  }
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
// clothing - so it no longer participates. See logFinding4Diag above.
async function resolveCatalystUserEmail(req, requestId, fnName) {
  const meta = getCatalystIdentityMeta(req);
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

  let sdkResolved = null;

  if (userManagement) {
    try {
      const currentUser = await userManagement.getCurrentUser();
      attempts.push("current_user");
      sdkResolved = getFirstEmailCandidate(getEmailCandidateFields("catalyst.currentUser", currentUser || {}));
    } catch (err) {
      attempts.push("current_user_failed");
      console.warn(`${fnName} Catalyst current user lookup failed`, {
        requestId,
        hasZcUserId: meta.hasZcUserId,
        userType: meta.userType,
        message: err.message,
      });
    }
  }

  await logFinding4Diag({ fnName, requestId, req, meta, attempts, sdkResolved, userManagement });

  return sdkResolved;
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
