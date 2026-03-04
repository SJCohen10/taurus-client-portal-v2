"use strict";

const { crmRequest } = require("./lib/crm");
const { handleOptions, sendJson, enforceUserContext, enforceRateLimit, parseQuery } = require("./lib/security");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getAvsBankDetailsForAccount(accountId) {
  const criteria = `((Account:equals:${accountId}) and (AVS:equals:true))`;
  const json = await crmRequest({ method: "GET", path: "/Bank_Details/search", query: { criteria, per_page: 200, page: 1 } });
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

async function getContactAndAccountByEmail(email) {
  const search = await crmRequest({ method: "GET", path: "/Contacts/search", query: { email } });
  const contacts = search.data || [];
  if (!contacts.length) {
    const err = new Error("No CRM Contact found for email");
    err.statusCode = 404;
    throw err;
  }

  const contact = contacts[0];
  const contactId = contact.id;
  const contactFirstName = contact.First_Name || "";
  const contactLastName = contact.Last_Name || "";
  const fullName = contact.Full_Name || [contactFirstName, contactLastName].filter(Boolean).join(" ");
  const portalRole = contact.Portal_Role || null;
  const contactEmail = contact.Email || "";
  const contactMobile = contact.Mobile || contact.Phone || "";
  const canViewFirmDealsRaw = contact.Can_View_Firm_Deals;
  const canViewFirmDeals = canViewFirmDealsRaw === true || canViewFirmDealsRaw === "true" || canViewFirmDealsRaw === "Yes";

  const accountLookup = contact.Account_Name || contact.Account || {};
  const accountId = accountLookup.id;
  if (!accountId) {
    const err = new Error("CRM Contact has no linked Account");
    err.statusCode = 400;
    throw err;
  }

  const accountData = await crmRequest({ method: "GET", path: `/Accounts/${accountId}` });
  const accountRecord = (accountData.data && accountData.data[0]) || {};

  const bankDetails = await getAvsBankDetailsForAccount(accountId);
  const preferredLookup = accountRecord.Preferred_Quick_Rates_Bank_Accounts || null;
  const preferredBankId = preferredLookup?.id || null;
  const defaultBankDetailId = preferredBankId || (bankDetails.length ? bankDetails[0].id : null);

  let preferredQuickBridgeBank = null;
  if (preferredBankId) {
    const bdData = await crmRequest({ method: "GET", path: `/Bank_Details/${preferredBankId}` });
    const bd = (bdData.data && bdData.data[0]) || {};
    preferredQuickBridgeBank = {
      id: preferredBankId,
      bank: bd.Bank || "",
      name: bd.Name || "",
      accountNumber: bd.Account_Number || "",
    };
  }

  return {
    contactId,
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
    canViewFirmDeals,
    accountMobile: accountRecord.Phone || contactMobile,
    directorName: accountRecord.Quick_Rates_Director_Name,
    directorEmail: accountRecord.Quick_Rates_Director_Email || "",
    quickBridgeLimit: accountRecord.Quick_Bridge_Limit || 120000,
    preferredQuickBridgeBank,
    bankDetails,
    defaultBankDetailId,
  };
}

module.exports = async (req, res) => {
  try {
    if (handleOptions(req, res)) return;
    if (req.method !== "GET") return sendJson(req, res, 405, { error: "Method not allowed. Use GET." });

    const query = parseQuery(req);
    const email = enforceUserContext(req, query.get("email"));
    if (!EMAIL_REGEX.test(email)) return sendJson(req, res, 400, { error: "Invalid email context" });
    enforceRateLimit({ key: `getportalusercontext:${email}`, limit: 30, windowMs: 60000 });

    const context = await getContactAndAccountByEmail(email);
    return sendJson(req, res, 200, context);
  } catch (err) {
    console.error("getPortalUserContext failed", { message: err.message });
    return sendJson(req, res, err.statusCode || 500, { error: err.statusCode ? err.message : "Internal server error" });
  }
};
