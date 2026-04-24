import { request } from "./api/catalystClient";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { resolveAuthenticatedPortalIdentity } from "./auth/catalystAuth";

const PortalContext = createContext(null);

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


      } catch (e) {
        console.error(e);
        setAuthenticated(false);
        setContext(null);

        if (e?.status === 401 || e?.status === 403) {
          setAuthFailure(true);
          setError("We could not verify your portal access. Please contact Taurus Capital to resolve this issue.");
          setRequestId(e.requestId || "");
        } else {
          setError(e.message || "Failed to load portal context");
          setRequestId(e.requestId || "");
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
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortalContext() {
  return useContext(PortalContext);
}
