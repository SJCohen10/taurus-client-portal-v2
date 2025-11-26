import React, { useEffect, useState, useMemo } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { PortalContext } from "./PortalContext";


function usePortalUser() {
    const [user, setUser] = useState(null);

    useEffect(() => {
        async function load() {
            try {
                // 1) Try Catalyst Web SDK, if we are actually running under Catalyst
                if (window.catalyst && window.catalyst.auth) {
                    console.log("[portal] Using catalyst.auth");
                    const isAuthed = await window.catalyst.auth.isUserAuthenticated();
                    console.log("[portal] isUserAuthenticated =", isAuthed);
                    if (isAuthed) {
                        const currentUser = await window.catalyst.auth.getCurrentUser();
                        console.log("[portal] currentUser from SDK =", currentUser);
                        setUser(currentUser);
                        return;
                    }
                }

                // 2) Fallback to whatever init.js put on window
                if (window.portalUser) {
                    console.log("[portal] Using window.portalUser =", window.portalUser);
                    setUser(window.portalUser);
                    return;
                }

                // 3) Dev fallback (npm start) – use .env dev email if provided
                if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
                    const devEmail = process.env.REACT_APP_DEV_EMAIL || "";
                    if (devEmail) {
                        console.log("[portal] Dev fallback email =", devEmail);
                        setUser({ email_id: devEmail });
                    } else {
                        console.warn(
                            "[portal] No portal user and no REACT_APP_DEV_EMAIL set."
                        );
                    }
                }
            } catch (err) {
                console.error("Failed to get portal user:", err);
            }
        }

        load();
    }, []);

    return user;
}

function usePortalContext(user) {
    const [context, setContext] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const email = useMemo(() => {
        if (!user) return "";
        return (
            user.email ||
            user.email_id ||
            user.user_mailid ||
            user.user_email ||
            ""
        );
    }, [user]);

    useEffect(() => {
        if (!email) return;

        async function fetchContext() {
            try {
                setLoading(true);
                setError("");

                // Allow overriding the base for local dev.
                // In Catalyst, leave REACT_APP_API_BASE unset so this stays "" (same origin).
                const apiBase = process.env.REACT_APP_API_BASE || "";
                const url = `${apiBase}/server/getportalusercontext?email=${encodeURIComponent(
                    email
                )}`;

                console.log("[portal] Fetching context from", url);

                const res = await fetch(url);

                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(
                        `HTTP ${res.status}: ${text || "No response body"}`
                    );
                }

                const data = await res.json();
                console.log("[portal] Context =", data);
                setContext(data);
            } catch (err) {
                console.error("Error loading portal context:", err);
                setError(err.message || "Failed to load portal context");
            } finally {
                setLoading(false);
            }
        }

        fetchContext();
    }, [email]);

    return { context, loading, error, email };
}

export default function Layout() {
    const user = usePortalUser();
    const { context, loading, error, email } = usePortalContext(user);
    const location = useLocation();

    const accountName = context?.accountName || "Account";
    const quickBridgeLimit = context?.quickBridgeLimit ?? null;
    const portalContextValue = {
        user,
        context,
        loading,
        error,
        email,
    };


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
                <nav style={{ marginTop: "0.75rem" }}>
                    <Link
                        to="/"
                        className="button"
                        style={{
                            marginRight: "0.75rem",
                            background:
                                location.pathname === "/" ? "#1d4ed8" : "#6b7280",
                        }}
                    >
                        Dashboard
                    </Link>
                    <Link
                        to="/quick-rates"
                        className="button"
                        style={{
                            background:
                                location.pathname.startsWith("/quick-rates")
                                    ? "#1d4ed8"
                                    : "#6b7280",
                        }}
                    >
                        Quick Rates Application
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
                <PortalContext.Provider value={portalContextValue}>
                    <Outlet />
                </PortalContext.Provider>
            </main>

        </div>
    );
}
