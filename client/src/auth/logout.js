const LOGOUT_BROADCAST_CHANNEL = "taurus-portal-auth";
const LOGOUT_BROADCAST_EVENT = "logout";
const LOGOUT_STORAGE_KEY = "taurus.portal.logout";

function buildCatalystLoginUrl(serviceUrl = `${window.location.origin}/app/#/`) {
  const loginUrl = new URL("/__catalyst/auth/login", window.location.origin);
  loginUrl.searchParams.set("service_url", serviceUrl);
  return loginUrl.toString();
}

function clearAuthStorage() {
  const shouldRemoveKey = (key) => /auth|catalyst|portal/i.test(String(key || ""));
  [window.localStorage, window.sessionStorage].forEach((storage) => {
    try {
      const keysToRemove = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (shouldRemoveKey(key)) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => storage.removeItem(key));
    } catch (error) {
      console.warn("[PortalAuth] Failed to clear storage", error);
    }
  });
}

async function catalystSignOut() {
  const auth = window?.catalyst?.auth;
  if (!auth) return;

  const signOutFn = auth.signOut || auth.logout || auth.signout;
  if (typeof signOutFn === "function") {
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

export async function performPortalLogout({ serviceUrl } = {}) {
  const loginUrl = buildCatalystLoginUrl(serviceUrl);

  try {
    await catalystSignOut();
  } catch (error) {
    console.error("[PortalAuth] Catalyst sign out failed", error);
  } finally {
    clearAuthStorage();
    notifyLogoutToOtherTabs();
  }

  window.location.replace(loginUrl);
}

export { LOGOUT_BROADCAST_CHANNEL, LOGOUT_BROADCAST_EVENT, LOGOUT_STORAGE_KEY, clearAuthStorage };
