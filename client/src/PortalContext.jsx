import React, { createContext, useContext, useEffect, useState } from "react";

const PortalContext = createContext(null);

const DEV_DEFAULT_EMAIL = "paralegal.sandbox@lawfirm.co.za";

export function PortalProvider({ children }) {
  const [user, setUser] = useState(null);         // optional
  const [email, setEmail] = useState("");
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function resolveEmail() {
    const pu = window.portalUser || {};
    return (
      pu.email ||
      pu.email_id ||
      pu.user_mailid ||
      pu.user_email ||
      (process.env.NODE_ENV === "development" ? DEV_DEFAULT_EMAIL : "")
    );
  }

  async function loadContext(resolvedEmail) {
    if (!resolvedEmail) return null;

    // In production (Catalyst), leave this blank.
    // In local dev, set REACT_APP_API_BASE to your Catalyst domain.
    const apiBase = process.env.REACT_APP_API_BASE || "";
    const url = `${apiBase}/server/getPortalUserContext?email=${encodeURIComponent(resolvedEmail)}`;

    const res = await fetch(url, { method: "GET" });

    const contentType = res.headers.get("content-type") || "";
    const bodyText = await res.text();

    if (!res.ok) {
      throw new Error(`getPortalUserContext failed (${res.status}): ${bodyText}`);
    }

    // If we got HTML, show a clear error (prevents the "<!DOCTYPE" JSON crash)
    if (!contentType.includes("application/json")) {
      throw new Error(
        `Expected JSON but got "${contentType}". URL=${url}. Body starts: ${bodyText.slice(0, 80)}`
      );
    }

    return JSON.parse(bodyText);
  }


  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");

        const resolvedEmail = resolveEmail();
        setEmail(resolvedEmail);

        // optional: keep whatever catalyst user object you have
        setUser(window.portalUser || null);

        const ctx = await loadContext(resolvedEmail);
        setContext(ctx);

      
      } catch (e) {
        console.error(e);
        setError(e.message || "Failed to load portal context");
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
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortalContext() {
  return useContext(PortalContext);
}
