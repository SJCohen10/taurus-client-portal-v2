import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
    generateStatement,
    uploadDealDocument,
    fetchBankDetailsForAccount,
    createNote,
    updateExpectedLodgementDate,
    listNotifications,
    markNotificationRead,

} from "../../../services/portalApi";
import "./DealActionsModal.css";

import { usePortalContext } from "../../../PortalContext";

const SELLER_READVANCE_FORM_URL =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalSellerBridgingApplication/formperma/wBiblctfbTBce_jInGEmX_JbaXdWWg5es95hjlEKdx4";

const ADD_BANK_DETAIL_FORM_URL =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalAddBankDetail/formperma/sMwZkmaaClPpGJ9uLA_jm59z-DBs-l4LoPpWSA3UBr4";

const INITIAL_OR_FURTHER_ADVANCE_ALIAS = "Initial_Advance_Further_Advance";

function normalizeDateValue(value) {
    if (!value) return "";
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
}

function hasExpectedLodgementAttention(deal) {
    const expectedDate = normalizeDateValue(deal?.expectedLodgementDate);
    if (!expectedDate) return false;
    const status = String(deal?.status || deal?.Status || "").trim().toLowerCase();
    if (["closed", "declined", "registered"].includes(status)) return false;
    const today = new Date();
    const todayIso = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
        .toISOString()
        .slice(0, 10);
    return todayIso > expectedDate;
}

