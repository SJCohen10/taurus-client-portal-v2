const APP_BASE_PATH = "/app/";
const APP_HASH_HOME = "#/";

function getPortalBaseUrl() {
  return window.location.origin;
}

function canonicalAppServiceUrl() {
  return new URL(`${APP_BASE_PATH}${APP_HASH_HOME}`, getPortalBaseUrl()).toString();
}

export function getCleanAppReturnUrl() {
  return canonicalAppServiceUrl();
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
  const fallback = canonicalAppServiceUrl();
  if (!url) return fallback;

  try {
    const parsed = new URL(url, getPortalBaseUrl());
    if (isCatalystAuthUrl(parsed.toString())) return fallback;
    if (parsed.origin !== getPortalBaseUrl()) return fallback;

    if (parsed.pathname === "/app") parsed.pathname = APP_BASE_PATH;
    if (!parsed.pathname.startsWith(APP_BASE_PATH)) return fallback;

    if (parsed.hash && !parsed.hash.startsWith("#/")) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export function buildCatalystLoginUrl(returnUrl = canonicalAppServiceUrl()) {
  const safeReturnUrl = normalizePortalReturnUrl(returnUrl);
  const loginUrl = new URL("/__catalyst/auth/login", getPortalBaseUrl());
  loginUrl.search = new URLSearchParams({ service_url: safeReturnUrl }).toString();
  return loginUrl.toString();
}
