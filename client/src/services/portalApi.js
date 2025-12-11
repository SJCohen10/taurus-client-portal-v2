// client/src/services/portalApi.js

// In dev: call the remote Catalyst backend directly
// In prod: use relative /server (works when app is hosted on Catalyst)
const API_BASE =
  process.env.NODE_ENV === "development"
    ? "https://taurus-client-portal-889090616.development.catalystserverless.com/server"
    : "/server";

// Dev-only fallback email for local testing
const DEV_DEFAULT_EMAIL = "paralegal.sandbox@lawfirm.co.za";

function getPortalUserEmail(explicitEmail) {
  if (explicitEmail) {
    return explicitEmail;
  }
  // 1) Real user from Catalyst auth (in prod)
  if (window?.portalUser?.email) {
    return window.portalUser.email;
  }

  // 2) In development, fall back to sandbox paralegal
  if (process.env.NODE_ENV === "development") {
    return DEV_DEFAULT_EMAIL;
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

// 👇 Deals for the logged-in portal user (paralegal / conveyancer)
export async function fetchMyDeals(emailOverride) {
  const email = getPortalUserEmail(emailOverride);

  // Your function expects `email` or `accountId` as QUERY PARAM
  const url = `${API_BASE}/getportaldeals?email=${encodeURIComponent(email)}`;

  const res = await fetch(url, {
    method: "GET",
  });

  return handleResponse(res);
}

// 👇 Firm deals – prefer AccountId so one firm can see all contacts' deals
export async function fetchFirmDeals({ accountId, fallbackEmail } = {}) {
  const email = getPortalUserEmail(fallbackEmail);

  const params = new URLSearchParams();

  if (accountId) {
    params.set("accountId", accountId);
  } else if (email) {
    params.set("email", email);
  }

  const url = `${API_BASE}/getportaldeals?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
  });

  return handleResponse(res);
}

// 👇 Upload a document for a specific deal/property
export async function uploadDealDocument(payload) {
  const res = await fetch(`${API_BASE}/uploaddealdocument`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
}

// 👇 Generate a statement using the Creator-backed logic
export async function generateStatement({ assetId }) {
  const res = await fetch(`${API_BASE}/generatestatement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId }),
  });

  return handleResponse(res);
}