function resolveNotificationId(notification) {
    if (!notification || typeof notification !== "object") return "";

    return String(
        notification.id ||
        notification.ID ||
        notification.ROWID ||
        notification.rowid ||
        ""
    ).trim();
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result || "";
            const base64 = String(result).split(",")[1] || "";
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export default function DealActions({ deal, portalEmail, accountId, onDealUpdate, onOpenExpectedLodgementDate }) {

    const portal = usePortalContext();
    const crm = portal?.context || null;

    // Firm bank defaults (same logic as SellerProceedsAdvance)
    const firmBankOptions = crm?.bankDetails || [];
    const defaultFirmBankId =
        crm?.defaultBankDetailId || (firmBankOptions[0]?.id || "");

    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [uploading, setUploading] = useState(false);
    const [statementLoading, setStatementLoading] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
    const buttonRef = useRef(null);
    // Readvance flow state
    const [readvanceChooserOpen, setReadvanceChooserOpen] = useState(false);
    const [sellerReadvanceOpen, setSellerReadvanceOpen] = useState(false);

    const [partyReceiving, setPartyReceiving] = useState("Conveyancing Firm");
    const [totalAmount, setTotalAmount] = useState("");
    const [amountToFirm, setAmountToFirm] = useState("");
    const [amountToNominated, setAmountToNominated] = useState("");

    const [selectedFirmBankId, setSelectedFirmBankId] = useState(defaultFirmBankId);

    const [sellerBankLoading, setSellerBankLoading] = useState(false);
    const [sellerBankOptions, setSellerBankOptions] = useState([]);
    const [selectedSellerBankId, setSelectedSellerBankId] = useState("");

    const [readvanceError, setReadvanceError] = useState("");
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteContent, setNoteContent] = useState("");
    const [noteSaving, setNoteSaving] = useState(false);
    const [noteError, setNoteError] = useState("");
    const [expectedLodgementOpen, setExpectedLodgementOpen] = useState(false);
    const [expectedLodgementDate, setExpectedLodgementDate] = useState(normalizeDateValue(deal?.expectedLodgementDate));
    const [expectedLodgementSaving, setExpectedLodgementSaving] = useState(false);
    const [expectedLodgementError, setExpectedLodgementError] = useState("");
    const [notificationOpen, setNotificationOpen] = useState(false);


    const [persistedNotifications, setPersistedNotifications] = useState([]);
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const [notificationsError, setNotificationsError] = useState("");
    const [notificationPopoverPos, setNotificationPopoverPos] = useState({ top: 0, left: 0 });

    const rootRef = useRef(null);
    const menuRef = useRef(null);
    const fileInputRef = useRef(null);
    const notificationButtonRef = useRef(null);

    const propertyRefNumber =
        deal.property_ref_number ||
        deal.matter_name ||
        deal.deal_ref ||
        deal["Property Ref Number"] ||
        "";

    const propertyDescription =
        deal.property_description || deal["Property Description"] || "";

    const sellerAccountId =
        deal.seller_account_id ||
        deal["Seller_Account_Id"] ||
        null;


    const assetIdsRaw = deal["Asset IDs"] || deal.asset_ids || deal.assetIds || null;
    const assetIds = String(assetIdsRaw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const propertyFolderId = deal.property_folder_id || deal["Property Folder Id"] || null;
    const dealId =
        deal.deal_id ||
        deal.dealId ||
        deal["Deal_Id"] ||
        deal["Deal Id"] ||
        deal.id ||
        deal["Id"] ||
        null;


    // Close popup on outside click / ESC
    useEffect(() => {
        function onDocClick(e) {
            const inRoot = rootRef.current?.contains(e.target);
            const inMenu = menuRef.current?.contains(e.target);

            if (!inRoot && !inMenu) {
                setOpen(false);
                setNotificationOpen(false);
            }
        }


        function onEsc(e) {
            if (e.key === "Escape") setOpen(false);
        }

        document.addEventListener("click", onDocClick);     // ✅ click (not mousedown)
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("click", onDocClick);
            document.removeEventListener("keydown", onEsc);
        };
    }, []);

    useEffect(() => {
        setSelectedFirmBankId((prev) => prev || defaultFirmBankId);
    }, [defaultFirmBankId]);

    useEffect(() => {
        setExpectedLodgementDate(normalizeDateValue(deal?.expectedLodgementDate));
    }, [deal?.expectedLodgementDate]);


    async function handleFileChange(event) {
        event.stopPropagation();
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setUploading(true);
            setMessage("");

            const base64Data = await readFileAsBase64(file);

            const payload = {
                fileName: file.name,
                mimeType: file.type,
                fileBase64: base64Data,
                propertyRefNumber,
                propertyDescription,
                accountId,
                contactEmail: portalEmail,
                propertyFolderId,
                dealId,
            };

            const response = await uploadDealDocument(payload);
            setMessage(
                response?.message ||
                "Uploaded to WorkDrive. You can find it in the property folder."
            );
            setOpen(false);
        } catch (err) {
            console.error("Document upload failed", err);
            setMessage(err.message || "Unable to upload document right now.");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    async function handleGenerateStatement(event) {
        event.stopPropagation();

        if (!assetIds.length) {
            setMessage("No Assets are linked to this deal yet.");
            return;
        }

        try {
            setStatementLoading(true);
            setMessage("");

            const targetIds = assetIds; // generate ALL assets

            const results = [];
            for (const id of targetIds) {
                const response = await generateStatement({ assetId: id });
                results.push({ assetId: id, response });

                if (response?.statementUrl) {
                    window.open(response.statementUrl, "_blank", "noopener");
                }
            }

            const openedCount = results.filter((r) => r.response?.statementUrl).length;

            setMessage(
                openedCount
                    ? `Opened ${openedCount} statement(s) in new tabs.`
                    : "No statement page was returned for the selected assets."
            );
            setOpen(false);
        } catch (err) {
            console.error("Generate statement failed", err);
            setMessage(err.message || "Unable to generate a statement right now.");
        } finally {
            setStatementLoading(false);
        }
    }

    async function loadSellerBanks() {
        setSellerBankLoading(true);
        setReadvanceError("");

        try {
            if (!sellerAccountId) {
                setSellerBankOptions([]);
                setSelectedSellerBankId("");
                setReadvanceError("This deal has no Seller Account linked.");
                return;
            }

            const resp = await fetchBankDetailsForAccount({
                accountId: sellerAccountId,
                avsOnly: false, // sellers do not require AVS
            });

            const list = resp?.bankDetails || [];
            setSellerBankOptions(list);

            setSelectedSellerBankId((prev) => {
                if (prev && list.some((b) => b.id === prev)) return prev;
                return list[0]?.id || "";
            });
        } catch (err) {
            setReadvanceError(err.message || "Unable to load seller bank details.");
            setSellerBankOptions([]);
            setSelectedSellerBankId("");
        } finally {
            setSellerBankLoading(false);
        }
    }


    function handleReadvance(event) {
        event.stopPropagation();
        setOpen(false);
        setReadvanceChooserOpen(true);
    }

    function buildZohoFormUrl(baseUrl, params) {
        const url = new URL(baseUrl);
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v === undefined || v === null) return;
            const s = String(v);
            if (!s) return;
            url.searchParams.set(k, s);
        });
        return url.toString();
    }

    function openExternalUrl(url) {
        window.open(url, "_blank", "noopener,noreferrer");
    }

    const parsedTotalAmount = Number(totalAmount || 0);
    const parsedAmountToFirm = Number(amountToFirm || 0);
    const parsedAmountToNominated = Number(amountToNominated || 0);

    const requiresFirmBank =
        partyReceiving === "Conveyancing Firm" ||
        partyReceiving === "Split Between Firm and Seller";

    const requiresSellerBank =
        partyReceiving === "Seller / Nominated Account" ||
        partyReceiving === "Split Between Firm and Seller";

    const validTotalAmount = Number.isFinite(parsedTotalAmount) && parsedTotalAmount > 0;

    const canOpenReadvanceForm =
        validTotalAmount &&
        (!requiresFirmBank || Boolean(selectedFirmBankId)) &&
        (!requiresSellerBank || Boolean(selectedSellerBankId)) &&
        (partyReceiving !== "Split Between Firm and Seller" ||
            (Math.abs(parsedAmountToFirm + parsedAmountToNominated - parsedTotalAmount) < 0.01));


    function resolveNoteTarget() {
        const resolvedDealId = deal.deal_id || deal["Deal_Id"] || deal["Deal Id"] || null;
        if (resolvedDealId) {
            return { recordType: "Deal", recordId: String(resolvedDealId) };
        }

        const fallbackAssetId = assetIds[0] || deal.asset_id || null;
        if (fallbackAssetId) {
            return { recordType: "Asset", recordId: String(fallbackAssetId) };
        }

        return null;
    }


    function openExpectedLodgementModal() {
        setExpectedLodgementError("");
        setExpectedLodgementDate(normalizeDateValue(deal?.expectedLodgementDate));
        setExpectedLodgementOpen(true);
        setOpen(false);
        setNotificationOpen(false);
        if (onOpenExpectedLodgementDate) {
            onOpenExpectedLodgementDate();
        }
    }

    async function handleExpectedLodgementSave(event) {
        event.stopPropagation();

        const selectedDate = normalizeDateValue(expectedLodgementDate);
        if (!selectedDate) {
            setExpectedLodgementError("Please select a valid date in YYYY-MM-DD format.");
            return;
        }

        if (!portalEmail) {
            setExpectedLodgementError("Missing portal user email.");
            return;
        }

        if (!/^\d+$/.test(String(dealId || ""))) {
            setExpectedLodgementError("No CRM deal id is available for this row.");
            return;
        }

        try {
            setExpectedLodgementSaving(true);
            setExpectedLodgementError("");
            await updateExpectedLodgementDate({
                email: portalEmail,
                dealId: String(dealId),
                expectedLodgementDate: selectedDate,
            });
            if (onDealUpdate) {
                onDealUpdate({ ...deal, expectedLodgementDate: selectedDate });
            }
            setExpectedLodgementOpen(false);
            setMessage("Expected Lodgement Date updated.");
        } catch (error) {
            setExpectedLodgementError(error.message || "Unable to update Expected Lodgement Date.");
        } finally {
            setExpectedLodgementSaving(false);
        }
    }

    const needsExpectedLodgementAttention = hasExpectedLodgementAttention(deal);

    const computedNotifications = needsExpectedLodgementAttention
        ? [
            {
                id: "expected-lodgement-overdue",
                message: "Expected Lodgement Date has passed. Please update it.",
                source: "computed",
            },
        ]
        : [];

    const mergedNotifications = [
        ...(Array.isArray(persistedNotifications)
            ? persistedNotifications.map((n) => ({ ...n, source: "persisted" }))
            : []),
        ...computedNotifications,
    ];

    const notificationCount = mergedNotifications.length;

    async function fetchPersistedNotifications({ showLoading = false, suppressError = false } = {}) {
        const resolvedDealId = String(dealId || "").trim();
        if (!resolvedDealId) {
            setPersistedNotifications([]);
            return;
        }

        try {
            if (showLoading) setNotificationsLoading(true);
            const resp = await listNotifications({
                email: portalEmail,
                dealId: resolvedDealId,
            });
            const fetchedNotifications = Array.isArray(resp?.notifications) ? resp.notifications : [];
            setPersistedNotifications(fetchedNotifications);
        } catch (err) {
            console.error("[DealActions] Notifications fetch failure", err);
            if (!suppressError) {
                setNotificationsError(err?.message || "Unable to load notifications right now.");
            }
            setPersistedNotifications([]);
        } finally {
            if (showLoading) setNotificationsLoading(false);
        }
    }


    async function handleSaveNote(event) {
        event.stopPropagation();

        const trimmed = noteContent.trim();
        if (!trimmed) {
            setNoteError("Note content is required.");
            return;
        }

        if (trimmed.length > 5000) {
            setNoteError("Note content cannot exceed 5000 characters.");
            return;
        }

        const target = resolveNoteTarget();
        if (!target) {
            setNoteError("No Deal or Asset id is available for this row.");
            return;
        }

        try {
            setNoteSaving(true);
            setNoteError("");
            await createNote({
                email: portalEmail,
                recordType: target.recordType,
                recordId: target.recordId,
                content: trimmed,
            });
            setMessage("Note added successfully.");
            setNoteOpen(false);
            setNoteContent("");
            setOpen(false);
        } catch (error) {
            setNoteError(error.message || "Unable to save note.");
        } finally {
            setNoteSaving(false);
        }
    }

    function handleNotificationClick(notification) {
        if (!notification) return;

        // your computed notification
        if (notification.id === "expected-lodgement-overdue") {
            openExpectedLodgementModal();
            return;
        }

        // future persisted types
        if (notification.type === "UPDATE_EXPECTED_LODGEMENT_DATE") {
            openExpectedLodgementModal();
            return;
        }

        // fallback: open note with message
        setNotificationOpen(false);
        setNoteError("");
        setNoteContent(notification.message || "");
        setNoteOpen(true);
    }



    return (
        <div
            ref={rootRef}
            className="deal-actions"
            onClick={(e) => e.stopPropagation()}

        >
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleFileChange}
            />

            <button
                type="button"
                className={`deal-notification-button ${notificationCount > 0 ? "active" : ""}`}
                aria-label={`Deal notifications (${notificationCount})`}
                title={notificationCount > 0 ? `${notificationCount} pending notification${notificationCount > 1 ? "s" : ""}` : "No pending notifications"}
                ref={notificationButtonRef}
                onClick={async (e) => {
                    e.stopPropagation();
                    const nextOpen = !notificationOpen;
                    setNotificationOpen(nextOpen);
                    if (!nextOpen) return;

                    const bellRect = notificationButtonRef.current?.getBoundingClientRect();
                    if (bellRect) {
                        setNotificationPopoverPos({
                            top: bellRect.bottom + 8,
                            left: Math.max(12, bellRect.right - 260),
                        });
                    }

                    setNotificationsError("");


                    const resolvedDealId = String(dealId || "").trim();
                    if (!resolvedDealId) {
                        // Root cause identified: some rows do not carry a deal id, so API fetch cannot run.
                        // Keep the popover open anyway and fall back to the explicit empty-state message.
                        return;
                    }

                    await fetchPersistedNotifications({ showLoading: true });
                }}

            >
                🔔 {notificationCount > 0 ? `(${notificationCount})` : ""}
            </button>

            <button
                type="button"
                className="deal-action-button"
                onClick={() => {
                    const next = !open;
                    setOpen(next);

                    if (next && buttonRef.current) {
                        const rect = buttonRef.current.getBoundingClientRect();
                        setMenuPos({
                            top: rect.bottom + 8 + window.scrollY,
                            left: rect.right - 220 + window.scrollX, // 220 = menu width (adjust if you want)
                            width: rect.width,
                        });
                    }
                }}
                ref={buttonRef}

                aria-haspopup="menu"
                aria-expanded={open ? "true" : "false"}
            >
                Actions ▾
            </button>

            {open &&
                ReactDOM.createPortal(
                    <div
                        ref={menuRef}
                        className="deal-actions-menu-portal"
                        role="menu"
                        style={{
                            position: "absolute",
                            top: menuPos.top,
                            left: menuPos.left,
                            width: 220,
                            background: "#fff",
                            border: "1px solid rgba(0,0,0,0.12)",
                            borderRadius: 12,
                            padding: 8,
                            boxShadow: "0 14px 40px rgba(0,0,0,0.18)",
                            zIndex: 9999,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="deal-actions-menu-item"
                            role="menuitem"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 10px",
                                borderRadius: 10,
                                border: "none",
                                background: "transparent",
                                cursor: uploading ? "not-allowed" : "pointer",
                            }}
                        >
                            {uploading ? "Uploading…" : "Upload Document"}
                        </button>

                        <button
                            type="button"
                            className="deal-actions-menu-item"
                            role="menuitem"
                            onClick={handleGenerateStatement}
                            disabled={!assetIds.length || statementLoading}
                            title={assetIds.length ? "Generate statement" : "No Asset IDs available"}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 10px",
                                borderRadius: 10,
                                border: "none",
                                background: "transparent",
                                cursor:
                                    !assetIds.length || statementLoading ? "not-allowed" : "pointer",
                                opacity: !assetIds.length || statementLoading ? 0.6 : 1,
                            }}
                        >
                            {statementLoading ? "Preparing…" : "Generate Statement"}
                        </button>


                        <button
                            type="button"
                            className="deal-actions-menu-item"
                            role="menuitem"
                            onClick={(event) => {
                                event.stopPropagation();
                                openExpectedLodgementModal();
                            }}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 10px",
                                borderRadius: 10,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                            }}
                        >
                            Update Expected Lodgement Date
                        </button>

                        <button
                            type="button"
                            className="deal-actions-menu-item"
                            role="menuitem"
                            onClick={(event) => {
                                event.stopPropagation();
                                setNoteError("");
                                setNoteOpen(true);
                                setOpen(false);
                            }}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 10px",
                                borderRadius: 10,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                            }}
                        >
                            Add Note
                        </button>


                        <button
                            type="button"
                            className="deal-actions-menu-item"
                            role="menuitem"
                            onClick={handleReadvance}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 10px",
                                borderRadius: 10,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                            }}
                        >
                            Readvance
                        </button>
                    </div>,
                    document.body
                )}

            {notificationOpen && (
                <div
                    className="deal-notification-popover"
                    onClick={(event) => event.stopPropagation()}
                    style={{
                        position: "fixed",
                        top: notificationPopoverPos.top,
                        left: notificationPopoverPos.left,
                        right: "auto",
                    }}
                >
                    {notificationsLoading ? (
                        <p>Loading notifications…</p>
                    ) : notificationsError ? (
                        <p>{notificationsError}</p>
                    ) : notificationCount > 0 ? (
                        <>
                            {mergedNotifications.map((n) => {
                                const notificationId = resolveNotificationId(n);
                                const notificationKey = notificationId || String(n.message || n.type || "notification");

                                return (
                                    <button
                                        key={notificationKey}
                                        type="button"
                                        className="deal-notification-item"
                                        onClick={async (e) => {
                                            e.stopPropagation();

                                            if (n.source === "persisted" && notificationId) {
                                                try {
                                                    await markNotificationRead({ id: notificationId, email: portalEmail });
                                                    setPersistedNotifications((prev) =>
                                                        prev.filter((x) => resolveNotificationId(x) !== notificationId)
                                                    );
                                                } catch (err) {
                                                    console.warn("Failed to mark notification read", err);
                                                }
                                            } else if (n.source === "persisted") {
                                                console.warn("Skipping mark read: persisted notification has no id", n);
                                            }

                                            handleNotificationClick(n);
                                        }}
                                    >
                                        {n.message}
                                    </button>
                                );
                            })}
                        </>
                    ) : (
                        <p>No notifications for this deal.</p>
                    )}
                </div>
            )}



            {expectedLodgementOpen && (
                <div className="modal-backdrop" onClick={() => setExpectedLodgementOpen(false)}>
                    <div className="readvance-modal expected-date-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="readvance-modal-header">
                            <h3>Update Expected Lodgement Date</h3>
                        </div>
                        <label>
                            Expected Lodgement Date
                            <input
                                type="date"
                                value={expectedLodgementDate}
                                onChange={(event) => setExpectedLodgementDate(event.target.value)}
                                max="9999-12-31"
                            />
                        </label>
                        {expectedLodgementError && <p className="error">{expectedLodgementError}</p>}
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button type="button" className="button" onClick={handleExpectedLodgementSave} disabled={expectedLodgementSaving}>
                                {expectedLodgementSaving ? "Saving…" : "Save"}
                            </button>
                            <button type="button" className="button" onClick={() => setExpectedLodgementOpen(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {noteOpen && (
                <div className="modal-backdrop" onClick={() => setNoteOpen(false)}>
                    <div className="readvance-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="readvance-modal-header">
                            <h3>Add Note</h3>
                        </div>
                        <label>
                            Note
                            <textarea
                                value={noteContent}
                                onChange={(event) => setNoteContent(event.target.value)}
                                maxLength={5000}
                                rows={6}
                                style={{ width: "100%", marginTop: 8 }}
                            />
                        </label>
                        <div style={{ marginTop: 8, fontSize: 12 }}>{noteContent.length}/5000</div>
                        {noteError && <p className="error">{noteError}</p>}
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button type="button" className="button" onClick={handleSaveNote} disabled={noteSaving}>
                                {noteSaving ? "Saving…" : "Save"}
                            </button>
                            <button type="button" className="button" onClick={() => setNoteOpen(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {message && (
                <div className="deal-action-message" style={{ marginTop: 6 }}>
                    {message}
                </div>
            )}

            {/* Readvance chooser */}
            {readvanceChooserOpen && (
                <div className="modal-backdrop" onClick={() => setReadvanceChooserOpen(false)}>
                    <div className="readvance-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="readvance-modal-header">
                            <h3>Readvance</h3>
                            <img
                                className="readvance-modal-logo"
                                src="/taurus-capital-logo.png"
                                alt="Taurus Capital"
                            />
                        </div>
                        <p className="readvance-modal-subtitle">Choose the readvance flow you want to continue with.</p>

                        <button
                            className="button readvance-modal-button"
                            onClick={async () => {
                                setReadvanceChooserOpen(false);
                                setSellerReadvanceOpen(true);
                                await loadSellerBanks();
                            }}

                        >
                            Seller Bridging Readvance
                        </button>

                        <button
                            className="button"
                            onClick={() => {
                                setReadvanceChooserOpen(false);
                                setMessage("Quick Bridge Readvance coming next.");
                            }}
                            style={{ width: "100%" }}
                        >
                            Quick Bridge Readvance
                        </button>
                    </div>
                </div>
            )}

            {/* Seller Bridging Readvance */}
            {sellerReadvanceOpen && (
                <div className="modal-backdrop" onClick={() => setSellerReadvanceOpen(false)}>
                    <div className="readvance-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="readvance-modal-header">
                            <h3>Seller Bridging Readvance</h3>
                            <img
                                className="readvance-modal-logo"
                                src="/taurus-capital-logo.png"
                                alt="Taurus Capital"
                            />
                        </div>
                        <p className="readvance-modal-subtitle">
                            Complete the details below, then open the pre-filled readvance form.
                        </p>

                        {readvanceError && <p className="error">{readvanceError}</p>}

                        <div className="readvance-form-grid">
                            <label>
                                Party Receiving Taurus Funds
                                <select value={partyReceiving} onChange={(e) => setPartyReceiving(e.target.value)}>
                                    <option>Conveyancing Firm</option>
                                    <option>Seller / Nominated Account</option>
                                    <option>Split Between Firm and Seller</option>
                                </select>
                            </label>

                            <label>
                                Total Readvance Amount
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={totalAmount}
                                    onChange={(e) => setTotalAmount(e.target.value)}
                                />
                            </label>

                            <label>
                                Readvance Amount to Attorney Firm
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={amountToFirm}
                                    onChange={(e) => setAmountToFirm(e.target.value)}
                                    disabled={partyReceiving !== "Split Between Firm and Seller"}
                                />
                            </label>

                            <label>
                                Readvance Amount to Nominated Account
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={amountToNominated}
                                    onChange={(e) => setAmountToNominated(e.target.value)}
                                    disabled={partyReceiving !== "Split Between Firm and Seller"}
                                />
                            </label>

                            <label>
                                Firm Bank
                                <select
                                    value={selectedFirmBankId}
                                    onChange={(e) => setSelectedFirmBankId(e.target.value)}
                                    disabled={partyReceiving === "Seller / Nominated Account"}
                                >
                                    {firmBankOptions.map((b) => (
                                        <option key={b.id} value={b.id}>{b.label}</option>
                                    ))}
                                </select>
                            </label>

                            <label>
                                Seller Bank
                                <select
                                    value={selectedSellerBankId}
                                    onChange={(e) => setSelectedSellerBankId(e.target.value)}
                                    disabled={partyReceiving === "Conveyancing Firm" || sellerBankLoading}
                                >
                                    <option value="">{sellerBankLoading ? "Loading…" : "Select seller bank"}</option>
                                    {sellerBankOptions.map((b) => (
                                        <option key={b.id} value={b.id}>{b.label}</option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        {!canOpenReadvanceForm && partyReceiving === "Split Between Firm and Seller" && (
                            <p className="readvance-validation-message">
                                For split payments, the firm and nominated amounts must add up to the total readvance amount.
                            </p>
                        )}


                        {!sellerBankOptions.length && sellerAccountId && (
                            <button
                                className="button readvance-modal-button"
                                onClick={() =>
                                    openExternalUrl(
                                        buildZohoFormUrl(ADD_BANK_DETAIL_FORM_URL, {
                                            account_name: sellerAccountId,
                                        })
                                    )
                                }
                            >
                                Add Seller Bank Details
                            </button>
                        )}

                        <button
                            className="button readvance-modal-button"
                            disabled={!canOpenReadvanceForm}
                            onClick={() => {
                                const formUrl = buildZohoFormUrl(SELLER_READVANCE_FORM_URL, {
                                    [INITIAL_OR_FURTHER_ADVANCE_ALIAS]: "Further Advance",
                                    Deal_Reference_Number: propertyRefNumber,
                                    Party_Receiving_Taurus_Funds_Further_Advance: partyReceiving,
                                    Readvance_Amount_to_Attorney_Firm: amountToFirm,
                                    Readvance_Amount_to_Nominated_Account: amountToNominated,
                                    Readvance_Firm_Bank_Details_id: selectedFirmBankId,
                                    Readvance_Seller_Bank_Details_id: selectedSellerBankId,
                                });

                                openExternalUrl(formUrl);
                                setSellerReadvanceOpen(false);
                            }}
                        >
                            Open Readvance Form
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}
