import { request } from "./api/catalystClient";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  LOGOUT_BROADCAST_CHANNEL,
  LOGOUT_BROADCAST_EVENT,
  LOGOUT_STORAGE_KEY,
  logoutAndRedirect,
} from "./auth/logout";
import { authDebugLog, clearPortalAuthState, getAppReturnUrl } from "./auth/portalAuth";

const PortalContext = createContext(null);
const isDebugRouting = process.env.REACT_APP_DEBUG_ROUTING === "true";

export function resolvePortalEmail(portalUser = {}, devImpersonationEmail = "") {
  return (
    portalUser.email ||
    portalUser.email_id ||
    portalUser.user_mailid ||
    portalUser.user_email ||
    devImpersonationEmail
  );
}

export function PortalProvider({ children }) {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [context, setContext] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [authFailure, setAuthFailure] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [serverFailure, setServerFailure] = useState(false);
  const bootstrapStartedRef = useRef(false);

  const resetAuthState = React.useCallback(() => {
    setUser(null);
    setEmail("");
    setContext(null);
    setAuthenticated(false);
    setAuthFailure(false);
    setNeedsLogin(true);
    setServerFailure(false);
    setError("");
    setRequestId("");
  }, []);

  const logout = React.useCallback(async () => {
    setLoading(true);
    resetAuthState();
    await logoutAndRedirect({ serviceUrl: getAppReturnUrl() });
  }, [resetAuthState]);

  async function loadContext(signal) {
    const timeoutMs = 12000;

    return Promise.race([
      request("/getportalusercontext", { signal }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Portal context request timed out")), timeoutMs);
      }),
    ]);
  }

  useEffect(() => {
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;

    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setError("");
        setRequestId("");
        setAuthFailure(false);
        setNeedsLogin(false);
        setServerFailure(false);

        // Do NOT call Catalyst Web SDK current-user methods here.
        // On first load they can call /baas/.../project-user/current before the
        // Catalyst browser session is ready, causing AUTHENTICATION_FAILURE.
        // The backend endpoint is the authoritative auth check.
        const ctx = await loadContext(controller.signal);

        setContext(ctx);
        setAuthenticated(true);
        setAuthFailure(false);
        setNeedsLogin(false);
        setServerFailure(false);
        setError("");

        const resolvedEmail = String(
          ctx?.contactEmail ||
            ctx?.email ||
            ctx?.user?.email ||
            ctx?.user?.email_id ||
            ctx?.user?.user_mailid ||
            ctx?.user?.user_email ||
            ""
        )
          .trim()
          .toLowerCase();

        setEmail(resolvedEmail);
        setUser(ctx?.user || null);
        setRequestId(ctx?.requestId || "");

        if (isDebugRouting) {
          console.info("[routing-debug] portal-context-success", {
            authenticated: true,
            loading: false,
            hasContext: Boolean(ctx),
            requestId: ctx?.requestId || "",
          });
        }
      } catch (e) {
        if (e?.name === "AbortError") return;

        console.error(e);
        setAuthenticated(false);
        setContext(null);

        if (e?.status === 401) {
          clearPortalAuthState();
          setNeedsLogin(true);
          setError("");
          setRequestId(e.requestId || "");
          authDebugLog("portal-context-unauthorized", {
            status: e?.status,
            requestId: e?.requestId || "",
          });
        } else if (e?.status === 403) {
          clearPortalAuthState();
          setAuthFailure(true);
          setNeedsLogin(false);
          setServerFailure(false);
          setError(
            "Your login was successful, but your Taurus portal access could not be verified. Please contact Taurus Capital if you believe this is incorrect."
          );
          setRequestId(e.requestId || "");
        } else {
          setServerFailure(true);
          setNeedsLogin(false);
          setError("We could not load your portal details right now. Please try again shortly.");
          setRequestId(e.requestId || "");
        }

        if (isDebugRouting) {
          console.info("[routing-debug] portal-context-failure", {
            status: e?.status || "unknown",
            authFailure: e?.status === 403,
            needsLogin: e?.status === 401,
            serverFailure: e?.status !== 401 && e?.status !== 403,
          });
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === LOGOUT_STORAGE_KEY && event.newValue) {
        resetAuthState();
      }
    };

    window.addEventListener("storage", onStorage);

    let channel = null;
    if (typeof window.BroadcastChannel === "function") {
      channel = new BroadcastChannel(LOGOUT_BROADCAST_CHANNEL);
      channel.onmessage = (event) => {
        if (event?.data?.type === LOGOUT_BROADCAST_EVENT) {
          resetAuthState();
        }
      };
    }

    return () => {
      window.removeEventListener("storage", onStorage);
      if (channel) channel.close();
    };
  }, [resetAuthState]);

  return (
    <PortalContext.Provider
      value={{
        user,
        email,
        context,
        authenticated,
        loading,
        error,
        requestId,
        authFailure,
        needsLogin,
        serverFailure,
        logout,
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortalContext() {
  return useContext(PortalContext);
}