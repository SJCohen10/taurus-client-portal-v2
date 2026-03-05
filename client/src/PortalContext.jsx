import { request } from "./api/catalystClient";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

const PortalContext = createContext(null);

function getDevImpersonationEmail() {
  if (process.env.NODE_ENV !== "development") return "";
  return (process.env.REACT_APP_DEV_IMPERSONATE_EMAIL || "").trim().toLowerCase();
}

export function PortalProvider({ children }) {
  const [user, setUser] = useState(null);         // optional
  const [email, setEmail] = useState("");
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const hasLoadedRef = useRef(false);

  function resolveEmail() {
    const pu = window.portalUser || {};
    const devImpersonationEmail = getDevImpersonationEmail();
    return (
      pu.email ||
      pu.email_id ||
      pu.user_mailid ||
      pu.user_email ||
      devImpersonationEmail
    );
  }

  async function loadContext(resolvedEmail) {
    if (!resolvedEmail) return null;

    return request("/getportalusercontext", { query: { email: resolvedEmail } });
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
        setRequestId(ctx?.requestId || "");


      } catch (e) {
        console.error(e);
        setError(e.message || "Failed to load portal context");
        setRequestId(e.requestId || "");
        setContext(null);
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
