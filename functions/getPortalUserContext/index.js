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

  const tokenUrl = "https://accounts.zoho.com/oauth/v2/token";

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

  return data.access_token;
}

/**
 * Fetch Contact and Account from Zoho CRM Sandbox by email.
 */
async function getContactAndAccountByEmail(email) {
  const base = process.env.ZOHO_CRM_SANDBOX_BASE || "https://crmsandbox.zoho.com";

  const accessToken = await getAccessToken();

  // ---------------------------------------------
  // 1) Search CRM Contact by Email
  // ---------------------------------------------
  const searchUrl = `${base}/crm/v6/Contacts/search?email=${encodeURIComponent(email)}`;

  const searchRes = await fetch(searchUrl, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });

  if (!searchRes.ok) {
    const text = await searchRes.text();
    throw new Error(
      `Zoho CRM contact search failed (${searchRes.status}): ${text || "No response body"}`
    );
  }

  const searchData = await searchRes.json();
  const contacts = searchData.data || [];

  if (!contacts.length) {
    throw new Error(`No CRM Contact found for email: ${email}`);
  }

  const contact = contacts[0];

  const contactId = contact.id;
  const fullName =
    contact.Full_Name ||
    [contact.First_Name, contact.Last_Name].filter(Boolean).join(" ");
  const portalRole = contact.Portal_Role || null;
  const contactEmail = contact.Email;

  const accountLookup = contact.Account_Name || contact.Account || {};
  const accountId = accountLookup.id;

  if (!accountId) {
    throw new Error(
      `CRM Contact ${contactId} has no linked Account (Account_Name lookup missing).`
    );
  }

  // ---------------------------------------------
  // 2) Fetch Account details
  // ---------------------------------------------
  const accountUrl = `${base}/crm/v6/Accounts/${accountId}`;

  const accountRes = await fetch(accountUrl, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });

  if (!accountRes.ok) {
    const text = await accountRes.text();
    throw new Error(
      `Zoho CRM account fetch failed (${accountRes.status}): ${text || "No response body"}`
    );
  }

  const accountData = await accountRes.json();
  const accountRecord = (accountData.data && accountData.data[0]) || {};

  const accountName = accountRecord.Account_Name;
  const quickBridgeLimit = accountRecord.Quick_Bridge_Limit || 120000;

  return {
    contactId,
    contactName: fullName,
    contactEmail,
    portalRole,
    accountId,
    accountName,
    quickBridgeLimit,
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
