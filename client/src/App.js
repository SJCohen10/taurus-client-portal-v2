import React from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./Layout";
import { usePortalContext } from "./PortalContext";
import RoleBasedDashboard from "./pages/dashboard/RoleBasedDashboard";
import QuickRatesAdvance from "./pages/forms/property/QuickRatesAdvance";
import FaqPage from "./pages/faq/FaqPage";

import SellerProceedsStart from "./pages/forms/property/SellerProceedsStart";

const isProduction = process.env.NODE_ENV === "production";
const LOGIN_ATTEMPT_KEY = "taurus_portal_login_attempted_at";
const LOGIN_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

function getCanonicalAppHashUrl(hashPath = "/") {
  const sanitized = hashPath.startsWith("/") ? hashPath : `/${hashPath}`;
  return `${window.location.origin}/app/#${sanitized}`;
}

function getCurrentHashPath() {
  const rawHash = window.location.hash || "";
  const hashWithoutPrefix = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  return hashWithoutPrefix || "/";
}

function buildCatalystLoginUrl() {
  const loginUrl = new URL("/__catalyst/auth/login", window.location.origin);
  loginUrl.searchParams.set("service_url", getCanonicalAppHashUrl(getCurrentHashPath()));
  return loginUrl.toString();
}

function buildCatalystLoginUrlForServiceUrl(serviceUrl) {
  const loginUrl = new URL("/__catalyst/auth/login", window.location.origin);
  loginUrl.searchParams.set("service_url", serviceUrl);
  return loginUrl.toString();
}
function getSafeServiceUrl() {
  const { pathname } = window.location;
  if (pathname.startsWith("/__catalyst/")) return getCanonicalAppHashUrl("/");
  if (pathname === "/" || pathname === "/app" || pathname === "/app/") return getCanonicalAppHashUrl(getCurrentHashPath());
  if (pathname.startsWith("/app/")) return getCanonicalAppHashUrl(getCurrentHashPath());
  return getCanonicalAppHashUrl("/");
}

function LoginRedirect() {
  React.useEffect(() => {
    if (isProduction) {
      window.location.replace(buildCatalystLoginUrl());
    }
  }, []);

  return <p className="subtle">Redirecting to Catalyst login…</p>;
}

function AccessErrorScreen({ requestId = "" }) {
  return (
    <div style={{ padding: "2rem" }}>
      <h2>Portal Access Issue</h2>
      <p>Your login was successful, but your Taurus portal access could not be verified. Please contact Taurus Capital if you believe this is incorrect.</p>
      {requestId ? <p className="subtle">requestId: {requestId}</p> : null}
    </div>
  );
}

function PortalLoadingScreen() {
  return (
    <div style={{ padding: "2rem" }}>
      <h2>Taurus Client Portal</h2>
      <p className="subtle">Loading Taurus Client Portal...</p>
    </div>
  );
}

function ProtectedAppShell() {
  const portal = usePortalContext();
  const redirectAttemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isProduction || portal?.loading || portal?.authenticated || portal?.authFailure || portal?.serverFailure) return;

    const now = Date.now();
    const previous = Number(window.sessionStorage.getItem(LOGIN_ATTEMPT_KEY) || 0);
    const withinWindow = previous && now - previous < LOGIN_ATTEMPT_WINDOW_MS;

    if (withinWindow || redirectAttemptedRef.current) return;

    redirectAttemptedRef.current = true;
    window.sessionStorage.setItem(LOGIN_ATTEMPT_KEY, String(now));
    window.location.replace(buildCatalystLoginUrlForServiceUrl(getSafeServiceUrl()));
  }, [portal?.authenticated, portal?.loading, portal?.authFailure, portal?.serverFailure]);

  React.useEffect(() => {
    if (!isProduction || !portal?.needsLogin) return;
    window.location.replace(buildCatalystLoginUrlForServiceUrl(getSafeServiceUrl()));
  }, [portal?.needsLogin]);

  React.useEffect(() => {
    if (portal?.authenticated) {
      window.sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);
    }
  }, [portal?.authenticated]);

  if (portal?.loading) {
    return <PortalLoadingScreen />;
  }

  if (!portal?.authenticated) {
    if (portal?.serverFailure) {
      return (
        <div style={{ padding: "2rem" }}>
          <h2>Temporary Portal Error</h2>
          <p>{portal?.error || "Temporary server issue while loading your portal access. Please try again shortly."}</p>
          {portal?.requestId ? <p className="subtle">requestId: {portal.requestId}</p> : null}
        </div>
      );
    }
    if (!isProduction) return <Layout />;
    if (portal?.authFailure) return <AccessErrorScreen requestId={portal?.requestId} />;
    return <PortalLoadingScreen />;
  }

  return <Layout />;
}

export default function App() {
  if (isProduction && (window.location.pathname === "/" || window.location.pathname === "/app" || window.location.pathname === "/app/")) {
    window.location.replace(getCanonicalAppHashUrl(getCurrentHashPath()));
    return <PortalLoadingScreen />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<ProtectedAppShell />}>
          {/* Default + explicit dashboard routes */}
          <Route index element={<RoleBasedDashboard />} />
          <Route path="dashboard" element={<RoleBasedDashboard />} />

          {/* Existing Quick Rates route */}
          <Route path="quick-rates" element={<QuickRatesAdvance />} />
          <Route path="seller-proceeds" element={<SellerProceedsStart />} />
          <Route path="faq" element={<FaqPage />} />

        </Route>
        <Route path="/login" element={<LoginRedirect />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
