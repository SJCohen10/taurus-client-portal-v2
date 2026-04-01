// client/src/services/portalApi.js

import { request } from "../api/catalystClient";

function getDevImpersonationEmail() {
  if (process.env.NODE_ENV !== "development") return "";
  return (process.env.REACT_APP_DEV_IMPERSONATE_EMAIL || "").trim().toLowerCase();
}

function getPortalUserEmail(explicitEmail) {
  if (explicitEmail) {
    return explicitEmail;
  }
  // 1) Real user from Catalyst auth (in prod)
  if (window?.portalUser?.email) {
    return window.portalUser.email;
  }

  // 2) In development, optional impersonation for local testing
  const devEmail = getDevImpersonationEmail();
  if (devEmail) {
    return devEmail;
  }

  // 3) In production, fail if no user
  throw new Error("Missing logged-in user email");
}

function normalizeDeal(deal = {}) {
  const seller = deal.seller ?? deal.Seller ?? deal["Seller"] ?? deal["seller"] ?? null;
  const propertyFolderId =
    deal.propertyFolderId ??
    deal.property_folder_id ??
    deal["Property Folder Id"] ??
    deal["Property Folder ID"] ??
    deal["Workdrive Folder ID"] ??
    deal["WorkDrive Folder ID"] ??
    null;
  const normalizedDealId = deal.dealId ?? deal.deal_id ?? deal["Deal_Id"] ?? deal["Deal Id"] ?? null;
  const normalizedPropertyRef = deal.propertyRefNumber ?? deal.property_ref_number ?? deal["Property Ref Number"] ?? null;
  const normalizedDescription = deal.propertyDescription ?? deal.property_description ?? deal["Property Description"] ?? null;

  return {
    ...deal,
    seller,
    propertyFolderId,
    dealId: normalizedDealId,
    propertyRefNumber: normalizedPropertyRef,
    propertyDescription: normalizedDescription,
  };
}

function normalizeDealsPayload(payload = {}) {
  return {
    ...payload,
    deals: Array.isArray(payload.deals) ? payload.deals.map(normalizeDeal) : [],
  };
}

// Deals for the logged-in portal user (paralegal / conveyancer)
export async function fetchMyDeals(emailOverride) {
  const email = getPortalUserEmail(emailOverride);
  const data = await request("/getportaldeals", { query: { email } });
  return normalizeDealsPayload(data);
}


// 👇 Firm deals – prefer AccountId so one firm can see all contacts' deals
export async function fetchFirmDeals({ accountId, fallbackEmail } = {}) {
  const email = getPortalUserEmail(fallbackEmail);

  const params = new URLSearchParams();

  if (accountId) {
    params.set("accountId", accountId);
  }

  if (email) {
    params.set("email", email);
  }

  const data = await request("/getportaldeals", { query: Object.fromEntries(params.entries()) });
  return normalizeDealsPayload(data);
}

export async function fetchDealTransactions({ assetIds, email }) {
  const safeEmail = getPortalUserEmail(email);
  const params = new URLSearchParams();
  params.set("assetIds", String(assetIds || ""));
  if (safeEmail) params.set("email", safeEmail);

  return request("/getdealtransactions", { query: Object.fromEntries(params.entries()) });
}

export async function createNote(payload) {
  return request("/createnote", { method: "POST", body: payload });
}

export async function updateExpectedLodgementDate(payload) {
  return request("/updateexpectedlodgementdate", { method: "POST", body: payload });
}

export async function updateMatterLodged(payload) {
  return request("/updatematterlodged", { method: "POST", body: payload });
}




//Upload a document for a specific deal/property
export async function uploadDealDocument(payload) {
  return request("/uploaddealdocument", { method: "POST", body: payload });
}

export async function fetchBankDetailsForAccount({ accountId, avsOnly = false }) {
  if (!accountId) throw new Error("Missing accountId");
  const data = await request("/getbankdetailsforaccount", { query: { accountId, avsOnly: avsOnly ? "true" : "false" } });
  return normalizeDealsPayload(data);
}


// Generate a statement using the Creator-backed logic
export async function generateStatement({ assetId, email }) {
  const safeEmail = getPortalUserEmail(email);

  return request("/generatestatement", {
    method: "POST",
    body: {
      assetId,
      email: safeEmail,
    },
  });
}

// --- Notifications (Catalyst Data Store) ---

export async function listNotifications({ email, dealId, includeRead = false, signal } = {}) {
  const safeEmail = getPortalUserEmail(email);

  if (!dealId) throw new Error("Missing dealId");

  const params = new URLSearchParams();
  if (safeEmail) params.set("email", safeEmail);
  params.set("dealId", String(dealId));
  params.set("includeRead", includeRead ? "true" : "false");

  return request("/listnotifications", { query: Object.fromEntries(params.entries()), signal });
}

export async function createNotification(payload) {
  return request("/createnotification", { method: "POST", body: payload });
}

export async function markNotificationRead({ id, email }) {
  return request("/marknotificationread", { method: "POST", body: { id, email: email || "" } });
}
