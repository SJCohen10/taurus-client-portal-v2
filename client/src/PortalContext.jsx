import { request } from "./api/catalystClient";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { resolveAuthenticatedPortalIdentity } from "./auth/catalystAuth";

const PortalContext = createContext(null);
const isDebugRouting = process.env.REACT_APP_DEBUG_ROUTING === "true";

function getDevImpersonationEmail() {
  if (process.env.NODE_ENV !== "development") return "";
  return (process.env.REACT_APP_DEV_IMPERSONATE_EMAIL || "").trim().toLowerCase();
}

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
  const [user, setUser] = useState(null);         // optional
  const [email, setEmail] = useState("");
  const [context, setContext] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [authFailure, setAuthFailure] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [serverFailure, setServerFailure] = useState(false);
  const hasLoadedRef = useRef(false);

  async function resolveIdentity() {
    const identity = await resolveAuthenticatedPortalIdentity();
    const devImpersonationEmail = getDevImpersonationEmail();
    const resolvedEmail = identity.email || resolvePortalEmail(identity.user || {}, devImpersonationEmail);

    return {
      ...identity,
      email: resolvedEmail,
    };
  }

  async function loadContext(resolvedEmail) {
    const query = resolvedEmail ? { email: resolvedEmail } : undefined;
    return request("/getportalusercontext", { query });
  }


  useEffect(() => {
    if (process.env.NODE_ENV === "development" && hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    (async () => {
      try {
        setLoading(true);
        setError("");
        setRequestId("");
        setAuthFailure(false);
        setNeedsLogin(false);
        setServerFailure(false);

        const identity = await resolveIdentity();
        setEmail(identity.email);

        // optional: keep whichever Catalyst/portal user object was found
        setUser(identity.user || null);

        const ctx = await loadContext(identity.email);
        setContext(ctx);
        setAuthenticated(true);
        setAuthFailure(false);
        if (!identity.email && ctx?.contactEmail) setEmail(ctx.contactEmail);
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
        console.error(e);
        setAuthenticated(false);
        setContext(null);

        if (e?.status === 401) {
          setNeedsLogin(true);
          setError("Your session has expired. Redirecting to login.");
          setRequestId(e.requestId || "");
        } else if (e?.status === 403) {
          setAuthFailure(true);
          setError("Your login was successful, but your Taurus portal access could not be verified. Please contact Taurus Capital if you believe this is incorrect.");
          setRequestId(e.requestId || "");
        } else {
          setServerFailure(true);
          setError("Temporary server issue while loading your portal access. Please try again shortly.");
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
  }, []);

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
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortalContext() {
  return useContext(PortalContext);
}
