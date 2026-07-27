import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { usePortalContext } from "./PortalContext";
import { isAgentAdvanceEnabled } from "./pages/agent-advance/agentAdvanceHelpers";

export default function Layout() {
  const portal = usePortalContext();
  const location = useLocation();

  const email = portal?.email || "";
  const context = portal?.context || null;
  const loading = portal?.loading || false;
  const error = portal?.error || "";
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  const accountName = context?.accountName || "Account";
  const quickBridgeLimit = context?.quickBridgeLimit ?? null;

  const handleLogout = async () => {
    if (!portal?.logout || isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await portal.logout();
    } catch (logoutError) {
      console.error("[PortalAuth] Logout failed", {
        message: logoutError?.message || "Unexpected logout error",
      });
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-top">
          <div className="app-header-meta">
            <h1>Taurus Client Portal</h1>
            <small>
              {email ? (
                <>
                  Signed in as <strong>{email}</strong>{" "}
                  {accountName && <>| {accountName}</>}
                  {typeof quickBridgeLimit === "number" && (
                    <>
                      {" "}
                      | Quick Bridge Limit Per Deal: R {quickBridgeLimit.toLocaleString()}
                    </>
                  )}
                </>
              ) : (
                "Preparing your portal…"
              )}
            </small>
          </div>

          <div className="app-header-actions">
            <img
              src={`${process.env.PUBLIC_URL}/taurus-capital-logo.png`}
              alt="Taurus Capital"
              className="app-header-logo"
            />
          </div>

        </div>

        <nav className="app-nav">
          <Link
            to="/"
            className={`app-nav-link ${location.pathname === "/" ? "active" : ""
              }`}
          >
            Dashboard
          </Link>

          <Link
            to="/quick-rates"
            className={`app-nav-link ${location.pathname.startsWith("/quick-rates") ? "active" : ""
              }`}
          >
            Quick Bridge Application
          </Link>

          <Link
            to="/seller-proceeds"
            className={`app-nav-link ${location.pathname.startsWith("/seller-proceeds") ? "active" : ""
              }`}
          >
            Seller Application
          </Link>
          {isAgentAdvanceEnabled(context) && (
            <Link
              to="/agent-advance"
              className={`app-nav-link ${location.pathname.startsWith("/agent-advance") ? "active" : ""
                }`}
            >
              Conveyancing Firm Agent Facility
            </Link>
          )}
          <Link
            to="/faq"
            className={`app-nav-link ${location.pathname.startsWith("/faq") ? "active" : ""
              }`}
          >
            FAQ
          </Link>
          <button type="button" className="app-nav-link app-nav-button" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? "Signing out…" : "Logout"}
          </button>
        </nav>

        {loading && (
          <p className="subtle" style={{ marginTop: "0.5rem" }}>
            Loading your profile…
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
