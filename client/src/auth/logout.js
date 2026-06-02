import { authDebugLog, clearPortalAuthState, getAppReturnUrl, getCatalystLoginUrl } from "./portalAuth";

const LOGOUT_BROADCAST_CHANNEL = "taurus-portal-auth";
const LOGOUT_BROADCAST_EVENT = "logout";
const LOGOUT_STORAGE_KEY = "taurus.portal.logout";

async function catalystSignOut() {
  const auth = window.catalyst?.auth;
  if (!auth) return;

  const signOutFn = [auth.signOut, auth.logout, auth.signout].find(
    (candidate) => typeof candidate === "function",
  );

  if (signOutFn) {
    await signOutFn.call(auth);
  }
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

export async function logoutAndRedirect({ serviceUrl = getAppReturnUrl() } = {}) {
  const loginUrl = getCatalystLoginUrl(serviceUrl);

  try {
    await catalystSignOut();
    authDebugLog("logout-sdk-signout-success");
  } catch (error) {
    authDebugLog("logout-sdk-signout-failed", { message: error?.message || String(error) });
  } finally {
    clearPortalAuthState();
    notifyLogoutToOtherTabs();
    authDebugLog("logout-state-cleared", { loginUrl, serviceUrl });
  }

  window.location.replace(loginUrl);
}

export { LOGOUT_BROADCAST_CHANNEL, LOGOUT_BROADCAST_EVENT, LOGOUT_STORAGE_KEY, clearPortalAuthState };
