import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePortalContext } from "../../PortalContext";
import { fetchDealTransactions, fetchFirmDeals } from "../../services/portalApi";
import DealActions from "./components/DealActions";
import "./ParalegalDashboard.css";


const DEV_DEFAULT_EMAIL = "paralegal.sandbox@lawfirm.co.za";
const DEV_DEFAULT_NAME = "Sandbox Paralegal";
const DEFAULT_OPEN_SECTIONS = { pending: true, active: true, closed: false, other: false };
const STATUS_BUCKETS = {
    pending: new Set(["pending review"]),
    active: new Set(["active", "due to taurus"]),
    closed: new Set(["closed", "declined"]),
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

    if (process.env.NODE_ENV === "development") {

        return { name: DEV_DEFAULT_NAME, email: DEV_DEFAULT_EMAIL };
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

    const [error, setError] = useState("");
    const [agentReferralOpen, setAgentReferralOpen] = useState(false);
    const [selectedDeal, setSelectedDeal] = useState(null);
    const [transactionsLoading, setTransactionsLoading] = useState(false);
    const [transactionsError, setTransactionsError] = useState("");
    const [transactions, setTransactions] = useState([]);



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

    useEffect(() => {
        if (!displayEmail) return;

        async function loadDeals() {
            try {
                setLoading(true);
                setError("");
                const data = await fetchFirmDeals({ accountId, fallbackEmail: displayEmail });
                setDeals(data.deals || []);
            } catch {
                setError("Unable to load deals at the moment.");
            } finally {
                setLoading(false);
            }
        }

        loadDeals();
    }, [accountId, displayEmail]);

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


    const dealBuckets = useMemo(() => {


        const pending = [];
        const active = [];
        const closed = [];
        const other = [];

        for (const deal of visibleDeals) {
            const status = normalizeStatus(deal?.status ?? deal?.Status);
            if (STATUS_BUCKETS.pending.has(status)) pending.push(deal);
            else if (STATUS_BUCKETS.active.has(status)) active.push(deal);
            else if (STATUS_BUCKETS.closed.has(status)) closed.push(deal);
            else other.push(deal);
        }

        return { pending, active, closed, other };
    }, [visibleDeals]);

    const stats = useMemo(() => {
        const total = visibleDeals.length;
        const activeList = visibleDeals.filter((deal) => {
            const status = normalizeStatus(deal?.status ?? deal?.Status);
            return STATUS_BUCKETS.active.has(status) || STATUS_BUCKETS.pending.has(status);
        });
        const totalAmount = activeList.reduce((sum, deal) => sum + (parseNumber(deal.amount) || 0), 0);
        return { total, activeCount: activeList.length, totalAmount };
    }, [visibleDeals]);

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
        if (!assetIds.length || !displayEmail) {
            setTransactions([]);
            return;
        }

        try {
            setTransactionsLoading(true);
            const response = await fetchDealTransactions({
                email: displayEmail,
                assetIds: assetIds.join(","),
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
                                                    <DealActions
                                                        deal={deal}
                                                        portalEmail={displayEmail}
                                                        accountId={accountId}
                                                        onDealUpdate={handleDealUpdate}
                                                    />
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
                    <p className="dashboard-subtitle">View your live matters and your firm’s pipeline at a glance.</p>
                    {accountName && <div className="dashboard-subtitle subtle">Firm: {accountName}</div>}
                </div>
                <div className="dashboard-user-pill">
                    <span className="user-name">{displayName}</span>
                    <span className="user-email">{displayEmail}</span>
                </div>
            </header>

            <div className="dashboard-actions">
                <div className="card action-card"><h3>Quick Bridge Application</h3><p className="subtle">Start a new request with your firm’s preferred quick rates bank details.</p><Link className="button" to="/quick-rates">Start Quick Bridge Application</Link></div>
                <div className="card action-card"><h3>Seller Application</h3><p className="subtle">Create a seller proceeds request and keep your pipeline moving.</p><Link className="button" to="/seller-proceeds">Start Seller Application</Link></div>
                <div className="card action-card"><h3>Agent Referral</h3><p className="subtle">Refer an estate agent deal by completing a quick referral form.</p><button className="button" type="button" onClick={() => setAgentReferralOpen(true)}>Open Agent Referral Form</button></div>
            </div>






            {canViewFirmDeals && (
                <div className="dashboard-toggle">
                    <button type="button" className={`toggle-button ${view === "my" ? "active" : ""}`} onClick={() => setView("my")}>My Deals</button>
                    <button type="button" className={`toggle-button ${view === "firm" ? "active" : ""}`} onClick={() => setView("firm")}>Firm Deals</button>
                </div>
            )}

            <section className="dashboard-stats">
                <div className="stat-card"><div className="stat-label">Deals in view</div><div className="stat-value">{stats.total}</div></div>
                <div className="stat-card"><div className="stat-label">Active / In-Process</div><div className="stat-value">{stats.activeCount}</div></div>
                <div className="stat-card"><div className="stat-label">Total Amount</div><div className="stat-value">R {stats.totalAmount.toLocaleString("en-ZA")}</div></div>
            </section>

            <section className="dashboard-table-section">
                <div className="section-header">
                    <h2 className="section-title">{view === "my" ? "My Deals" : "Firm Deals"}</h2>
                    <p className="section-subtitle">View Deal Details, Generate Statements and Upload Documents</p>
                </div>

                {loading && <div className="dashboard-message">Loading deals…</div>}
                {error && !loading && <div className="dashboard-message error">{error}</div>}

                {!loading && !error && (
                    <>
                        <DealsTable sectionKey="pending" title="Pending Review" sectionDeals={dealBuckets.pending} />
                        <DealsTable sectionKey="active" title="Active / Due to Taurus" sectionDeals={dealBuckets.active} />
                        <DealsTable sectionKey="closed" title="Closed / Declined" sectionDeals={dealBuckets.closed} />
                        {dealBuckets.other.length > 0 && <DealsTable sectionKey="other" title="Other" sectionDeals={dealBuckets.other} />}
                    </>
                )}
            </section>

            <AccessibleModal open={agentReferralOpen} title="Agent Referral" onClose={() => setAgentReferralOpen(false)} labelledById="agent-referral-title">
                <iframe title="Agent Referral Form" src="https://zfrmz.com/TT8sluE728L5jNprA15m" className="modal-iframe" frameBorder="0" />
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
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transactions.map((transaction) => (
                                            <tr key={transaction.id}>
                                                <td>{transaction.name || "—"}</td>
                                                <td>{transaction.type || "—"}</td>
                                                <td>{formatRand(transaction.advance_amount)}</td>
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
