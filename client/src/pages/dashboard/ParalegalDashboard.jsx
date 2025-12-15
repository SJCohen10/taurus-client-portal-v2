// client/src/pages/dashboard/ParalegalDashboard.jsx
import React, { useEffect, useState, useMemo } from "react";
import { usePortalContext } from "../../PortalContext";
import { fetchMyDeals, fetchFirmDeals } from "../../services/portalApi";
import "./ParalegalDashboard.css";
import DealActions from "./components/DealActions";
import { Link } from "react-router-dom";


const DEV_DEFAULT_EMAIL = "paralegal.sandbox@lawfirm.co.za";
const DEV_DEFAULT_NAME = "Sandbox Paralegal";

function getPortalUserDisplay(portalContext) {
    if (portalContext?.context?.contactName || portalContext?.email) {
        return {
            name:
                portalContext.context?.contactName ||
                portalContext.user?.name ||
                "Portal User",
            email: portalContext.email || "",
        };
    }
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


const NORMALIZED_STATUSES = ["pending review", "active", "due to taurus"];

function getAmountValue(deal) {
    const rawAmount = deal?.amount ?? deal?.deal_amount;

    if (rawAmount === undefined || rawAmount === null || rawAmount === "") {
        return null;
    }

    const numeric = Number(String(rawAmount).replace(/[^0-9.-]/g, ""));
    return Number.isNaN(numeric) ? null : numeric;
}

export default function ParalegalDashboard() {
    const portalContext = usePortalContext();
    const accountId =
        portalContext?.context?.accountId || portalContext?.context?.account_id;
    const accountName = portalContext?.context?.accountName || "";
    const [view, setView] = useState("my"); // "my" | "firm"
    const [myDeals, setMyDeals] = useState([]);
    const [firmDeals, setFirmDeals] = useState([]);
    const [loadedFirmAccountId, setLoadedFirmAccountId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const { name: displayName, email: displayEmail } =
        getPortalUserDisplay(portalContext);


    const activeDeals = view === "my" ? myDeals : firmDeals;

    useEffect(() => {
        if (displayEmail) {
            loadMyDeals(displayEmail);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayEmail]);

    async function loadMyDeals(emailOverride) {
        if (!emailOverride) return;


        try {
            setLoading(true);
            setError("");
            const data = await fetchMyDeals(emailOverride);

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

    async function loadFirmDeals(accountIdToUse) {
        if (!accountIdToUse && !displayEmail) {
            setError("Firm account is not available yet.");
            return;
        }

        if (
            firmDeals.length > 0 &&
            loadedFirmAccountId &&
            loadedFirmAccountId === accountIdToUse
        ) {
            return;
        }

        try {
            setLoading(true);
            setError("");
            const data = await fetchFirmDeals({
                accountId: accountIdToUse,
                fallbackEmail: displayEmail,
            });
            setFirmDeals(data.deals || []);
            setLoadedFirmAccountId(accountIdToUse || "");
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
            loadFirmDeals(accountId);
        }
    }

    useEffect(() => {
        if (view === "firm" && accountId) {
            loadFirmDeals(accountId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId, view]);


    const stats = useMemo(() => {
        const list = activeDeals || [];
        const total = list.length;
        const activeList = list.filter((d) =>
            NORMALIZED_STATUSES.includes((d.status || "").toLowerCase())
        );
        const activeCount = activeList.length;

        const totalAmount = activeList.reduce((sum, d) => {
            const val = getAmountValue(d);
            return sum + (val ?? 0);
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
                    {accountName && (
                        <div className="dashboard-subtitle subtle">
                            Firm: {accountName}
                        </div>
                    )}
                </div>
                <div className="dashboard-user-pill">
                    <span className="user-name">{displayName}</span>
                    <span className="user-email">{displayEmail}</span>

                </div>
            </header>

            <div className="dashboard-actions">
                <div className="card" style={{ padding: "1rem" }}>
                    <h3 style={{ marginTop: 0 }}>Quick Bridge Application</h3>
                    <p className="subtle">
                        Submit a Quick Bridge application and choose the bank account before opening the form.
                    </p>
                    <Link className="button" to="/quick-rates">Start Quick Bridge</Link>
                </div>

                <div className="card" style={{ padding: "1rem" }}>
                    <h3 style={{ marginTop: 0 }}>Seller Proceeds Bridging Finance</h3>
                    <p className="subtle">
                        Submit a Seller Proceeds application and capture 1 or 2 seller bank accounts before opening the form.
                    </p>
                    <Link className="button" to="/seller-proceeds">Start Seller Proceeds</Link>
                </div>
            </div>


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
                        Click a deal to view details, statements and documents
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
                                    <th>Lodged</th>
                                    <th>Registered</th>
                                    <th>Status</th>
                                    <th>Amount</th>
                                    <th>Paralegal</th>
                                    <th>Created</th>
                                    <th>Actions</th>
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
                                        {/* Property Ref Number */}
                                        <td>
                                            {deal.property_ref_number ||
                                                deal.matter_name ||
                                                "—"}
                                        </td>

                                        {/* Property Description */}
                                        <td>
                                            {deal.property_description ||
                                                deal["Property Description"] ||
                                                "—"}
                                        </td>

                                        {/* Lodged */}
                                        <td>
                                            {deal.lodged ??
                                                deal["Lodged"] ??
                                                "—"}
                                        </td>

                                        {/* Registered */}
                                        <td>
                                            {deal.registered ??
                                                deal["Registered"] ??
                                                "—"}
                                        </td>

                                        {/* Status */}
                                        <td>
                                            {deal.status ??
                                                deal["Status"] ??
                                                "—"}
                                        </td>

                                        {/* Amount */}
                                        <td>
                                            {getAmountValue(deal) !== null
                                                ? `R ${getAmountValue(deal).toLocaleString("en-ZA")}`
                                                : "—"}
                                        </td>

                                        {/* Paralegal */}
                                        <td>
                                            {deal.paralegal_name ||
                                                deal.owner_name ||
                                                deal.contact_email ||
                                                "—"}
                                        </td>

                                        {/* Created */}
                                        <td>
                                            {deal.created_time ||
                                                deal.created_at ||
                                                "—"}
                                        </td>
                                        <td className="actions-cell">
                                            <DealActions
                                                deal={deal}
                                                portalEmail={displayEmail}
                                                accountId={accountId}
                                            />
                                        </td>
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
