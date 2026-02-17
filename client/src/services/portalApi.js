// client/src/services/portalApi.js

// In dev: call the remote Catalyst backend directly
// In prod: use relative /server (works when app is hosted on Catalyst)
const API_BASE =
  process.env.NODE_ENV === "development"
    ? (process.env.REACT_APP_API_BASE || "https://taurus-client-portal-889090616.development.catalystserverless.com") + "/server"
    : "/server";

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

async function handleResponse(res) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

function normalizeDeal(deal = {}) {
  const seller = deal.seller ?? deal.Seller ?? deal["Seller"] ?? deal["seller"] ?? null;
  return {
    ...deal,
    seller,
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
  const url = `${API_BASE}/getportaldeals?email=${encodeURIComponent(email)}`;


  const res = await fetch(url, { method: "GET" });
  const data = await handleResponse(res);
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

  const url = `${API_BASE}/getportaldeals?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
  });

  const data = await handleResponse(res);
  return normalizeDealsPayload(data);
}

export async function fetchDealTransactions({ email, assetIds }) {
  const safeEmail = getPortalUserEmail(email);
  const url = `${API_BASE}/getdealtransactions?email=${encodeURIComponent(
    safeEmail
  )}&assetIds=${encodeURIComponent(assetIds)}`;

  const res = await fetch(url, { method: "GET" });
  return handleResponse(res);
}

export async function createNote(payload) {
  const res = await fetch(`${API_BASE}/createnote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}

export async function updateExpectedLodgementDate(payload) {
  const res = await fetch(`${API_BASE}/updateexpectedlodgementdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}




//Upload a document for a specific deal/property
export async function uploadDealDocument(payload) {
  const res = await fetch(`${API_BASE}/uploaddealdocument`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}

export async function fetchBankDetailsForAccount({ accountId, avsOnly = false }) {
  if (!accountId) throw new Error("Missing accountId");
  const url = `${API_BASE}/getbankdetailsforaccount?accountId=${encodeURIComponent(
    accountId
  )}&avsOnly=${avsOnly ? "true" : "false"}`;

  const res = await fetch(url, { method: "GET" });
  const data = await handleResponse(res);
  return normalizeDealsPayload(data);
}


// Generate a statement using the Creator-backed logic
export async function generateStatement({ assetId }) {
  const res = await fetch(`${API_BASE}/generatestatement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId }),
  });

  return handleResponse(res);
}

// --- Notifications (Catalyst Data Store) ---

export async function listNotifications({ email, dealId, includeRead = false } = {}) {
  const safeEmail = getPortalUserEmail(email);

  if (!dealId) throw new Error("Missing dealId");

  const params = new URLSearchParams();
  if (safeEmail) params.set("email", safeEmail);
  params.set("dealId", String(dealId));
  params.set("includeRead", includeRead ? "true" : "false");

  const url = `${API_BASE}/listnotifications?${params.toString()}`;

  const res = await fetch(url, { method: "GET" });
  return handleResponse(res);
}

export async function createNotification(payload) {
  const res = await fetch(`${API_BASE}/createnotification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}

export async function markNotificationRead({ id }) {
  const res = await fetch(`${API_BASE}/marknotificationread`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return handleResponse(res);
}


