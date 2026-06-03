import { buildCatalystLoginUrl, getCleanAppReturnUrl } from "./authUrls";

export const isAuthDebugEnabled = process.env.REACT_APP_DEBUG_AUTH === "true";
export const isRoutingDebugEnabled = process.env.REACT_APP_DEBUG_ROUTING === "true";


export function getAppReturnUrl() {
  return getCleanAppReturnUrl();
}

export const getCatalystLoginUrl = buildCatalystLoginUrl;

export function authDebugLog(message, data = {}) {
  if (!isAuthDebugEnabled && !isRoutingDebugEnabled) return;
  console.info(`[PortalAuth] ${message}`, data);
}

export function routingDebugLog(message, data = {}) {
  if (!isRoutingDebugEnabled) return;
  console.info(`[routing-debug] ${message}`, data);
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
