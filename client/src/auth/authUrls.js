const APP_BASE_PATH = "/app/";

function getPortalBaseUrl() {
  return window.location.origin;
}

export function getCleanAppReturnUrl() {
  return new URL(APP_BASE_PATH, getPortalBaseUrl()).toString();
}

export function isCatalystAuthUrl(url) {
  try {
    const parsed = new URL(url, getPortalBaseUrl());
    return parsed.pathname.startsWith("/__catalyst/auth/");
  } catch {
    return false;
  }
}

export function normalizePortalReturnUrl(url) {
  const fallback = getCleanAppReturnUrl();
  if (!url) return fallback;

  try {
    const parsed = new URL(url, getPortalBaseUrl());
    if (isCatalystAuthUrl(parsed.toString())) {
      return fallback;
    }

    if (parsed.origin !== getPortalBaseUrl()) {
      return fallback;
    }

    if (!parsed.pathname.startsWith(APP_BASE_PATH)) {
      return fallback;
    }

    if (parsed.pathname === "/app") parsed.pathname = APP_BASE_PATH;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export function buildCatalystLoginUrl(returnUrl = getCleanAppReturnUrl()) {
  const safeReturnUrl = normalizePortalReturnUrl(returnUrl);
  const loginUrl = new URL("/__catalyst/auth/login", getPortalBaseUrl());
  loginUrl.searchParams.set("service_url", safeReturnUrl);
  return loginUrl.toString();
}

export function buildCatalystLogoutUrl(postLogoutUrl = getCleanAppReturnUrl()) {
  // Catalyst rejects nested auth URLs in service_url. Always pass a clean app route.
  const safePostLogoutUrl = normalizePortalReturnUrl(postLogoutUrl);
  const logoutUrl = new URL("/__catalyst/auth/logout", getPortalBaseUrl());
  logoutUrl.searchParams.set("service_url", safePostLogoutUrl);
  return logoutUrl.toString();
}
