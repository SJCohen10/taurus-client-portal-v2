// client/src/services/portalApi.js

// In dev: call the remote Catalyst backend directly
// In prod: use relative /server (works when app is hosted on Catalyst)
const API_BASE =
  process.env.NODE_ENV === "development"
    ? "https://taurus-client-portal-889090616.development.catalystserverless.com/server"
    : "/server";

// Dev-only fallback email for local testing
const DEV_DEFAULT_EMAIL = "paralegal.sandbox@lawfirm.co.za";

function getPortalUserEmail() {
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
export async function fetchMyDeals() {
  const email = getPortalUserEmail();

  // Your function expects `email` or `accountId` as QUERY PARAM
  const url = `${API_BASE}/getportaldeals?email=${encodeURIComponent(email)}`;

  const res = await fetch(url, {
    method: "GET",
  });

  return handleResponse(res);
}

// 👇 Firm deals – for now, call same endpoint with same email
// Later we can extend backend to support firm-level logic.
export async function fetchFirmDeals() {
  const email = getPortalUserEmail();

  const url = `${API_BASE}/getportaldeals?email=${encodeURIComponent(email)}`;

  const res = await fetch(url, {
    method: "GET",
  });

  return handleResponse(res);
}
