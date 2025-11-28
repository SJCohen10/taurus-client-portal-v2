// client/src/pages/dashboard/ParalegalDashboard.jsx
import React, { useEffect, useState, useMemo } from "react";
import { fetchMyDeals, fetchFirmDeals } from "../../services/portalApi";
import "./ParalegalDashboard.css";

const DEV_DEFAULT_EMAIL = "paralegal.sandbox@lawfirm.co.za";
const DEV_DEFAULT_NAME = "Sandbox Paralegal";

function getPortalUserDisplay() {
    if (window?.portalUser?.email || window?.portalUser?.name) {
        return {
            name: window.portalUser.name || "Portal User",
            email: window.portalUser.email || "",
        };
    }

    if (process.env.NODE_ENV === "development") {
        return {
            name: DEV_DEFAULT_NAME,
            email: DEV_DEFAULT_EMAIL,
        };
    }

    return {
        name: "Portal User",
        email: "",
    };
}


export default function ParalegalDashboard() {
    const [view, setView] = useState("my"); // "my" | "firm"
    const [myDeals, setMyDeals] = useState([]);
    const [firmDeals, setFirmDeals] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const { name: displayName, email: displayEmail } = getPortalUserDisplay();


    const activeDeals = view === "my" ? myDeals : firmDeals;

    useEffect(() => {
        loadMyDeals();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function loadMyDeals() {
        try {
            setLoading(true);
            setError("");
            const data = await fetchMyDeals();

            console.log("MY DEALS RESPONSE", data);  // 👈 add this

            // Expecting { count, deals: [...] }
            setMyDeals(data.deals || []);
        } catch (err) {
            console.error(err);
            setError("Unable to load your deals at the moment.");
        } finally {
            setLoading(false);
        }
    }

    async function loadFirmDeals() {
        // Avoid reloading if we already have them
        if (firmDeals.length > 0) return;

        try {
            setLoading(true);
            setError("");
            const data = await fetchFirmDeals();
            setFirmDeals(data.deals || []);
        } catch (err) {
            console.error(err);
            setError("Unable to load your firm’s deals at the moment.");
        } finally {
            setLoading(false);
        }
    }

    function handleViewChange(nextView) {
        setView(nextView);
        if (nextView === "firm") {
            loadFirmDeals();
        }
    }

    const stats = useMemo(() => {
        const list = activeDeals || [];
        const total = list.length;

        // Adjust these based on real field names later
        const activeCount = list.filter(
            (d) => (d.status || "").toLowerCase() === "active"
        ).length;

        const totalAmount = list.reduce((sum, d) => {
            const val = Number(d.amount || d.deal_amount || 0);
            return sum + (isNaN(val) ? 0 : val);
        }, 0);

        return { total, activeCount, totalAmount };
    }, [activeDeals]);


    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <div>
                    <h1 className="dashboard-title">My Bridging Deals</h1>
                    <p className="dashboard-subtitle">
                        View your live matters and your firm’s pipeline at a glance.
                    </p>
                </div>
                <div className="dashboard-user-pill">
                    <span className="user-name">{displayName}</span>
                    <span className="user-email">{displayEmail}</span>

                </div>
            </header>

            <div className="dashboard-toggle">
                <button
                    type="button"
                    className={`toggle-button ${view === "my" ? "active" : ""}`}
                    onClick={() => handleViewChange("my")}
                >
                    My Deals
                </button>
                <button
                    type="button"
                    className={`toggle-button ${view === "firm" ? "active" : ""}`}
                    onClick={() => handleViewChange("firm")}
                >
                    Firm Deals
                </button>
            </div>

            <section className="dashboard-stats">
                <div className="stat-card">
                    <div className="stat-label">Deals in view</div>
                    <div className="stat-value">{stats.total}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Active / In-Process</div>
                    <div className="stat-value">{stats.activeCount}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Total Amount</div>
                    <div className="stat-value">
                        R {stats.totalAmount.toLocaleString("en-ZA")}
                    </div>
                </div>
            </section>

            <section className="dashboard-table-section">
                <div className="section-header">
                    <h2 className="section-title">
                        {view === "my" ? "My Deals" : "Firm Deals"}
                    </h2>
                    <p className="section-subtitle">
                        Click a deal to view details, statements and documents (coming
                        soon).
                    </p>
                </div>

                {loading && <div className="dashboard-message">Loading deals…</div>}

                {error && !loading && (
                    <div className="dashboard-message error">{error}</div>
                )}

                {!loading && !error && activeDeals.length === 0 && (
                    <div className="dashboard-message">
                        No deals found yet for this view.
                    </div>
                )}

                {!loading && !error && activeDeals.length > 0 && (
                    <div className="deals-table-wrapper">
                        <table className="deals-table">
                            <thead>
                                <tr>
                                    <th>Property Ref Number</th>
                                    <th>Property Description</th>
                                    <th>Status</th>
                                    <th>Amount</th>
                                    <th>Paralegal</th>
                                    <th>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeDeals.map((deal, index) => (
                                    <tr
                                        key={deal.id || deal.deal_id || index}
                                        className="deals-row"
                                        onClick={() => {
                                            // Future: navigate(`/deals/${deal.id}`);
                                        }}
                                    >
                                        <td>
                                            {deal.property_ref_number ||
                                                deal.matter_name ||
                                                "—"}
                                        </td>
                                        <td>
                                            {deal.property_description ||
                                                deal["Property Description"] ||
                                                "—"}
                                        </td>
                                        <td>{deal.status || "—"}</td>
                                        <td>
                                            {deal.amount || deal.deal_amount
                                                ? `R ${Number(
                                                    deal.amount || deal.deal_amount
                                                ).toLocaleString("en-ZA")}`
                                                : "—"}
                                        </td>
                                        <td>
                                            {deal.paralegal_name ||
                                                deal.owner_name ||
                                                deal.contact_email ||
                                                "—"}
                                        </td>
                                        <td>{deal.created_time || deal.created_at || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
