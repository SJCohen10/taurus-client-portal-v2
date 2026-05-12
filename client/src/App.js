import React from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./Layout";
import { usePortalContext } from "./PortalContext";
import RoleBasedDashboard from "./pages/dashboard/RoleBasedDashboard";
import QuickRatesAdvance from "./pages/forms/property/QuickRatesAdvance";
import FaqPage from "./pages/faq/FaqPage";

import SellerProceedsStart from "./pages/forms/property/SellerProceedsStart";
import { getAppReturnUrl, redirectToLogin } from "./auth/portalAuth";

const isProduction = process.env.NODE_ENV === "production";
const isDebugRouting = process.env.REACT_APP_DEBUG_ROUTING === "true";


const buildAppHashUrl = (hashPath = "/") => {
  const sanitized = hashPath.startsWith("/") ? hashPath : `/${hashPath}`;
  return `${window.location.origin}/app/#${sanitized}`;
};

function getCurrentHashPath() {
  const rawHash = window.location.hash || "";
  const hashWithoutPrefix = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  const normalized = hashWithoutPrefix || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function getSafeServiceUrl() {
  const { pathname, hash } = window.location;
  const hasHashRoute = Boolean(hash && hash.startsWith("#/"));
  if (pathname.startsWith("/__catalyst/")) return buildAppHashUrl("/");
  if (pathname === "/" || pathname === "/app" || pathname === "/app/") {
    return hasHashRoute ? buildAppHashUrl(getCurrentHashPath()) : buildAppHashUrl("/");
  }
  if (pathname.startsWith("/app/")) return hasHashRoute ? buildAppHashUrl(getCurrentHashPath()) : buildAppHashUrl("/");
  return buildAppHashUrl("/");
}

function LoginRedirect() {
  React.useEffect(() => {
    redirectToLogin(getAppReturnUrl(), "route-login");
  }, []);

  return <p className="subtle">Redirecting to Catalyst login…</p>;
}

function AccessErrorScreen() {
  return (
    <div style={{ padding: "2rem" }}>
      <h2>Portal Access Issue</h2>
      <p>Your login was successful, but your Taurus portal access could not be verified. Please contact Taurus Capital if you believe this is incorrect.</p>
      
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
  const [showLongLoadingMessage, setShowLongLoadingMessage] = React.useState(false);
  const safeServiceUrl = getSafeServiceUrl();

  React.useEffect(() => {
    if (!portal?.loading || portal?.authenticated || portal?.authFailure || portal?.serverFailure) {
      setShowLongLoadingMessage(false);
      return;
    }
    const timer = setTimeout(() => {
      setShowLongLoadingMessage(true);
    }, 15000);
    return () => clearTimeout(timer);
  }, [portal?.loading, portal?.authenticated, portal?.authFailure, portal?.serverFailure]);

  React.useEffect(() => {
    if (!isDebugRouting) return;
    console.info("[routing-debug] protected-shell-state", {
      loading: portal?.loading,
      authenticated: portal?.authenticated,
      authFailure: portal?.authFailure,
      needsLogin: portal?.needsLogin,
      serverFailure: portal?.serverFailure,
      serviceUrl: safeServiceUrl,
    });
  }, [portal?.loading, portal?.authenticated, portal?.authFailure, portal?.needsLogin, portal?.serverFailure, safeServiceUrl]);

  React.useEffect(() => {
    if (!portal?.needsLogin || portal?.loading || portal?.authenticated) return;
    if (redirectAttemptedRef.current) return;

    redirectAttemptedRef.current = true;
    redirectToLogin(safeServiceUrl, "protected-shell-needs-login");
  }, [portal?.needsLogin, portal?.loading, portal?.authenticated, safeServiceUrl]);

  if (portal?.loading) {
    if (showLongLoadingMessage) {
      return (
        <div style={{ padding: "2rem" }}>
          <h2>Taurus Client Portal</h2>
          <p className="subtle">Still loading portal context. Please refresh or contact Taurus Capital if this continues.</p>
        </div>
      );
    }
    return <PortalLoadingScreen />;
  }

  if (!portal?.authenticated) {
    if (portal?.serverFailure) {
      return (
        <div style={{ padding: "2rem" }}>
          <h2>Temporary Portal Error</h2>
          <p>{portal?.error || "Temporary server issue while loading your portal access. Please try again shortly."}</p>

        </div>
      );
    }
    if (portal?.authFailure) return <AccessErrorScreen />;
    if (portal?.needsLogin) return <p className="subtle" style={{ padding: "2rem" }}>Redirecting to login…</p>;
    return <PortalLoadingScreen />;
  }

  return <Layout />;
}

export default function App() {
  const { pathname, hash } = window.location;
  const hasHashRoute = Boolean(hash && hash.startsWith("#/"));
  const isCanonicalBasePath = pathname === "/" || pathname === "/app" || pathname === "/app/";
  const shouldCanonicalRedirect = isProduction && !hasHashRoute && isCanonicalBasePath;

  if (isDebugRouting) {
    console.info("[routing-debug] app-bootstrap", {
      pathname,
      hash,
      hasHashRoute,
      serviceUrl: getSafeServiceUrl(),
      shouldCanonicalRedirect,
    });
  }

  if (shouldCanonicalRedirect) {
    window.location.replace(buildAppHashUrl("/"));
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
