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

function ProtectedAppShell() {
  const portal = usePortalContext();

  React.useEffect(() => {
    if (!portal?.loading && !portal?.authenticated && isProduction) {
      window.location.replace(buildCatalystLoginUrl());
    }
  }, [portal?.authenticated, portal?.loading]);

  if (portal?.loading || (!portal?.authenticated && isProduction)) {
    return <p className="subtle">Checking authentication…</p>;
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
