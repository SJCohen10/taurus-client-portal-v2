import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePortalContext } from "../../PortalContext";
import { fetchDealTransactions, fetchFirmDeals } from "../../services/portalApi";
import DealActions from "./components/DealActions";
import "./ParalegalDashboard.css";


const DEV_DEFAULT_NAME = "Developer Impersonation";

function getDevImpersonationEmail() {
    if (process.env.NODE_ENV !== "development") return "";
    return (process.env.REACT_APP_DEV_IMPERSONATE_EMAIL || "").trim().toLowerCase();
}
const DEFAULT_OPEN_SECTIONS = { pending: true, active: true, lodged: true, closed: false, declined: false, other: false };
const STATUS_BUCKETS = {
    pending: new Set(["pending review"]),
    active: new Set(["active", "due to taurus"]),
    lodged: new Set(["lodged"]),
    closed: new Set(["closed"]),
    declined: new Set(["declined"]),
};

const DEAL_DETAIL_FIELDS = [
    ["Property Ref Number", "property_ref_number"],
    ["Property Description", "property_description"],
    ["Lodged", "lodged"],
    ["Registered", "registered"],
    ["Status", "status"],
    ["Advanced", "amount"],
    ["Current Balance", "current_balance"],
    ["Upsell Available", "upsell_available"],
    ["Expected Lodgement Date", "expectedLodgementDate"],
    ["Created", "created_time"],
    ["Seller", "seller"],
];

function normalizeStatus(value) {
    return String(value || "").trim().toLowerCase();
}

function parseNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const numeric = Number(String(value).replace(/[^0-9.-]/g, ""));
    return Number.isNaN(numeric) ? null : numeric;
}

function formatRand(value) {
    const numeric = parseNumber(value);
    return numeric === null ? "—" : `R ${numeric.toLocaleString("en-ZA")}`;
}

function formatDate(value) {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleDateString("en-ZA");
}

function getPortalUserDisplay(portalContext) {
    if (portalContext?.context?.contactName || portalContext?.email) {
        return {
            name: portalContext.context?.contactName || portalContext.user?.name || "Portal User",
            email: portalContext.email || "",
        };
    }
    if (window?.portalUser?.email || window?.portalUser?.name) {
        return {
            name: window.portalUser.name || "Portal User",
            email: window.portalUser.email || "",
        };
    }

    const devEmail = getDevImpersonationEmail();
    if (devEmail) {
        return { name: DEV_DEFAULT_NAME, email: devEmail };
    }

    return { name: "Portal User", email: "" };
}


function deriveAssetIds(deal) {
    const raw = deal?.asset_ids || deal?.asset_id || "";
    return Array.from(
        new Set(
            String(raw)
                .split(",")
                .map((id) => id.trim())
                .filter((id) => /^\d+$/.test(id))
        )
    );
}

function valueFor(deal, key) {
    const fallback = {
        property_ref_number: deal?.["Property Ref Number"],
        property_description: deal?.["Property Description"],
        status: deal?.Status,
        amount: deal?.Amount,
        current_balance: deal?.["Current Balance"],
        upsell_available: deal?.["Upsell Available"],
        deal_id: deal?.["Deal_Id"] || deal?.["Deal Id"],
        expectedLodgementDate: deal?.["Expected_Lodgement_Date"],
        seller: deal?.Seller ?? deal?.["Seller"],
    };
    const raw = deal?.[key] ?? fallback[key];
    if (key === "amount" || key === "current_balance" || key === "upsell_available") {
        return formatRand(raw);
    }
    return raw || "—";
}

function AccessibleModal({ open, title, onClose, children, labelledById }) {
    const dialogRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;

        const previouslyFocused = document.activeElement;
        const node = dialogRef.current;
        const focusable = node?.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable?.length) focusable[0].focus();
        function onKeyDown(event) {
            if (event.key === "Escape") {
                onClose();
                return;
            }

            if (event.key !== "Tab" || !focusable?.length) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }

        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.removeEventListener("keydown", onKeyDown);
            if (previouslyFocused && typeof previouslyFocused.focus === "function") {
                previouslyFocused.focus();
            }
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="modal-backdrop" onMouseDown={onClose}>
            <div
                ref={dialogRef}
                className="modal-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledById}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="modal-header">
                    <h3 className="modal-title" id={labelledById}>{title}</h3>
                    <button type="button" className="modal-close" onClick={onClose}>✕</button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
}

