"use strict";

const { crmRequest } = require("./crm");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseCanViewFirmDeals(value) {
  return value === true || value === "true" || value === "Yes";
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
    const err = new Error("No CRM Contact found for email");
    err.statusCode = 404;
    throw err;
  }

  const contact = contacts[0] || {};
  const accountLookup = contact.Account_Name || contact.Account || {};

  return {
    contactId: contact.id || null,
    email: normalizeEmail(contact.Email || normalizedEmail),
    accountId: accountLookup.id || null,
    canViewFirmDeals: parseCanViewFirmDeals(contact.Can_View_Firm_Deals),
  };
}

module.exports = {
  resolvePortalUserContextByEmail,
};
