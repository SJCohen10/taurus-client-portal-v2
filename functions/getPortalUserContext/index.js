"use strict";

const { crmRequest, createRequestId } = require("./lib/crm");
const { resolvePortalUserContextByEmail } = require("./lib/portalUserContext");
const { handleOptions, sendJson, resolveUserContext, getAuthContextDebugMeta, enforceRateLimit, parseQuery } = require("./lib/security");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isDebugDetailsEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.CATALYST_STAGE === "Development";
}
function isAuthContextDebugEnabled() {
  return String(process.env.PORTAL_DEBUG_AUTH_CONTEXT || "false").toLowerCase() === "true";
}
function isRawRequestDiagnosticsEnabled() {
  return process.env.NODE_ENV !== "production" || String(process.env.PORTAL_DEBUG_RAW_REQUEST || "false").toLowerCase() === "true";
}
function isPortalContextDebugEnabled() {
  return process.env.NODE_ENV !== "production" || String(process.env.PORTAL_DEBUG_USER_CONTEXT || "false").toLowerCase() === "true";
}
function portalContextDebugLog(message, data = {}) {
  if (!isPortalContextDebugEnabled()) return;
  console.info(message, data);
}

function getEnvPresenceSummary() {
  const accountsUrlUsed = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
  return {
    clientIdPresent: Boolean(process.env.ZOHO_CLIENT_ID),
    clientSecretPresent: Boolean(process.env.ZOHO_CLIENT_SECRET),
    refreshTokenPresent: Boolean(process.env.ZOHO_REFRESH_TOKEN),
    accountsUrlUsed,
  };
}

function assertRequiredOAuthEnv(requestId) {
  const summary = getEnvPresenceSummary();
  const missing = [];
  if (!summary.clientIdPresent) missing.push("ZOHO_CLIENT_ID");
  if (!summary.clientSecretPresent) missing.push("ZOHO_CLIENT_SECRET");
  if (!summary.refreshTokenPresent) missing.push("ZOHO_REFRESH_TOKEN");

  if (missing.length) {
    console.error("getPortalUserContext env check failed", { requestId, missing, accountsUrlUsed: summary.accountsUrlUsed });
    const err = new Error(`Missing required OAuth env vars for getportalusercontext: ${missing.join(", ")}`);
    err.statusCode = 500;
    err.details = { missing, accountsUrlUsed: summary.accountsUrlUsed };
    throw err;
  }

  portalContextDebugLog("getPortalUserContext env check", { requestId, ...summary });
  return summary;
}

async function getAvsBankDetailsForAccount(accountId, requestId) {
  const criteria = `((Account:equals:${accountId}) and (AVS:equals:true))`;
  const json = await crmRequest({ method: "GET", path: "/Bank_Details/search", query: { criteria, per_page: 200, page: 1 }, requestId });
  const records = json.data || [];
  return records.map((bd) => {
    const accountNumber = bd.Account_Number || "";
    const last4 = accountNumber ? String(accountNumber).slice(-4) : "";
    return {
      id: bd.id,
      bank: bd.Bank || "",
      name: bd.Name || "",
      accountNumber,
      accountNumberLast4: last4,
      label: `${bd.Bank || "Bank"} – ${bd.Name || "Account"}${last4 ? ` – ****${last4}` : ""}`,
    };
  });
}

async function getContactAndAccountByEmail(email, requestId) {
  const portalUser = await resolvePortalUserContextByEmail({ email, requestId });
  const contact = portalUser.contact || {};

  const contactFirstName = contact.First_Name || "";
  const contactLastName = contact.Last_Name || "";
  const fullName = contact.Full_Name || [contactFirstName, contactLastName].filter(Boolean).join(" ");
  const portalRole = contact.Portal_Role || null;
  const contactEmail = portalUser.email || "";
  const contactMobile = contact.Mobile || contact.Phone || "";

  const accountId = portalUser.accountId;
  const accountRecord = portalUser.account || {};

  const bankDetails = await getAvsBankDetailsForAccount(accountId, requestId);
  const preferredLookup = accountRecord.Preferred_Quick_Rates_Bank_Accounts || null;
  const preferredBankId = preferredLookup?.id || null;
  const defaultBankDetailId = preferredBankId || (bankDetails.length ? bankDetails[0].id : null);

  let preferredQuickBridgeBank = null;
  if (preferredBankId) {
    const bdData = await crmRequest({ method: "GET", path: `/Bank_Details/${preferredBankId}`, requestId });
    const bd = (bdData.data && bdData.data[0]) || {};
    preferredQuickBridgeBank = {
      id: preferredBankId,
      bank: bd.Bank || "",
      name: bd.Name || "",
      accountNumber: bd.Account_Number || "",
    };
  }

  return {
    contactId: portalUser.contactId,
    contactName: fullName,
    contactEmail,
    contactFirstName,
    contactLastName,
    contactMobile,
    portalRole,
    accountId,
    accountName: accountRecord.Account_Name || "",
    firmRegNumber: accountRecord.Reg_Number || accountRecord.Firm_Reg_Number || accountRecord.Firm_Registration_Number || "",
    firmStreetAddress: accountRecord.Billing_Street || accountRecord.Shipping_Street || "",
    firmCity: accountRecord.Billing_City || accountRecord.Shipping_City || "",
    firmProvince: accountRecord.Billing_State || accountRecord.Shipping_State || "",
    firmZipCode: accountRecord.Billing_Code || accountRecord.Shipping_Code || "",
    accountEmail: accountRecord.Email || contactEmail,
    canViewFirmDeals: portalUser.canViewFirmDeals,
    portalAccess: portalUser.portalAccess,
    accountMobile: accountRecord.Phone || contactMobile,
    directorName: accountRecord.Quick_Rates_Director_Name,
    directorEmail: accountRecord.Quick_Rates_Director_Email || "",
    quickBridgeLimit: accountRecord.Quick_Bridge_Limit || 120000,
    // Account-level Agent Advance gating flags. These only gate the Agent Advance
    // feature; they do not affect general portal access.
    conveyancingFirmLoanEnabled: accountRecord.Conveyancing_Firm_Loan_Enabled || "",
    conveyancingFirmLoanStatus: accountRecord.Conveyancing_Firm_Loan_Status || "",
    preferredQuickBridgeBank,
    bankDetails,
    defaultBankDetailId,
  };
}

