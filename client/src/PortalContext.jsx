import { request } from "./api/catalystClient";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  LOGOUT_BROADCAST_CHANNEL,
  LOGOUT_BROADCAST_EVENT,
  LOGOUT_STORAGE_KEY,
  logoutAndRedirect,
} from "./auth/logout";
import {
  authDebugLog,
  clearPortalAuthState,
  getAppReturnUrl,
  getCatalystLoginUrl,
  getCatalystLogoutUrl,
  redirectToLogin,
} from "./auth/portalAuth";
import { resolveCatalystSessionStatus } from "./auth/catalystAuth";

const PortalContext = createContext(null);
const isDebugRouting = process.env.REACT_APP_DEBUG_ROUTING === "true";
const BOOT_TIMEOUT_MS = 15000;

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
  const [bootStage, setBootStage] = useState("initializing");
  const [bootStartedAt, setBootStartedAt] = useState(Date.now());
  const [sdkStatus, setSdkStatus] = useState("unknown");
  const [lastAuthStep, setLastAuthStep] = useState("initializing");
  const [diagnostics, setDiagnostics] = useState({});
  const bootRunIdRef = useRef(0);
  const bootStateRef = useRef({ authenticated: false, bootStage: "initializing", loading: true });

  useEffect(() => {
    bootStateRef.current = { authenticated, bootStage, loading };
  }, [authenticated, bootStage, loading]);

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
    setBootStage("catalyst_unauthenticated");
    setLastAuthStep("reset_auth_state");
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
    const runId = bootRunIdRef.current + 1;
    bootRunIdRef.current = runId;
    let cancelled = false;
    const controller = new AbortController();
    const startedAt = Date.now();

    setBootStartedAt(startedAt);
    setBootStage("waiting_for_catalyst_sdk");
    setLastAuthStep("starting_bootstrap");
    setDiagnostics({
      currentUrl: window.location.href,
      pathname: window.location.pathname,
      hash: window.location.hash,
      origin: window.location.origin,
      serviceUrl: getAppReturnUrl(),
      sdkStatus: "unknown",
      contextRequestStarted: false,
      contextRequestCompleted: false,
      elapsedMs: 0,
    });

    (async () => {
      try {
        if (cancelled || bootRunIdRef.current !== runId) return;
        setLoading(true);
        setError("");
        setRequestId("");
        setAuthFailure(false);
        setNeedsLogin(false);
        setServerFailure(false);

        setLastAuthStep("resolve_catalyst_session_status");
        setBootStage("checking_catalyst_session");
        const sdkStatus = await resolveCatalystSessionStatus();
        if (cancelled || bootRunIdRef.current !== runId) return;
        setSdkStatus(sdkStatus.status);
        setDiagnostics((prev) => ({ ...prev, sdkStatus: sdkStatus.status, elapsedMs: Date.now() - startedAt }));
        authDebugLog("startup-auth-diagnostics", {
          currentUrl: window.location.href,
          origin: window.location.origin,
          serviceUrl: getAppReturnUrl(),
          loginUrl: getCatalystLoginUrl(getAppReturnUrl()),
          logoutUrl: getCatalystLogoutUrl(getAppReturnUrl()),
          sdkAuthStatus: sdkStatus.status,
          sdkAuthSource: sdkStatus.source || "unknown",
        });

        if (sdkStatus.status !== "authenticated") {
          if (sdkStatus.status === "unauthenticated") {
            const serviceUrl = getAppReturnUrl();
            const loginUrl = getCatalystLoginUrl(serviceUrl);
            bootStateRef.current = { authenticated: false, bootStage: "redirecting_to_login", loading: false };
            setBootStage("redirecting_to_login");
            setLastAuthStep("redirecting_to_login");
            setNeedsLogin(true);
            setServerFailure(false);
            setAuthenticated(false);
            setLoading(false);
            setDiagnostics((prev) => ({
              ...prev,
              sdkStatus: sdkStatus.status,
              sdkAuthSource: sdkStatus.source || "unknown",
              serviceUrl,
              loginUrl,
              elapsedMs: Date.now() - startedAt,
            }));
            authDebugLog("catalyst-unauthenticated", {
              currentUrl: window.location.href,
              serviceUrl,
              loginUrl,
              sdkStatus: sdkStatus.status,
              sdkSource: sdkStatus.source || "unknown",
            });
            redirectToLogin(serviceUrl, "catalyst-unauthenticated");
            return;
          }

          setBootStage("server_error");
          setLastAuthStep("catalyst_sdk_error");
          setServerFailure(true);
          setNeedsLogin(false);
          setAuthenticated(false);
          setError("Catalyst authentication is currently unavailable. Please refresh and try again.");
          return;
        }

        setBootStage("loading_portal_context");
        setLastAuthStep("load_portal_context");
        setDiagnostics((prev) => ({ ...prev, contextRequestStarted: true, elapsedMs: Date.now() - startedAt }));
        const ctx = await loadContext(controller.signal);
        if (cancelled || bootRunIdRef.current !== runId) return;

        setContext(ctx);
        setAuthenticated(true);
        setBootStage("authenticated");
        setLastAuthStep("portal_context_loaded");
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
        setDiagnostics((prev) => ({
          ...prev,
          contextRequestCompleted: true,
          requestId: ctx?.requestId || "",
          elapsedMs: Date.now() - startedAt,
        }));

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
        if (cancelled || bootRunIdRef.current !== runId) return;

        console.error(e);
        setAuthenticated(false);
        setContext(null);
        setDiagnostics((prev) => ({
          ...prev,
          contextRequestCompleted: true,
          contextStatus: e?.status || "network_error",
          requestId: e?.requestId || "",
          elapsedMs: Date.now() - startedAt,
        }));

        if (e?.status === 401) {
          setBootStage("server_unauthorized_after_sdk_auth");
          setLastAuthStep("context_401_after_sdk_auth");
          clearPortalAuthState();
          setNeedsLogin(false);
          setServerFailure(true);
          setError("Session/configuration problem: login succeeded but authenticated user context was missing on the server. Please contact support.");
          setRequestId(e.requestId || "");
          authDebugLog("portal-context-unauthorized", {
            status: e?.status,
            requestId: e?.requestId || "",
            technicalMessage: e?.technicalMessage || "",
          });
        } else if (e?.status === 403) {
          setBootStage("unauthorized");
          setLastAuthStep("context_403_unauthorized");
          clearPortalAuthState();
          setAuthFailure(true);
          setNeedsLogin(false);
          setServerFailure(false);
          setError(
            "Your login was successful, but your Taurus portal access could not be verified. Please contact Taurus Capital if you believe this is incorrect."
          );
          setRequestId(e.requestId || "");
        } else {
          setBootStage("server_error");
          setLastAuthStep("context_server_error");
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
        if (cancelled || bootRunIdRef.current !== runId) return;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const ignoredStages = new Set(["redirecting_to_login", "catalyst_unauthenticated", "authenticated"]);
    if (!loading || authenticated || ignoredStages.has(bootStage)) return undefined;

    const timer = setTimeout(() => {
      const latest = bootStateRef.current;
      if (!latest.loading || latest.authenticated || ignoredStages.has(latest.bootStage)) return;

      setBootStage("timeout");
      setLastAuthStep("bootstrap_timeout");
      setServerFailure(true);
      setNeedsLogin(false);
      setError("Portal loading timed out. Please retry.");
      setLoading(false);
      setDiagnostics((prev) => ({ ...prev, elapsedMs: Date.now() - bootStartedAt }));
    }, BOOT_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [loading, authenticated, bootStage, bootStartedAt]);

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
        bootStage,
        bootStartedAt,
        sdkStatus,
        lastAuthStep,
        diagnostics,
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