export default function ParalegalDashboard() {
    const portalContext = usePortalContext();
    const accountId = portalContext?.context?.accountId || portalContext?.context?.account_id;
    const accountName = portalContext?.context?.accountName || "";
    const canViewFirmDeals = Boolean(portalContext?.context?.canViewFirmDeals);
    const { name: displayName, email: displayEmail } = getPortalUserDisplay(portalContext);

    const [view, setView] = useState("my");
    const [deals, setDeals] = useState([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    const [error, setError] = useState("");
    const [agentReferralOpen, setAgentReferralOpen] = useState(false);
    const [selectedDeal, setSelectedDeal] = useState(null);
    const [transactionsLoading, setTransactionsLoading] = useState(false);
    const [transactionsError, setTransactionsError] = useState("");
    const [transactions, setTransactions] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");



    const storageKey = useMemo(() => {

        const emailKey = (displayEmail || "unknown").toLowerCase();
        return `paralegalDashboardOpenSections:${emailKey}:${view}`;
    }, [displayEmail, view]);

    const [openSections, setOpenSections] = useState(DEFAULT_OPEN_SECTIONS);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                setOpenSections(DEFAULT_OPEN_SECTIONS);
                return;
            }
            setOpenSections({ ...DEFAULT_OPEN_SECTIONS, ...JSON.parse(raw) });
        } catch (error) {
            setOpenSections(DEFAULT_OPEN_SECTIONS);
        }
    }, [storageKey]);



    useEffect(() => {

        try {
            localStorage.setItem(storageKey, JSON.stringify(openSections));
        } catch {
            // ignore
        }
    }, [openSections, storageKey]);

    // `background` refreshes (polling, focus, manual) update the table in place
    // without flipping the whole view back to the "Loading…" state.
    const loadDeals = useCallback(async ({ background = false } = {}) => {
        if (!displayEmail) return;
        try {
            if (background) setRefreshing(true);
            else setLoading(true);
            setError("");
            const data = await fetchFirmDeals({ accountId, fallbackEmail: displayEmail });
            setDeals(data.deals || []);
            setLastUpdated(new Date());
        } catch {
            if (!background) setError("Unable to load deals at the moment.");
        } finally {
            if (background) setRefreshing(false);
            else setLoading(false);
        }
    }, [accountId, displayEmail]);

    // Initial load (and when identity/account resolves). Deals refresh only on
    // this initial load and when the user clicks the Refresh button — there is
    // deliberately no background polling or tab-focus auto-refresh, which was
    // glitchy and could remount the table mid-interaction (e.g. dropping an
    // in-progress document upload).
    useEffect(() => {
        if (!displayEmail || portalContext?.loading || portalContext?.error) return;
        loadDeals();
    }, [displayEmail, portalContext?.loading, portalContext?.error, loadDeals]);

    const visibleDeals = useMemo(() => {
        const portalEmailLower = String(displayEmail || "").toLowerCase();
        const accountIdSafe = String(accountId || "");

        if (view === "firm") {
            return deals.filter((deal) => String(deal.account_id || "") === accountIdSafe);
        }



        return deals.filter(
            (deal) => String(deal.contact_email || "").toLowerCase() === portalEmailLower
        );

    }, [accountId, deals, displayEmail, view]);

    const statusOptions = useMemo(() => {
        const options = new Set();
        visibleDeals.forEach((deal) => {
            const status = String(deal?.status ?? deal?.Status ?? "").trim();
            if (status) options.add(status);
        });
        return Array.from(options).sort((a, b) => a.localeCompare(b));
    }, [visibleDeals]);

    const filteredDeals = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const selectedStatus = statusFilter.trim().toLowerCase();

        return visibleDeals.filter((deal) => {
            const rawStatus = String(deal?.status ?? deal?.Status ?? "").trim();
            if (selectedStatus !== "all" && rawStatus.toLowerCase() !== selectedStatus) {
                return false;
            }

            if (!query) return true;

            const searchCandidates = [
                deal?.property_ref_number,
                deal?.["Property Ref Number"],
                deal?.property_description,
                deal?.["Property Description"],
                rawStatus,
                deal?.seller,
                deal?.Seller,
                deal?.contact_email,
            ];

            return searchCandidates.some((value) => String(value || "").toLowerCase().includes(query));
        });
    }, [searchQuery, statusFilter, visibleDeals]);

    const dealBuckets = useMemo(() => {


        const pending = [];
        const active = [];
        const lodged = [];
        const closed = [];
        const declined = [];
        const other = [];

        for (const deal of filteredDeals) {
            const status = normalizeStatus(deal?.status ?? deal?.Status);
            if (STATUS_BUCKETS.pending.has(status)) pending.push(deal);
            else if (STATUS_BUCKETS.active.has(status)) active.push(deal);
            else if (STATUS_BUCKETS.lodged.has(status)) lodged.push(deal);
            else if (STATUS_BUCKETS.closed.has(status)) closed.push(deal);
            else if (STATUS_BUCKETS.declined.has(status)) declined.push(deal);
            else other.push(deal);
        }

        return { pending, active, lodged, closed, declined, other };
    }, [filteredDeals]);

    const stats = useMemo(() => {
        const total = visibleDeals.length;
        const activeList = visibleDeals.filter((deal) => {
            const status = normalizeStatus(deal?.status ?? deal?.Status);
            return STATUS_BUCKETS.active.has(status) || STATUS_BUCKETS.pending.has(status);
        });
        const currentExposure = visibleDeals.reduce((sum, deal) => {
            const currentBalance = parseNumber(deal.current_balance ?? deal["Current Balance"]);
            return sum + (currentBalance || 0);
        }, 0);
        return { total, activeCount: activeList.length, currentExposure };
    }, [visibleDeals]);

    function clearFilters() {
        setSearchQuery("");
        setStatusFilter("all");
    }

    function handleDealUpdate(updatedDeal) {
        const existingDealId = String(updatedDeal?.deal_id || updatedDeal?.dealId || "");
        if (!existingDealId) return;

        setDeals((prev) =>
            prev.map((deal) => {
                const currentDealId = String(deal?.deal_id || deal?.dealId || "");
                return currentDealId === existingDealId ? { ...deal, ...updatedDeal } : deal;
            })
        );

        setSelectedDeal((prev) => {
            if (!prev) return prev;
            const selectedDealId = String(prev?.deal_id || prev?.dealId || "");
            return selectedDealId === existingDealId ? { ...prev, ...updatedDeal } : prev;
        });
    }


    async function openDealDetails(deal) {
        setSelectedDeal(deal);
        setTransactions([]);
        setTransactionsError("");

        const assetIds = deriveAssetIds(deal);
        // Pending (not-yet-synced) deals aren't authorized for transaction lookups
        // and may not have transactions yet; show the deal fields without them.
        if (deal?.source === "crm_pending" || !assetIds.length || !displayEmail) {
            setTransactions([]);
            return;
        }

        try {
            setTransactionsLoading(true);
            const response = await fetchDealTransactions({
                assetIds: assetIds.join(","),
                email: displayEmail,
            });
            setTransactions(response.transactions || []);
        } catch {
            setTransactionsError("Unable to load transactions for this deal.");
        } finally {
            setTransactionsLoading(false);
        }
    }

    function DealsTable({ sectionKey, title, sectionDeals, defaultOpen = true }) {
        const isOpen = openSections[sectionKey] ?? defaultOpen;

        return (
            <section className="dashboard-table-section">
                <div className="section-header collapsible" role="button" tabIndex={0} onClick={() => setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}>
                    <div className="section-title-row">
                        <h2 className="section-title">{title}</h2>
                        <span className="section-count-pill">{sectionDeals.length}</span>
                    </div>

                    <button type="button" className="collapse-button" onClick={(event) => { event.stopPropagation(); setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] })); }}>
                        {isOpen ? "Hide" : "Show"}
                    </button>
                </div>

                {isOpen && (
                    <>
                        {sectionDeals.length === 0 ? (
                            <div className="dashboard-message">No deals in this category.</div>
                        ) : (
                            <div className="deals-table-wrapper">
                                <table className="deals-table">
                                    <thead>
                                        <tr>
                                            <th className="col-priority-high sticky-first-col col-ref">Property Ref Number</th>
                                            <th className="col-priority-medium col-description">Property Description</th>
                                            <th className="col-priority-high">Status</th>
                                            <th className="col-priority-high">Advanced</th>
                                            <th className="col-priority-high">Current Balance</th>
                                            <th className="col-priority-medium">Upsell Available</th>
                                            <th className="col-priority-medium">Created</th>
                                            <th className="actions-cell actions-header">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sectionDeals.map((deal, index) => (
                                            <tr
                                                key={deal.id || deal.deal_id || index}
                                                className="deals-row"
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => openDealDetails(deal)}
                                                onKeyDown={(event) => {
                                                    const tagName = String(event.target?.tagName || "").toLowerCase();
                                                    const isInteractive =
                                                        ["input", "textarea", "select", "button"].includes(tagName) ||
                                                        Boolean(event.target?.closest?.("a,button,input,textarea,select,[contenteditable= true]"));

                                                    if (isInteractive) return;

                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.preventDefault();
                                                        openDealDetails(deal);
                                                    }
                                                }}
                                            >
                                                <td className="col-priority-high sticky-first-col col-ref" title={valueFor(deal, "property_ref_number")}>{valueFor(deal, "property_ref_number")}</td>
                                                <td className="col-priority-medium col-description" title={valueFor(deal, "property_description")}>{valueFor(deal, "property_description")}</td>
                                                <td className="col-priority-high" title={valueFor(deal, "status")}>{valueFor(deal, "status")}</td>
                                                <td className="col-priority-high" title={valueFor(deal, "amount")}>{valueFor(deal, "amount")}</td>
                                                <td className="col-priority-high" title={valueFor(deal, "current_balance")}>{valueFor(deal, "current_balance")}</td>
                                                <td className="col-priority-medium" title={valueFor(deal, "upsell_available")}>{valueFor(deal, "upsell_available")}</td>
                                                <td className="col-priority-medium" title={valueFor(deal, "created_time")}>{valueFor(deal, "created_time")}</td>
                                                <td className="actions-cell" onClick={(event) => event.stopPropagation()}>
                                                    {deal.source === "crm_pending" ? (
                                                        <span className="subtle" title="This deal was just submitted and is still being processed. Actions become available once it finishes syncing.">Processing…</span>
                                                    ) : (
                                                        <DealActions
                                                            deal={deal}
                                                            portalEmail={displayEmail}
                                                            accountId={accountId}
                                                            onDealUpdate={handleDealUpdate}
                                                        />
                                                    )}
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



    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <div>
                    <h1 className="dashboard-title">My Bridging Deals</h1>
                    <p className="dashboard-subtitle">View your live matters and your pipeline at a glance.</p>
                    {accountName && <div className="dashboard-subtitle subtle">Firm: {accountName}</div>}
                </div>
                <div className="dashboard-user-pill">
                    <span className="user-name">{displayName}</span>
                    <span className="user-email">{displayEmail}</span>
                </div>
            </header>

            <div className="dashboard-actions">
                <div className="card action-card"><h3>Quick Bridge Application</h3><p className="subtle">Start a new application with your firm’s preferred Quick Bridge bank details.</p><Link className="button accent" to="/quick-rates">Start Quick Bridge Application</Link></div>
                <div className="card action-card"><h3>Seller Application</h3><p className="subtle">Create a seller proceeds request and keep your pipeline moving.</p><Link className="button accent" to="/seller-proceeds">Start Seller Application</Link></div>
                <div className="card action-card"><h3>Agent Referral</h3><p className="subtle">Refer an estate agent by completing a quick referral form.</p><button className="button accent" type="button" onClick={() => setAgentReferralOpen(true)}>Open Agent Referral Form</button></div>
                <div className="card action-card"><h3>Generate Quote</h3><p className="subtle">Create and prepare a preliminary quotation.</p><a className="button accent" href="https://zfrmz.com/0AxyGWsAOSyjhYL7fpRf" target="_blank" rel="noopener noreferrer">Generate Quote</a></div>
            </div>






            {canViewFirmDeals && (
                <div className="dashboard-toggle">
                    <button type="button" className={`toggle-button ${view === "my" ? "active" : ""}`} onClick={() => setView("my")}>My Deals</button>
                    <button type="button" className={`toggle-button ${view === "firm" ? "active" : ""}`} onClick={() => setView("firm")}>Firm Deals</button>
                </div>
            )}

            <section className="dashboard-stats">
                <div className="stat-card"><div className="stat-label">Total Number of Deals</div><div className="stat-value">{stats.total}</div></div>
                <div className="stat-card"><div className="stat-label">Active</div><div className="stat-value">{stats.activeCount}</div></div>
                <div className="stat-card"><div className="stat-label">Current Exposure</div><div className="stat-value">{new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(stats.currentExposure)}</div></div>
            </section>

            <section className="dashboard-table-section">
                <div className="section-header">
                    <h2 className="section-title">{view === "my" ? "My Deals" : "Firm Deals"}</h2>
                    <p className="section-subtitle">View & Update Deals, Generate Statements and Upload Documents</p>
                </div>

                <div className="table-filter-bar">
                    <input
                        type="search"
                        className="table-filter-input"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search Property Ref, Description, Status, Seller..."
                        aria-label="Search deals"
                    />
                    <select
                        className="table-filter-select"
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value)}
                        aria-label="Filter deals by status"
                    >
                        <option value="all">All statuses</option>
                        {statusOptions.map((status) => (
                            <option key={status} value={status.toLowerCase()}>{status}</option>
                        ))}
                    </select>
                    <button type="button" className="table-filter-clear" onClick={clearFilters}>Clear filters</button>
                    <button type="button" className="table-filter-clear" onClick={() => loadDeals({ background: true })} disabled={refreshing}>
                        {refreshing ? "Refreshing…" : "Refresh"}
                    </button>
                    {lastUpdated && (
                        <span className="subtle" style={{ alignSelf: "center", fontSize: "0.8rem" }}>
                            Updated {lastUpdated.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                    )}
                </div>

                {loading && <div className="dashboard-message">Loading deals…</div>}
                {error && !loading && <div className="dashboard-message error">{error}</div>}

                {!loading && !error && (
                    <>
                        <DealsTable sectionKey="pending" title="Pending Review" sectionDeals={dealBuckets.pending} />
                        <DealsTable sectionKey="active" title="Active" sectionDeals={dealBuckets.active} />
                        <DealsTable sectionKey="lodged" title="Lodged" sectionDeals={dealBuckets.lodged} />
                        <DealsTable sectionKey="closed" title="Closed" sectionDeals={dealBuckets.closed} />
                        <DealsTable sectionKey="declined" title="Declined" sectionDeals={dealBuckets.declined} />
                        {dealBuckets.other.length > 0 && <DealsTable sectionKey="other" title="Other" sectionDeals={dealBuckets.other} />}
                    </>
                )}
            </section>

            <AccessibleModal open={agentReferralOpen} title="Agent Referral" onClose={() => setAgentReferralOpen(false)} labelledById="agent-referral-title">
                <iframe title="Agent Referral Form" src="https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalAgentReferral/formperma/vy5_daSg6FwbRsmMOBjXm9Gly6_KX-TagvXtnkBsFNk" className="modal-iframe" frameBorder="0" />
            </AccessibleModal>

            <AccessibleModal
                open={Boolean(selectedDeal)}
                title="Deal Details"
                onClose={() => setSelectedDeal(null)}
                labelledById="deal-details-title"
            >
                {selectedDeal && (
                    <div className="deal-detail-modal-content">
                        <div className="deal-detail-grid">
                            {DEAL_DETAIL_FIELDS.map(([label, key]) => (
                                <div key={key} className="deal-detail-item">
                                    <div className="deal-detail-label">{label}</div>
                                    <div className="deal-detail-value" title={valueFor(selectedDeal, key)}>{valueFor(selectedDeal, key)}</div>
                                </div>
                            ))}
                        </div>


                        <div className="deal-transactions-section">
                            <h4>Transactions ({transactions.length})</h4>
                            {transactionsLoading && <p>Loading transactions…</p>}
                            {transactionsError && !transactionsLoading && <p className="error">{transactionsError}</p>}
                            {!transactionsLoading && !transactionsError && transactions.length === 0 && <p>No transactions found</p>}
                            {!transactionsLoading && !transactionsError && transactions.length > 0 && (
                                <table className="transactions-table">
                                    <thead>
                                        <tr>
                                            <th>Transaction Name</th>
                                            <th>Transaction Type</th>
                                            <th>Advance Amount</th>
                                            <th>Paid Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transactions.map((transaction) => (
                                            <tr key={transaction.id}>
                                                <td>{transaction.name || "—"}</td>
                                                <td>{transaction.type || "—"}</td>
                                                <td>{formatRand(transaction.advance_amount)}</td>
                                                <td>{formatDate(transaction.paid_date)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                )}
            </AccessibleModal>
        </div>
    );
}