module.exports = async (req, res) => {
  const requestId = createRequestId();
  const catalystIdentityMeta = {
    hasZcUserId: Boolean(req.headers?.["x-zc-user-id"]),
    hasZcUserCredToken: Boolean(req.headers?.["x-zc-user-cred-token"]),
    userType: String(req.headers?.["x-zc-user-type"] || ""),
  };
  portalContextDebugLog("getPortalUserContext request", {
    requestId,
    method: req.method,
    hasZcUserId: catalystIdentityMeta.hasZcUserId,
    userType: catalystIdentityMeta.userType,
  });
  if (isRawRequestDiagnosticsEnabled()) {
    console.info("getPortalUserContext raw request diagnostics", {
      requestId,
      method: req.method,
      url: req.url,
      hasUser: Boolean(req.user),
      userKeys: req.user ? Object.keys(req.user) : [],
      headerNames: Object.keys(req.headers || {}).sort(),
      hasCookieHeader: Boolean(req.headers?.cookie),
      hasAuthorizationHeader: Boolean(req.headers?.authorization),
    });
  }
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "GET") return sendJson(req, res, 405, { error: "Method not allowed. Use GET.", requestId });

    assertRequiredOAuthEnv(requestId);

    const query = parseQuery(req);
    const requestedEmail = query.get("email");
    const authDebugMeta = getAuthContextDebugMeta(req);
    if (isAuthContextDebugEnabled()) {
      console.info("getPortalUserContext auth context debug", { requestId, ...authDebugMeta });
    }
    let resolvedUser;
    try {
      resolvedUser = await resolveUserContext(req, requestedEmail, requestId);
    } catch (identityErr) {
      console.warn("getPortalUserContext identity resolution failed", {
        requestId,
        message: identityErr.message,
        hasZcUserId: catalystIdentityMeta.hasZcUserId,
        userType: catalystIdentityMeta.userType,
        hadReqUser: authDebugMeta.hadReqUser,
        hasAnyCandidateEmail: authDebugMeta.hasAnyCandidateEmail,
        hasRequestedEmail: Boolean(String(requestedEmail || "").trim()),
      });
      throw identityErr;
    }
    const email = resolvedUser.email;
    if (!EMAIL_REGEX.test(email)) {
      console.warn("getPortalUserContext invalid resolved email", { requestId, source: resolvedUser.source });
      return sendJson(req, res, 400, { error: "Invalid email context", requestId });
    }
    portalContextDebugLog("getPortalUserContext resolved identity", { requestId, source: resolvedUser.source, emailDomain: email.split("@")[1] || "" });
    enforceRateLimit({ key: `getportalusercontext:${email}`, limit: 30, windowMs: 60000 });

    const context = await getContactAndAccountByEmail(email, requestId);
    portalContextDebugLog("getPortalUserContext access granted", { requestId, emailDomain: email.split("@")[1] || "" });
    return sendJson(req, res, 200, { ...context, requestId });
  } catch (err) {
    if (err.statusCode === 403) {
      console.warn("getPortalUserContext access denied", { requestId, reasonCode: err.reasonCode || "ACCESS_DENIED", message: err.message });
    } else {
      console.error("getPortalUserContext failed", { requestId, message: err.message, details: err.details || null });
    }
    const payload = { error: err.statusCode ? err.message : "Internal server error", requestId };
    if (err.reasonCode) payload.reasonCode = err.reasonCode;
    if (isDebugDetailsEnabled() && err.details) payload.details = err.details;
    return sendJson(req, res, err.statusCode || 500, payload);
  }
};
