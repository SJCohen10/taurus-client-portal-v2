import { request } from "./api/catalystClient";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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
  redirectToLogin,
  routingDebugLog,
} from "./auth/portalAuth";
import { normalizePortalReturnUrl } from "./auth/authUrls";

const PortalContext = createContext(null);
const BOOT_TIMEOUT_MS = 15000;

export function resolvePortalEmail(
  portalUser = {},
  devImpersonationEmail = "",
) {
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
  const bootStateRef = useRef({
    authenticated: false,
    bootStage: "initializing",
    loading: true,
  });

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
    await logoutAndRedirect();
  }, [resetAuthState]);

  async function loadContext(signal) {
    const timeoutMs = 12000;

    return Promise.race([
      request("/getportalusercontext", { signal }),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Portal context request timed out")),
          timeoutMs,
        );
      }),
    ]);
  }

  useEffect(() => {
    const runId = bootRunIdRef.current + 1;
    bootRunIdRef.current = runId;
    let cancelled = false;
    const controller = new AbortController();
    const startedAt = Date.now();
    const { hash } = window.location;
    const hasDeepLink = Boolean(hash && hash.startsWith("#/"));
    const serviceUrl = normalizePortalReturnUrl(
      hasDeepLink ? `${window.location.origin}/app/${hash}` : getAppReturnUrl(),
    );

    setBootStartedAt(startedAt);
    setBootStage("loading_portal_context");
    setLastAuthStep("starting_backend_context_bootstrap");
    setSdkStatus("not_used");
    setDiagnostics({
      currentUrl: window.location.href,
      pathname: window.location.pathname,
      hash: window.location.hash,
      origin: window.location.origin,
      serviceUrl,
      contextRequestStarted: false,
      contextRequestCompleted: false,
      contextStatus: "pending",
      requestId: "",
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

        authDebugLog("startup-auth-diagnostics", {
          currentUrl: window.location.href,
          pathname: window.location.pathname,
          hash: window.location.hash,
          origin: window.location.origin,
          serviceUrl,
          loginUrl: getCatalystLoginUrl(serviceUrl),
          authSource: "backend_portal_context",
        });

        setBootStage("loading_portal_context");
        setLastAuthStep("load_portal_context");
        setDiagnostics((prev) => ({
          ...prev,
          serviceUrl,
          contextRequestStarted: true,
          contextStatus: "pending",
          elapsedMs: Date.now() - startedAt,
        }));

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
            "",
        )
          .trim()
          .toLowerCase();

        setEmail(resolvedEmail);
        setUser(ctx?.user || null);
        setRequestId(ctx?.requestId || "");
        setDiagnostics((prev) => ({
          ...prev,
          contextRequestCompleted: true,
          contextStatus: 200,
          requestId: ctx?.requestId || "",
          elapsedMs: Date.now() - startedAt,
        }));

        routingDebugLog("portal-context-success", {
          authenticated: true,
          loading: false,
          hasContext: Boolean(ctx),
          requestId: ctx?.requestId || "",
        });
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (cancelled || bootRunIdRef.current !== runId) return;

        const status = e?.status || "network_error";
        const nextRequestId = e?.requestId || "";
        authDebugLog("portal-context-error", {
          status,
          requestId: nextRequestId,
          message: e?.message || "Portal context request failed",
        });
        setAuthenticated(false);
        setContext(null);
        setUser(null);
        setEmail("");
        setRequestId(nextRequestId);
        setDiagnostics((prev) => ({
          ...prev,
          contextRequestCompleted: true,
          contextStatus: status,
          requestId: nextRequestId,
          elapsedMs: Date.now() - startedAt,
        }));

        const technicalMessage = String(e?.technicalMessage || "");
        const isCatalystUnauthenticated =
          e?.status !== 403 &&
          (e?.status === 401 ||
            e?.errorCode === "NO_ACCESS" ||
            technicalMessage.includes("No privilege to perform this action"));

        if (isCatalystUnauthenticated) {
          const loginUrl = getCatalystLoginUrl(serviceUrl);
          setBootStage("redirecting_to_login");
          setLastAuthStep("context_unauthenticated_redirecting_to_login");
          clearPortalAuthState();
          setAuthFailure(false);
          setNeedsLogin(true);
          setServerFailure(false);
          setError("");
          bootStateRef.current = {
            authenticated: false,
            bootStage: "redirecting_to_login",
            loading: false,
          };
          setDiagnostics((prev) => ({
            ...prev,
            serviceUrl,
            loginUrl,
            contextRequestCompleted: true,
            contextStatus: status,
            requestId: nextRequestId,
            elapsedMs: Date.now() - startedAt,
            errorCode: e?.errorCode || "",
          }));
          authDebugLog("portal-context-unauthenticated", {
            status: e?.status,
            errorCode: e?.errorCode || "",
            requestId: nextRequestId,
            serviceUrl,
            loginUrl,
            technicalMessage,
          });
          setLoading(false);
          redirectToLogin(serviceUrl, "portal-context-unauthenticated");
          return;
        }

        if (e?.status === 403) {
          setBootStage("unauthorized");
          setLastAuthStep("context_403_unauthorized");
          setAuthFailure(true);
          setNeedsLogin(false);
          setServerFailure(false);
          setError(
            "You signed in successfully, but your portal access has not been enabled for this account. Please contact Taurus Capital for assistance.",
          );
        } else {
          setBootStage(
            e?.message === "Portal context request timed out"
              ? "timeout"
              : "server_error",
          );
          setLastAuthStep(
            e?.message === "Portal context request timed out"
              ? "context_timeout"
              : "context_server_error",
          );
          setAuthFailure(false);
          setServerFailure(true);
          setNeedsLogin(false);
          setError(
            "Please refresh the page. If the issue continues, contact Taurus Capital for assistance.",
          );
        }

        routingDebugLog("portal-context-failure", {
          status,
          authFailure: e?.status === 403,
          needsLogin: e?.status === 401,
          serverFailure: e?.status !== 401 && e?.status !== 403,
        });
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
    const ignoredStages = new Set([
      "redirecting_to_login",
      "catalyst_unauthenticated",
      "authenticated",
    ]);
    if (!loading || authenticated || ignoredStages.has(bootStage))
      return undefined;

    const timer = setTimeout(() => {
      const latest = bootStateRef.current;
      if (
        !latest.loading ||
        latest.authenticated ||
        ignoredStages.has(latest.bootStage)
      )
        return;

      setBootStage("timeout");
      setLastAuthStep("bootstrap_timeout");
      setServerFailure(true);
      setNeedsLogin(false);
      setError("Please refresh the page. If the issue continues, contact Taurus Capital for assistance.");
      setLoading(false);
      setDiagnostics((prev) => ({
        ...prev,
        elapsedMs: Date.now() - bootStartedAt,
      }));
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
