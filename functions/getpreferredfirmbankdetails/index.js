"use strict";

const { URL } = require("url");
const fetch = require("node-fetch");

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

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
  const r = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Failed to get access token (${r.status}): ${text || "No response body"}`);
  }

  const data = await r.json();
  if (!data.access_token) throw new Error("No access_token returned by Zoho");
  return data.access_token;
}

async function crmGet(base, accessToken, path) {
  const url = `${base}${path}`;
  const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Zoho CRM GET failed (${r.status}) ${path}: ${text || "No response body"}`);
  }
  return r.json();
}

module.exports = async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, "http://dummy-host");
    const email = parsedUrl.searchParams.get("email");

    if (!email) return sendJson(res, 400, { error: "Missing 'email' query parameter." });

    const base = process.env.ZOHO_CRM_SANDBOX_BASE || "https://crmsandbox.zoho.com";
    const accessToken = await getAccessToken();

    // 1) Contact by email (same as your getPortalUserContext)
    const search = await crmGet(
      base,
      accessToken,
      `/crm/v6/Contacts/search?email=${encodeURIComponent(email)}`
    );

    const contact = (search.data || [])[0];
    if (!contact) throw new Error(`No CRM Contact found for email: ${email}`);

    const accountLookup = contact.Account_Name || contact.Account || {};
    const accountId = accountLookup.id;
    if (!accountId) throw new Error("Contact has no linked firm Account.");

    // 2) Fetch firm Account (to get Preferred_Quick_Rates_Bank_Accounts lookup)
    const accResp = await crmGet(base, accessToken, `/crm/v6/Accounts/${accountId}`);
    const account = (accResp.data || [])[0] || {};

    const preferredLookup = account.Preferred_Quick_Rates_Bank_Accounts;
    const bankDetailsId = preferredLookup?.id;

    if (!bankDetailsId) {
      return sendJson(res, 200, {
        accountId,
        hasPreferred: false,
        message: "Firm has no Preferred_Quick_Rates_Bank_Accounts set.",
      });
    }

    // 3) Fetch that Bank_Details record
    const bdResp = await crmGet(base, accessToken, `/crm/v6/Bank_Details/${bankDetailsId}`);
    const bd = (bdResp.data || [])[0] || {};

    // ⚠️ These three field API names in Bank_Details must match your CRM.
    // If they differ, just change them here.
    const bankName = bd.Bank_Name || bd.Bank || bd.Name || "";
    const accountName = bd.Account_Name || bd.Account_Holder_Name || "";
    const accountNumber = bd.Account_Number || "";

    return sendJson(res, 200, {
      accountId,
      hasPreferred: true,
      bankDetailsId,
      bankName,
      accountName,
      accountNumber,
    });
  } catch (err) {
    console.error("Error in getpreferredfirmbankdetails:", err);
    return sendJson(res, 500, {
      error: "Internal server error in getpreferredfirmbankdetails.",
      details: err.message,
    });
  }
};
