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


const STATUS_BUCKETS = {
    pending: new Set(["pending review"]),
    active: new Set(["active", "due to taurus"]),
    closed: new Set(["closed", "declined"]),
};

function normalizeStatus(s) {
    return String(s || "").trim().toLowerCase();
}

function getDealStatus(deal) {
    return normalizeStatus(deal?.status ?? deal?.["Status"]);
}


function parseNumber(val) {
    if (val === undefined || val === null || val === "") return null;
    const numeric = Number(String(val).replace(/[^0-9.-]/g, ""));
    return Number.isNaN(numeric) ? null : numeric;
}

function formatRand(val) {
    const n = parseNumber(val);
    return n === null ? "—" : `R ${n.toLocaleString("en-ZA")}`;
}


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
    const { name: displayName, email: displayEmail } =
        getPortalUserDisplay(portalContext);

    const [view, setView] = useState("my"); // "my" | "firm"
    const [myDeals, setMyDeals] = useState([]);
    const [firmDeals, setFirmDeals] = useState([]);
    const [loadedFirmAccountId, setLoadedFirmAccountId] = useState("");
    const [loading, setLoading] = useState(false);
    const [agentReferralOpen, setAgentReferralOpen] = useState(false);
    const [error, setError] = useState("");
    const DEFAULT_OPEN_SECTIONS = {
        pending: true,
        active: true,
        closed: false,
        other: false,
    };

    const storageKey = useMemo(() => {
        // key per user + per view (optional). If you want the SAME state for my/firm, remove `:${view}`
        const emailKey = (displayEmail || "unknown").toLowerCase();
        return `paralegalDashboardOpenSections:${emailKey}:${view}`;
    }, [displayEmail, view]);

    const [openSections, setOpenSections] = useState(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return DEFAULT_OPEN_SECTIONS;
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_OPEN_SECTIONS, ...(parsed || {}) };
        } catch {
            return DEFAULT_OPEN_SECTIONS;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(openSections));
        } catch {
            // ignore
        }
    }, [openSections, storageKey]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                setOpenSections(DEFAULT_OPEN_SECTIONS);
                return;
            }
            const parsed = JSON.parse(raw);
            setOpenSections({ ...DEFAULT_OPEN_SECTIONS, ...(parsed || {}) });
        } catch {
            setOpenSections(DEFAULT_OPEN_SECTIONS);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey]);


    function toggleSection(key) {
        setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
    }




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
            STATUS_BUCKETS.active.has(getDealStatus(d)) ||
            STATUS_BUCKETS.pending.has(getDealStatus(d))
        );

        const activeCount = activeList.length;

        const totalAmount = activeList.reduce((sum, d) => {
            const val = getAmountValue(d);
            return sum + (val ?? 0);
        }, 0);

        return { total, activeCount, totalAmount };
    }, [activeDeals]);

    const dealBuckets = useMemo(() => {
        const list = activeDeals || [];

        const pending = [];
        const active = [];
        const closed = [];
        const other = [];

        for (const d of list) {
            const st = getDealStatus(d);

            if (STATUS_BUCKETS.pending.has(st)) pending.push(d);
            else if (STATUS_BUCKETS.active.has(st)) active.push(d);
            else if (STATUS_BUCKETS.closed.has(st)) closed.push(d);
            else other.push(d);
        }

        return { pending, active, closed, other };
    }, [activeDeals]);

    function DealsTable({ sectionKey, title, deals, defaultOpen = true }) {
        const isOpen = openSections[sectionKey] ?? defaultOpen;

        return (
            <section className="dashboard-table-section">
                <div
                    className="section-header collapsible"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSection(sectionKey)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") toggleSection(sectionKey);
                    }}
                >
                    <div className="section-title-row">
                        <h2 className="section-title">{title}</h2>
                        <span className="section-count-pill">{deals.length}</span>
                    </div>

                    <button
                        type="button"
                        className="collapse-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleSection(sectionKey);
                        }}
                        aria-expanded={isOpen}
                    >
                        {isOpen ? "Hide" : "Show"}
                    </button>
                </div>

                {isOpen && (
                    <>
                        {deals.length === 0 ? (
                            <div className="dashboard-message">No deals in this category.</div>
                        ) : (
                            <div className="deals-table-wrapper">
                                <table className="deals-table">
                                    <thead>
                                        <tr>
                                            <th className="col-priority-high col-ref">Property Ref Number</th>
                                            <th className="col-priority-medium col-description">Property Description</th>
                                            <th className="col-priority-low">Lodged</th>
                                            <th className="col-priority-low">Registered</th>
                                            <th className="col-priority-high">Status</th>
                                            <th className="col-priority-high">Advanced</th>
                                            <th className="col-priority-high">Current Balance</th>
                                            <th className="col-priority-low">Upsell Available</th>
                                            <th className="col-priority-medium">Created</th>
                                            <th className="actions-cell actions-header">Actions</th>
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {deals.map((deal, index) => (
                                            <tr key={deal.id || deal.deal_id || index} className="deals-row">
                                                <td className="col-priority-high col-ref">{deal.property_ref_number || deal.matter_name || "—"}</td>
                                                <td className="col-priority-medium col-description">{deal.property_description || deal["Property Description"] || "—"}</td>
                                                <td className="col-priority-low">{deal.lodged ?? deal["Lodged"] ?? "—"}</td>
                                                <td className="col-priority-low">{deal.registered ?? deal["Registered"] ?? "—"}</td>
                                                <td className="col-priority-high">{deal.status ?? deal["Status"] ?? "—"}</td>
                                                <td className="col-priority-high">{formatRand(deal.amount ?? deal["Amount"])}</td>
                                                <td className="col-priority-high">{formatRand(deal.current_balance ?? deal["Current Balance"])}</td>
                                                <td className="col-priority-low">{formatRand(deal.upsell_available ?? deal["Upsell Available"])}</td>
                                                <td className="col-priority-medium">{deal.created_time || deal.created_at || "—"}</td>
                                                <td className="actions-cell">
                                                    <DealActions deal={deal} portalEmail={displayEmail} accountId={accountId} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </section>
        );
    }



    function Modal({ open, title, onClose, children }) {
        if (!open) return null;

        return (
            <div className="modal-backdrop" onClick={onClose}>
                <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                        <h3 className="modal-title">{title}</h3>
                        <button type="button" className="modal-close" onClick={onClose}>
                            ✕
                        </button>
                    </div>
                    <div className="modal-body">{children}</div>
                </div>
            </div>
        );
    }



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
                <div className="card action-card">
                    <h3>Quick Bridge Application</h3>
                    <p className="subtle">
                        Start a new request with your firm’s preferred quick rates bank details.
                    </p>
                    <Link className="button" to="/quick-rates">
                        Start Quick Bridge Application
                    </Link>
                </div>
                <div className="card action-card">
                    <h3>Seller Application</h3>
                    <p className="subtle">
                        Create a seller proceeds request and keep your pipeline moving.
                    </p>
                    <Link className="button" to="/seller-proceeds">
                        Start Seller Application
                    </Link>
                </div>
                <div className="card action-card">
                    <h3>Agent Referral</h3>
                    <p className="subtle">
                        Refer an estate agent deal by completing a quick referral form.
                    </p>
                    <button className="button" type="button" onClick={() => setAgentReferralOpen(true)}>
                        Open Agent Referral Form
                    </button>
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
                    <h2 className="section-title">{view === "my" ? "My Deals" : "Firm Deals"}</h2>
                    <p className="section-subtitle">
                        View Deal Details, Generate Statements and Upload Documents
                    </p>
                </div>

                {loading && <div className="dashboard-message">Loading deals…</div>}
                {error && !loading && <div className="dashboard-message error">{error}</div>}

                {!loading && !error && (
                    <>
                        <DealsTable sectionKey="pending" title="Pending Review" deals={dealBuckets.pending} />
                        <DealsTable sectionKey="active" title="Active / Due to Taurus" deals={dealBuckets.active} />
                        <DealsTable sectionKey="closed" title="Closed / Declined" deals={dealBuckets.closed} />

                        {dealBuckets.other.length > 0 && (
                            <DealsTable sectionKey="other" title="Other" deals={dealBuckets.other} />
                        )}

                    </>
                )}
            </section>

            <Modal
                open={agentReferralOpen}
                title="Agent Referral"
                onClose={() => setAgentReferralOpen(false)}
            >
                <iframe
                    title="Agent Referral Form"
                    src="https://zfrmz.com/TT8sluE728L5jNprA15m"
                    className="modal-iframe"
                    frameBorder="0"
                />
            </Modal>


        </div >
    );
}
