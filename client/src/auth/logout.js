import { authDebugLog, clearPortalAuthState } from "./portalAuth";

const LOGOUT_BROADCAST_CHANNEL = "taurus-portal-auth";
const LOGOUT_BROADCAST_EVENT = "logout";
const LOGOUT_STORAGE_KEY = "taurus.portal.logout";
const PROJECT_ID = "23570000000015028";

function getLogoutRedirectUrl() {
  return new URL("/app/", window.location.origin).toString();
}

function getBaasLogoutUrl() {
  const url = new URL("/baas/logout", window.location.origin);
  url.search = new URLSearchParams({
    logout: "true",
    PROJECT_ID,
  }).toString();
  return url.toString();
}

function notifyLogoutToOtherTabs() {
  try {
    window.localStorage.setItem(LOGOUT_STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }

  if (typeof window.BroadcastChannel === "function") {
    try {
      const channel = new BroadcastChannel(LOGOUT_BROADCAST_CHANNEL);
      channel.postMessage({ type: LOGOUT_BROADCAST_EVENT, at: Date.now() });
      channel.close();
    } catch {
      // ignore broadcast errors
    }
  }
}

export async function logoutAndRedirect() {
  const redirectUrl = getLogoutRedirectUrl();
  const baasLogoutUrl = getBaasLogoutUrl();

  clearPortalAuthState();
  notifyLogoutToOtherTabs();
  authDebugLog("logout-state-cleared", { redirectUrl });

  const auth = window.catalyst?.auth;

  if (auth && typeof auth.signOut === "function") {
    try {
      authDebugLog("logout-sdk-signout-start", { redirectUrl });
      auth.signOut(redirectUrl);
      return;
    } catch (error) {
      authDebugLog("logout-sdk-signout-sync-failed", {
        message: error?.message || String(error),
      });
    }
  }

  try {
    authDebugLog("logout-api-fallback-start", { baasLogoutUrl, redirectUrl });
    await fetch(baasLogoutUrl, {
      method: "GET",
      credentials: "include",
      keepalive: true,
    });
  } catch (error) {
    authDebugLog("logout-api-fallback-failed", {
      message: error?.message || String(error),
    });
  }

  window.location.replace(redirectUrl);
}

export { LOGOUT_BROADCAST_CHANNEL, LOGOUT_BROADCAST_EVENT, LOGOUT_STORAGE_KEY, clearPortalAuthState };
