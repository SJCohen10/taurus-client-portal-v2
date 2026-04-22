import { request } from "./api/catalystClient";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

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
  const hasLoadedRef = useRef(false);

  function resolveEmail() {
    const pu = window.portalUser || {};
    const devImpersonationEmail = getDevImpersonationEmail();
    return resolvePortalEmail(pu, devImpersonationEmail);
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

        const resolvedEmail = resolveEmail();
        setEmail(resolvedEmail);

        // optional: keep whatever catalyst user object you have
        setUser(window.portalUser || null);

        const ctx = await loadContext(resolvedEmail);
        setContext(ctx);
        setAuthenticated(true);
        if (!resolvedEmail && ctx?.contactEmail) setEmail(ctx.contactEmail);
        setRequestId(ctx?.requestId || "");


      } catch (e) {
        console.error(e);
        setAuthenticated(false);
        setContext(null);

        if (e?.status === 401 || e?.status === 403) {
          setError("");
          setRequestId("");
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
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortalContext() {
  return useContext(PortalContext);
}
