import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { usePortalContext } from "./PortalContext";

export default function Layout() {
  const portal = usePortalContext();
  const location = useLocation();

  const email = portal?.email || "";
  const context = portal?.context || null;
  const loading = portal?.loading || false;
  const error = portal?.error || "";
  const requestId = portal?.requestId || portal?.context?.requestId || "";

  const accountName = context?.accountName || "Account";
  const quickBridgeLimit = context?.quickBridgeLimit ?? null;

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
                "Checking login…"
              )}
            </small>
          </div>

          <img
            src={`${process.env.PUBLIC_URL}/taurus-capital-logo.png`}
            alt="Taurus Capital"
            className="app-header-logo"
          />

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
        </nav>

        {loading && (
          <p className="subtle" style={{ marginTop: "0.5rem" }}>
            Loading CRM context…
          </p>
        )}
        {error && <p className="error">Error: {error}{requestId ? ` | requestId: ${requestId}` : ""}</p>}
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
