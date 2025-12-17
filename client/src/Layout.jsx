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

  const accountName = context?.accountName || "Account";
  const quickBridgeLimit = context?.quickBridgeLimit ?? null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Taurus Client Portal</h1>

        <small>
          {email ? (
            <>
              Signed in as <strong>{email}</strong>{" "}
              {accountName && <>| {accountName}</>}
              {typeof quickBridgeLimit === "number" && (
                <> | Quick Bridge Limit: R {quickBridgeLimit.toLocaleString()}</>
              )}
            </>
          ) : (
            "Checking login…"
          )}
        </small>

        <nav style={{ marginTop: "0.75rem", display: "flex", gap: "0.75rem" }}>
          <Link
            to="/"
            className="button"
            style={{
              marginRight: "0.75rem",
              background: location.pathname === "/" ? "#1d4ed8" : "#6b7280",
            }}
          >
            Dashboard
          </Link>

          <Link
            to="/quick-rates"
            className="button"
            style={{
              background: location.pathname.startsWith("/quick-rates")
                ? "#1d4ed8"
                : "#6b7280",
            }}
          >
            Quick Bridge Application
          </Link>

          <Link
            to="/seller-proceeds"
            className="button"
            style={{
              background: location.pathname.startsWith("/seller-proceeds")
                ? "#1d4ed8"
                : "#6b7280",
            }}
          >
            Seller Application
          </Link>
        </nav>

        {loading && (
          <p className="subtle" style={{ marginTop: "0.5rem" }}>
            Loading CRM context…
          </p>
        )}
        {error && <p className="error">Error: {error}</p>}
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
