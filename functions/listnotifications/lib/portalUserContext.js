"use strict";

const { crmRequest } = require("./crm");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseCanViewFirmDeals(value) {
  return value === true || value === "true" || value === "Yes";
}

function isEnabled(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }
  return false;
}

function isActiveStatus(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "active";
}

function denyAccess(reasonCode, message) {
  const err = new Error(message || "Portal access validation failed");
  err.statusCode = 403;
  err.reasonCode = reasonCode;
  return err;
}

async function resolvePortalUserContextByEmail({ email, requestId }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    const err = new Error("Missing email for portal user resolution");
    err.statusCode = 400;
    throw err;
  }

  const search = await crmRequest({
    method: "GET",
    path: "/Contacts/search",
    query: { email: normalizedEmail },
    requestId,
  });

  const contacts = search.data || [];
  if (!contacts.length) {
    throw denyAccess("CONTACT_NOT_FOUND", "No CRM Contact found for email");
  }

  const contact = contacts[0] || {};
  const accountLookup = contact.Account_Name || contact.Account || {};
  const accountId = accountLookup.id || null;

  if (!isEnabled(contact.Portal_Access_Enabled)) {
    throw denyAccess("CONTACT_PORTAL_ACCESS_DISABLED", "Contact portal access is disabled");
  }

  if (!isActiveStatus(contact.Portal_Status)) {
    throw denyAccess("CONTACT_PORTAL_STATUS_NOT_ACTIVE", "Contact portal status is not active");
  }

  if (!accountId) {
    throw denyAccess("CONTACT_ACCOUNT_MISSING", "CRM Contact has no linked Account");
  }

  const accountData = await crmRequest({ method: "GET", path: `/Accounts/${accountId}`, requestId });
  const account = (accountData.data && accountData.data[0]) || {};

  if (!isEnabled(account.Portal_Enabled)) {
    throw denyAccess("ACCOUNT_PORTAL_DISABLED", "Account portal access is disabled");
  }

  if (!isActiveStatus(account.Portal_Status)) {
    throw denyAccess("ACCOUNT_PORTAL_STATUS_NOT_ACTIVE", "Account portal status is not active");
  }

  console.info("portal access validation passed", {
    requestId,
    emailDomain: normalizedEmail.split("@")[1] || "",
    contactId: contact.id || null,
    accountId,
  });

  return {
    contactId: contact.id || null,
    email: normalizeEmail(contact.Email || normalizedEmail),
    accountId,
    accountName: account.Account_Name || accountLookup.name || "",
    canViewFirmDeals: parseCanViewFirmDeals(contact.Can_View_Firm_Deals),
    contact,
    account,
    portalAccess: {
      contactPortalAccessEnabled: true,
      contactPortalStatus: contact.Portal_Status || null,
      accountPortalEnabled: true,
      accountPortalStatus: account.Portal_Status || null,
    },
  };
}

module.exports = {
  resolvePortalUserContextByEmail,
  isEnabled,
  isActiveStatus,
};
