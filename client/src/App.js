import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Layout from "./Layout";
import { usePortalContext } from "./PortalContext";
import RoleBasedDashboard from "./pages/dashboard/RoleBasedDashboard";
import QuickRatesAdvance from "./pages/forms/property/QuickRatesAdvance";
import FaqPage from "./pages/faq/FaqPage";

import SellerProceedsStart from "./pages/forms/property/SellerProceedsStart";

// Use basename "/app" only in production (Catalyst hosting)
const basename =
  process.env.NODE_ENV === "production" ? "/app" : "/";

const isProduction = process.env.NODE_ENV === "production";
const LOGIN_ATTEMPT_KEY = "taurus_portal_login_attempted_at";
const LOGIN_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

function buildCatalystLoginUrl() {
  const loginUrl = new URL("/__catalyst/auth/login", window.location.origin);
  loginUrl.searchParams.set("service_url", window.location.href);
  return loginUrl.toString();
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
      <p>We could not verify your portal access. Please contact Taurus Capital to resolve this issue.</p>
      {requestId ? <p className="subtle">requestId: {requestId}</p> : null}
    </div>
  );
}

function PortalLoadingScreen() {
  return (
    <div style={{ padding: "2rem" }}>
      <h2>Taurus Client Portal</h2>
      <p className="subtle">Loading portal…</p>
    </div>
  );
}

function ProtectedAppShell() {
  const portal = usePortalContext();
  const redirectAttemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isProduction || portal?.loading || portal?.authenticated || portal?.authFailure || portal?.error) return;

    const now = Date.now();
    const previous = Number(window.sessionStorage.getItem(LOGIN_ATTEMPT_KEY) || 0);
    const withinWindow = previous && now - previous < LOGIN_ATTEMPT_WINDOW_MS;

    if (withinWindow || redirectAttemptedRef.current) return;

    redirectAttemptedRef.current = true;
    window.sessionStorage.setItem(LOGIN_ATTEMPT_KEY, String(now));
    window.location.replace(buildCatalystLoginUrl());
  }, [portal?.authenticated, portal?.loading, portal?.authFailure, portal?.error]);

  React.useEffect(() => {
    if (portal?.authenticated) {
      window.sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);
    }
  }, [portal?.authenticated]);

  if (portal?.loading) {
    return <PortalLoadingScreen />;
  }

  if (!portal?.authenticated) {
    if (!isProduction) return <Layout />;
    return <AccessErrorScreen requestId={portal?.requestId} />;
  }

  return <Layout />;
}

export default function App() {
  return (
    <BrowserRouter basename={basename}>
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
    </BrowserRouter>
  );
}
