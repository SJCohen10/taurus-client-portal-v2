import { buildCatalystLoginUrl, buildCatalystLogoutUrl, getCleanAppReturnUrl } from "./authUrls";

const isDebugAuth = process.env.REACT_APP_DEBUG_AUTH === "true" || process.env.REACT_APP_DEBUG_ROUTING === "true";

export function getAppReturnUrl() {
  return getCleanAppReturnUrl();
}

export const getCatalystLoginUrl = buildCatalystLoginUrl;
export const getCatalystLogoutUrl = buildCatalystLogoutUrl;

export function authDebugLog(message, data = {}) {
  if (!isDebugAuth) return;
  console.info(`[PortalAuth] ${message}`, data);
}

export function redirectToLogin(serviceUrl = getAppReturnUrl(), reason = "") {
  const loginUrl = getCatalystLoginUrl(serviceUrl);
  authDebugLog("redirect-to-login", {
    currentUrl: window.location.href,
    loginUrl,
    serviceUrl,
    reason,
  });
  window.location.replace(loginUrl);
}

export function clearPortalAuthState() {
  const shouldRemoveKey = (key) => /auth|catalyst|portal/i.test(String(key || ""));
  [window.localStorage, window.sessionStorage].forEach((storage) => {
    try {
      const keysToRemove = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (shouldRemoveKey(key)) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => storage.removeItem(key));
    } catch {
      // no-op
    }
  });
}
