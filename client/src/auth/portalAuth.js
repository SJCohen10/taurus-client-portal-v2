const isDebugAuth =
  process.env.NODE_ENV !== "production" || process.env.REACT_APP_DEBUG_AUTH === "true";

export function getAppReturnUrl() {
  return `${window.location.origin}/app/#/`;
}

export function getCatalystLoginUrl(serviceUrl = getAppReturnUrl()) {
  const loginUrl = new URL("/__catalyst/auth/login", window.location.origin);
  loginUrl.searchParams.set("service_url", serviceUrl);
  return loginUrl.toString();
}

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
