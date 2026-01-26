'use strict';

const { URL } = require("url");
const fetch = require("node-fetch");

/**
 * Helper to send JSON responses using Node's HTTP API.
 */
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}


/**
 * Fetch a fresh access token from Zoho using the refresh token.
 */
async function getAccessToken() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Zoho OAuth environment variables: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN"
    );
  }

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const accountsBase = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com";
  const tokenUrl = `${accountsBase}/oauth/v2/token`;


  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to get access token (${res.status}): ${text || "No response body"}`
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("No access_token returned by Zoho");
  }

  const apiDomain = process.env.ZOHO_API_DOMAIN || data.api_domain || "https://www.zohoapis.com";
  return { accessToken: data.access_token, apiDomain };


}

async function getAvsBankDetailsForAccount({ accessToken, crmBase, accountId }) {
  const criteria = `((Account:equals:${accountId}) and (AVS:equals:true))`;

  const url = `${crmBase}/Bank_Details/search?criteria=${encodeURIComponent(criteria)}&per_page=200&page=1`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: "application/json",
    },
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      `Zoho CRM Bank_Details search failed (${res.status}): ${raw || "No response body"}`
    );
  }

  const json = raw ? JSON.parse(raw) : {};
  const records = json.data || [];

  return records.map((bd) => {
    const accountNumber = bd.Account_Number || "";
    const last4 = accountNumber ? String(accountNumber).slice(-4) : "";
    return {
      id: bd.id,               // ✅ CRM Bank Detail record id
      bank: bd.Bank || "",
      name: bd.Name || "",
      accountNumber,           // optional (you’re already sending it today)
      accountNumberLast4: last4,
      label: `${bd.Bank || "Bank"} – ${bd.Name || "Account"}${last4 ? ` – ****${last4}` : ""}`,
    };
  });
}



/**
 * Fetch Contact and Account from Zoho CRM Sandbox by email.
 */
async function getContactAndAccountByEmail(email) {
  const { accessToken, apiDomain } = await getAccessToken();
  const crmVersion = process.env.ZOHO_CRM_VERSION || "v6";
  const crmBase = `${apiDomain}/crm/${crmVersion}`;


  // 1) Search Contact by Email
  const searchUrl = `${crmBase}/Contacts/search?email=${encodeURIComponent(email)}`;

  const searchRes = await fetch(searchUrl, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: "application/json",
    },
  });

  const raw = await searchRes.text();

  console.log("[getPortalUserContext] Contact search status =", searchRes.status);
  console.log("[getPortalUserContext] Contact search raw (first 300) =", raw?.slice(0, 300));

  if (!searchRes.ok) {
    throw new Error(
      `Zoho CRM contact search failed (${searchRes.status}): ${raw || "No response body"}`
    );
  }

  let searchData;
  try {
    searchData = raw ? JSON.parse(raw) : {};
  } catch (e) {
    throw new Error(
      `Failed to parse Contacts search JSON (${searchRes.status}). First 300 chars: ${raw?.slice(0, 300) || "<empty>"}`
    );
  }

  const contacts = searchData.data || [];
  if (!contacts.length) {
    throw new Error(`No CRM Contact found for email: ${email}`);
  }

  const contact = contacts[0];
  const contactId = contact.id;
  const contactFirstName = contact.First_Name || "";
  const contactLastName = contact.Last_Name || "";
  const fullName = contact.Full_Name || [contactFirstName, contactLastName].filter(Boolean).join(" ");
  const portalRole = contact.Portal_Role || null;
  const contactEmail = contact.Email || "";
  const contactMobile = contact.Mobile || contact.Phone || "";

  const accountLookup = contact.Account_Name || contact.Account || {};
  const accountId = accountLookup.id;

  if (!accountId) {
    throw new Error(`CRM Contact ${contactId} has no linked Account (Account_Name lookup missing).`);
  }

  // 2) Fetch Account details (full record to include custom firm fields)
  const accountUrl = `${crmBase}/Accounts/${accountId}`;

  const accountRes = await fetch(accountUrl, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      Accept: "application/json",
    },
  });

  const accountRaw = await accountRes.text();
  if (!accountRes.ok) {
    throw new Error(
      `Zoho CRM account fetch failed (${accountRes.status}): ${accountRaw || "No response body"}`
    );
  }

  const accountData = accountRaw ? JSON.parse(accountRaw) : {};
  const accountRecord = (accountData.data && accountData.data[0]) || {};

  // ✅ Fetch ALL AVS-verified bank details linked to this firm account
  const bankDetails = await getAvsBankDetailsForAccount({
    accessToken,
    crmBase,
    accountId,
  });


  // Preferred bank lookup
  const preferredLookup = accountRecord.Preferred_Quick_Rates_Bank_Accounts || null;
  const preferredBankId = preferredLookup?.id || null;

  // ✅ Default selection: preferred Quick Rates bank first, else first AVS bank detail
  const defaultBankDetailId =
    preferredBankId || (bankDetails.length ? bankDetails[0].id : null);


  let preferredQuickBridgeBank = null;

  if (preferredBankId) {
    const bankDetailsUrl = `${crmBase}/Bank_Details/${preferredBankId}`;

    const bdRes = await fetch(bankDetailsUrl, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        Accept: "application/json",
      },
    });

    const bdRaw = await bdRes.text();
    if (!bdRes.ok) {
      throw new Error(
        `Zoho CRM bank details fetch failed (${bdRes.status}): ${bdRaw || "No response body"}`
      );
    }

    const bdData = bdRaw ? JSON.parse(bdRaw) : {};
    const bd = (bdData.data && bdData.data[0]) || {};

    preferredQuickBridgeBank = {
      id: preferredBankId,
      bank: bd.Bank || "",
      name: bd.Name || "",
      accountNumber: bd.Account_Number || "",
    };
  }

  const accountName = accountRecord.Account_Name || "";
  const firmRegNumber =
    accountRecord.Reg_Number ||
    accountRecord.Firm_Reg_Number ||
    accountRecord.Firm_Registration_Number ||
    "";
  const firmStreetAddress =
    accountRecord.Billing_Street ||
    accountRecord.Shipping_Street ||
    "";
  const firmCity =
    accountRecord.Billing_City ||
    accountRecord.Shipping_City ||
    "";
  const firmProvince =
    accountRecord.Billing_State ||
    accountRecord.Shipping_State ||
    "";
  const firmZipCode =
    accountRecord.Billing_Code ||
    accountRecord.Shipping_Code ||
    "";
  const accountEmail = accountRecord.Email || contactEmail;
  const accountMobile = accountRecord.Phone || contactMobile;

  const directorName = accountRecord.Quick_Rates_Director_Name;
  const directorEmail = accountRecord.Quick_Rates_Director_Email || "";
  const quickBridgeLimit = accountRecord.Quick_Bridge_Limit || 120000;

  return {
    contactId,
    contactName: fullName,
    contactEmail,
    contactFirstName,
    contactLastName,
    contactMobile,
    portalRole,
    accountId,
    accountName,
    firmRegNumber,
    firmStreetAddress,
    firmCity,
    firmProvince,
    firmZipCode,
    accountEmail,
    accountMobile,
    directorName,
    directorEmail,
    quickBridgeLimit,
    preferredQuickBridgeBank,
    bankDetails,
    defaultBankDetailId,
  };
}


/**
 * Function Entry Point
 */
module.exports = async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, "http://dummy-host");
    const email = parsedUrl.searchParams.get("email");

    if (!email) {
      return sendJson(res, 400, {
        error: "Missing 'email' query parameter.",
      });
    }

    const context = await getContactAndAccountByEmail(email);

    return sendJson(res, 200, context);
  } catch (err) {
    console.error("Error in getPortalUserContext:", err);

    return sendJson(res, 500, {
      error: "Internal server error in getPortalUserContext.",
      details: err.message,
    });
  }
};
