import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useNavigate } from "react-router-dom";
import {
    generateStatement,
    uploadDealDocument,
    fetchBankDetailsForAccount,
    createNote,
    updateExpectedLodgementDate,
    updateMatterLodged,
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
const READVANCE_ONLY_PREFILL_PARAM_MAP = [
    { urlKey: "Property_Ref_Number", dealKeys: ["property_ref_number", "Property Ref Number"] },
    { urlKey: "Transfer_Duty_Receipt_Obtained", dealKeys: ["transfer_duty_receipt_obtained", "Transfer Duty Receipt Obtained"] },
    { urlKey: "Transfer_Costs_Paid", dealKeys: ["transfer_costs_paid", "buyers_have_paid_costs", "Buyers have paid costs"] },
    { urlKey: "Seller_has_signed_transfer_documents", dealKeys: ["seller_has_signed_transfer_documents", "Seller has signed transfer documents"] },
    { urlKey: "Guarantees_issued", dealKeys: ["guarantees_issued", "Guarantees issued"] },
    { urlKey: "Rates_Clearance_Certificate_Obtained", dealKeys: ["rates_clearance_certificate_obtained", "Rates Clearance Certificate Obtained"] },
    { urlKey: "Bond_Cancellation_Figures_Obtained", dealKeys: ["bond_cancellation_figures_obtained", "Bond Cancellation Figures Obtained"] },
    { urlKey: "Do_the_Bond_attorneys_have_Proceed_to_Lodge", dealKeys: ["do_the_bond_attorneys_have_proceed_to_lodge", "Do the Bond attorneys have Proceed to Lodge"] },
    { urlKey: "Buyer_has_signed_transfer_documents", dealKeys: ["buyer_has_signed_transfer_documents", "Buyer has signed transfer documents"] },
    { urlKey: "Attorneys_are_in_possession_of_the_original_Deed", dealKeys: ["attorneys_have_original_deed", "Attorneys are in possession of the original Deed"] },
    { urlKey: "Cash_in_Trust", dealKeys: ["cash_in_trust", "Cash in Trust"] },
    { urlKey: "On_Sell", dealKeys: ["on_sell", "On-Sell"] },
    { urlKey: "Estate_Late", dealKeys: ["estate_late", "Estate Late"] },
    { urlKey: "Related_Parties", dealKeys: ["related_parties", "Related Parties"] },
    { urlKey: "Sheriff_Transfer", dealKeys: ["sheriff_transfer", "sherriff_transfer", "Sherriff Transfer"] },
    { urlKey: "Readvance_Seller_Bank_Details_id", dealKeys: ["seller_bank_detail_id", "Seller_Bank_Detail_Id"] },
];

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

function hasExpectedLodgementSevenDayReminder(deal) {
    const expectedDate = normalizeDateValue(deal?.expectedLodgementDate);
    if (!expectedDate) return false;
    const status = String(deal?.status || deal?.Status || "").trim().toLowerCase();
    if (["closed", "declined", "registered"].includes(status)) return false;

    const today = new Date();
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const [year, month, day] = expectedDate.split("-").map((value) => Number(value));
    const expectedUtc = Date.UTC(year, month - 1, day);
    const msPerDay = 24 * 60 * 60 * 1000;
    const dayDiff = Math.round((expectedUtc - todayUtc) / msPerDay);
    return dayDiff === 7;
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

function formatNotificationTimestamp(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
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
    const navigate = useNavigate();

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
    const [expectedLodgementReason, setExpectedLodgementReason] = useState("");
    const [expectedLodgementSaving, setExpectedLodgementSaving] = useState(false);
    const [expectedLodgementError, setExpectedLodgementError] = useState("");
    const [matterLodgedOpen, setMatterLodgedOpen] = useState(false);
    const [matterLodgedDate, setMatterLodgedDate] = useState("");
    const [matterLodgedSaving, setMatterLodgedSaving] = useState(false);
    const [matterLodgedError, setMatterLodgedError] = useState("");
    const [notificationOpen, setNotificationOpen] = useState(false);


    const [persistedNotifications, setPersistedNotifications] = useState([]);
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const [notificationsError, setNotificationsError] = useState("");
    const notificationsRequestRef = useRef({ key: "", promise: null });
    const notificationsAbortRef = useRef(null);

    const rootRef = useRef(null);
    const menuRef = useRef(null);
    const fileInputRef = useRef(null);
    const notificationButtonRef = useRef(null);
    const notificationPopoverRef = useRef(null);
    const instanceIdRef = useRef(`deal-actions-${Math.random().toString(36).slice(2, 10)}`);
    const [notificationPopoverPos, setNotificationPopoverPos] = useState({ top: 0, left: 0 });

    const propertyRefNumber =
        deal.propertyRefNumber ||
        deal.property_ref_number ||
        deal.matter_name ||
        deal.deal_ref ||
        deal["Property Ref Number"] ||
        "";

    const propertyDescription =
        deal.propertyDescription || deal.property_description || deal["Property Description"] || "";

    const sellerAccountId =
        deal.seller_account_id ||
        deal["Seller_Account_Id"] ||
        null;


    const assetIdsRaw = deal["Asset IDs"] || deal.asset_ids || deal.assetIds || null;
    const assetIds = String(assetIdsRaw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const propertyFolderId =
        deal.propertyFolderId ||
        deal.property_folder_id ||
        deal["Property Folder Id"] ||
        deal["Property Folder ID"] ||
        deal["Workdrive Folder ID"] ||
        deal["WorkDrive Folder ID"] ||
        null;
    const dealId =
        deal.dealId ||
        deal.deal_id ||
        deal["Deal_Id"] ||
        deal["Deal Id"] ||
        deal.id ||
        deal["Id"] ||
        null;

    const hasUploadFallbackIdentifiers = Boolean(
        String(dealId || "").trim() ||
        String(propertyRefNumber || "").trim() ||
        String(propertyDescription || "").trim()
    );
    const canUploadDocument = Boolean(String(propertyFolderId || "").trim()) || hasUploadFallbackIdentifiers;
    const dealStatus = String(deal?.status || deal?.Status || "").trim().toLowerCase();
    const isClosedDeal = ["closed", "declined"].includes(dealStatus);


    // Close popup on outside click / ESC
    useEffect(() => {
        function onDocClick(e) {
            const inRoot = rootRef.current?.contains(e.target);
            const inMenu = menuRef.current?.contains(e.target);
            const inNotificationPopover = notificationPopoverRef.current?.contains(e.target);

            if (!inRoot && !inMenu && !inNotificationPopover) {
                setOpen(false);
                setNotificationOpen(false);
            }
        }


        function onEsc(e) {
            if (e.key === "Escape") {
                setOpen(false);
                setNotificationOpen(false);
            }
        }

        function onOtherNotificationOpened(e) {
            if (e.detail?.sourceId !== instanceIdRef.current) {
                setNotificationOpen(false);
            }
        }

        document.addEventListener("click", onDocClick);     // ✅ click (not mousedown)
        document.addEventListener("keydown", onEsc);
        window.addEventListener("deal-notification-opened", onOtherNotificationOpened);
        return () => {
            document.removeEventListener("click", onDocClick);
            document.removeEventListener("keydown", onEsc);
            window.removeEventListener("deal-notification-opened", onOtherNotificationOpened);
        };
    }, []);



    useEffect(() => {
        if (!notificationOpen) return undefined;

        const recalcNotificationPopoverPosition = () => {
            const buttonRect = notificationButtonRef.current?.getBoundingClientRect();
            if (!buttonRect) return;

            const maxLeft = window.innerWidth - 340;
            const nextLeft = Math.max(8, Math.min(buttonRect.right - 320, maxLeft));

            setNotificationPopoverPos({
                top: buttonRect.bottom + 8,
                left: nextLeft,
            });
        };

        recalcNotificationPopoverPosition();

        const scrollContainer = rootRef.current?.closest(".deals-table-wrapper");
        const closeNotifications = () => setNotificationOpen(false);

        scrollContainer?.addEventListener("scroll", closeNotifications, { passive: true });
        window.addEventListener("scroll", closeNotifications, { passive: true });
        window.addEventListener("resize", recalcNotificationPopoverPosition);

        return () => {
            scrollContainer?.removeEventListener("scroll", closeNotifications);
            window.removeEventListener("scroll", closeNotifications);
            window.removeEventListener("resize", recalcNotificationPopoverPosition);
        };
    }, [notificationOpen]);

    useEffect(() => () => {
        if (notificationsAbortRef.current) {
            notificationsAbortRef.current.abort();
        }
    }, []);

    useEffect(() => {
        setSelectedFirmBankId((prev) => prev || defaultFirmBankId);
    }, [defaultFirmBankId]);

    useEffect(() => {
        setExpectedLodgementDate(normalizeDateValue(deal?.expectedLodgementDate));
    }, [deal?.expectedLodgementDate]);

    useEffect(() => {
        let cancelled = false;

        const resolvedDealId = String(dealId || "").trim();
        const resolvedEmail = String(portalEmail || "").trim().toLowerCase();

        if (!resolvedDealId || !resolvedEmail) {
            setPersistedNotifications([]);
            return;
        }

        (async () => {
            try {
                const resp = await listNotifications({
                    email: resolvedEmail,
                    dealId: resolvedDealId,
                });

                if (cancelled) return;

                const fetchedNotifications = Array.isArray(resp?.notifications)
                    ? resp.notifications
                    : Array.isArray(resp?.rows)
                        ? resp.rows
                        : [];



                setPersistedNotifications(fetchedNotifications);
                setNotificationsError("");
            } catch (err) {
                if (cancelled) return;
                console.error("[DealActions] preload notifications failed", err);
                setPersistedNotifications([]);
                setNotificationsError(err?.message || "Failed to load notifications");
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [dealId, portalEmail]);


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
                propertyFolderId,
                dealId,
                propertyRefNumber,
                propertyDescription,
                accountId,
                contactEmail: portalEmail,
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

        if (!portalEmail) {
            setMessage("Missing portal user email.");
            return;
        }

        let newTab = null;

        try {
            setStatementLoading(true);
            setMessage("");

            // Open the tab immediately while still inside the user click
            newTab = window.open("about:blank", "_blank");

            if (!newTab) {
                throw new Error("Popup was blocked. Please allow popups for this site.");
            }

            const primaryAssetId = assetIds[0];

            const response = await generateStatement({
                assetId: primaryAssetId,
                email: portalEmail,
            });
            if (!response?.statementUrl) {
                throw new Error("No statement URL was returned.");
            }

            // Navigate the already-open tab to the final Creator URL
            newTab.location.href = response.statementUrl;

            if (response?.statementStorage?.saved) {
                setMessage("Statement generated and saved to the deal Statements folder.");
            } else if (response?.statementStorage?.attempted) {
                setMessage(
                    response?.statementStorage?.message ||
                    "Statement generated. Saving to the deal Statements folder is not yet available."
                );
            } else {
                setMessage("Statement opened in a new tab.");
            }
            setOpen(false);
        } catch (err) {
            console.error("Generate statement failed", err);
            console.error("Statement response/navigation debug", {
                assetIds,
                portalEmail,
                newTabExists: !!newTab,
                newTabClosed: newTab ? newTab.closed : null,
            });
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
        setNotificationOpen(false);
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

    function openPopupWithFallback(url, { name = "portal-popup", width = 1100, height = 760 } = {}) {
        const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
        const dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;

        const left = Math.max(0, Math.round(dualScreenLeft + (viewportWidth - width) / 2));
        const top = Math.max(0, Math.round(dualScreenTop + (viewportHeight - height) / 2));

        const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`;
        const popup = window.open(url, name, features);
        if (popup) return { opened: true, usedFallback: false };

        const fallback = window.open(url, "_blank", "noopener,noreferrer");
        return { opened: Boolean(fallback), usedFallback: Boolean(fallback) };
    }

    function openExternalUrl(url) {
        window.open(url, "_blank", "noopener,noreferrer");
    }

    function buildReadvanceDealPrefillParams() {
        const params = {};
        READVANCE_ONLY_PREFILL_PARAM_MAP.forEach(({ urlKey, dealKeys }) => {
            const value = dealKeys
                .map((key) => deal?.[key])
                .find((candidate) => candidate !== undefined && candidate !== null && String(candidate).trim() !== "");
            if (value === undefined || value === null) return;
            const safe = String(value).trim();
            if (!safe) return;
            params[urlKey] = safe;
        });
        return params;
    }

    function openReadvanceApplication(pathname) {
        const params = new URLSearchParams();
        params.set(INITIAL_OR_FURTHER_ADVANCE_ALIAS, "Further Advance");
        if (propertyRefNumber) {
            params.set("Deal_Reference_Number", String(propertyRefNumber));
        }
        Object.entries(buildReadvanceDealPrefillParams()).forEach(([key, value]) => {
            params.set(key, value);
        });
        navigate(`${pathname}?${params.toString()}`);
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
        setExpectedLodgementReason("");
        setExpectedLodgementOpen(true);
        setOpen(false);
        setNotificationOpen(false);
        if (onOpenExpectedLodgementDate) {
            onOpenExpectedLodgementDate();
        }
    }

    function openMatterLodgedModal() {
        setMatterLodgedError("");
        setMatterLodgedDate(normalizeDateValue(deal?.lodgment_date || deal?.Lodgment_Date || deal?.lodged_date || ""));
        setMatterLodgedOpen(true);
        setOpen(false);
        setNotificationOpen(false);
    }

    async function handleExpectedLodgementSave(event) {
        event.stopPropagation();

        const selectedDate = normalizeDateValue(expectedLodgementDate);
        const trimmedReason = expectedLodgementReason.trim();
        if (!selectedDate) {
            setExpectedLodgementError("Please select a valid date in YYYY-MM-DD format.");
            return;
        }
        if (!trimmedReason) {
            setExpectedLodgementError("Reason for Update is required.");
            return;
        }
        if (trimmedReason.length > 5000) {
            setExpectedLodgementError("Reason for Update cannot exceed 5000 characters.");
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
        const target = resolveNoteTarget();
        if (!target) {
            setExpectedLodgementError("No Deal or Asset id is available for this row.");
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
            await createNote({
                email: portalEmail,
                recordType: target.recordType,
                recordId: target.recordId,
                content: `Expected Lodgement Date updated to ${selectedDate}. Reason for Update: ${trimmedReason}`,
            });
            if (onDealUpdate) {
                onDealUpdate({ ...deal, expectedLodgementDate: selectedDate });
            }
            setExpectedLodgementOpen(false);
            setExpectedLodgementReason("");
            setMessage("Expected Lodgement Date updated and note added.");
        } catch (error) {
            setExpectedLodgementError(error.message || "Unable to update Expected Lodgement Date.");
        } finally {
            setExpectedLodgementSaving(false);
        }
    }

    async function handleMatterLodgedSave(event) {
        event.stopPropagation();

        const selectedDate = normalizeDateValue(matterLodgedDate);
        if (!selectedDate) {
            setMatterLodgedError("Please select a valid lodgement date in YYYY-MM-DD format.");
            return;
        }
        if (!portalEmail) {
            setMatterLodgedError("Missing portal user email.");
            return;
        }
        if (!/^\d+$/.test(String(dealId || ""))) {
            setMatterLodgedError("No CRM deal id is available for this row.");
            return;
        }

        try {
            setMatterLodgedSaving(true);
            setMatterLodgedError("");
            await updateMatterLodged({
                email: portalEmail,
                dealId: String(dealId),
                lodgementDate: selectedDate,
            });
            if (onDealUpdate) {
                onDealUpdate({ ...deal, Lodged: "Yes", lodged: "Yes", Lodgment_Date: selectedDate, lodgment_date: selectedDate });
            }
            setMatterLodgedOpen(false);
            setMessage("Matter marked as lodged.");
        } catch (error) {
            setMatterLodgedError(error.message || "Unable to update matter lodged status.");
        } finally {
            setMatterLodgedSaving(false);
        }
    }

    const needsExpectedLodgementAttention = hasExpectedLodgementAttention(deal);
    const hasSevenDayReminder = hasExpectedLodgementSevenDayReminder(deal);

    const computedNotifications = [];
    if (needsExpectedLodgementAttention) {
        computedNotifications.push({
            id: "expected-lodgement-overdue",
            message: "Expected Lodgement Date has passed. Please update it.",
            source: "computed",
        });
    }
    if (hasSevenDayReminder) {
        computedNotifications.push({
            id: "expected-lodgement-7-day-reminder",
            title: "Expected Lodgement Reminder",
            message: "Lodgement is scheduled in 7 days. Please confirm that everything remains on track. If there are any concerns or delays, add a note on the deal so the Taurus team can assist.",
            source: "computed",
        });
    }

    const mergedNotifications = [
        ...(Array.isArray(persistedNotifications)
            ? persistedNotifications.map((n) => ({ ...n, source: "persisted" }))
            : []),
        ...computedNotifications,
    ];

    const notificationCount = mergedNotifications.length;

    async function fetchPersistedNotifications({ showLoading = false, suppressError = false } = {}) {
        const resolvedDealId = String(dealId || "").trim();
        const resolvedEmail = String(portalEmail || "").trim().toLowerCase();
        if (!resolvedDealId) {
            setPersistedNotifications([]);
            return;
        }

        if (!resolvedEmail) {
            setPersistedNotifications([]);
            setNotificationsLoading(false);
            if (!suppressError) setNotificationsError("Missing portal email context.");
            return;
        }

        const requestKey = `${resolvedDealId}|${resolvedEmail}|false`;
        if (notificationsRequestRef.current.key === requestKey && notificationsRequestRef.current.promise) {
            return notificationsRequestRef.current.promise;
        }

        if (notificationsAbortRef.current) {
            notificationsAbortRef.current.abort();
        }
        const abortController = new AbortController();
        notificationsAbortRef.current = abortController;

        const requestPromise = (async () => {
            try {
                if (showLoading) setNotificationsLoading(true);
                const resp = await listNotifications({
                    email: resolvedEmail,
                    dealId: resolvedDealId,
                    signal: abortController.signal,
                });
                const fetchedNotifications = Array.isArray(resp?.notifications) ? resp.notifications : [];
                setPersistedNotifications(fetchedNotifications);
                if (!suppressError) setNotificationsError("");
            } catch (err) {
                if (err?.name === "AbortError") {
                    return;
                }
                console.error("[DealActions] Notifications fetch failure", err);
                if (!suppressError) {
                    setNotificationsError(err?.message || "Failed to load notifications");
                }
                setPersistedNotifications([]);
            } finally {
                if (showLoading) setNotificationsLoading(false);
                if (notificationsAbortRef.current === abortController) {
                    notificationsAbortRef.current = null;
                }
                if (notificationsRequestRef.current.key === requestKey) {
                    notificationsRequestRef.current = { key: "", promise: null };
                }
            }
        })();

        notificationsRequestRef.current = { key: requestKey, promise: requestPromise };
        return requestPromise;
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
        if (notification.id === "expected-lodgement-7-day-reminder") {
            setNotificationOpen(false);
            return;
        }

        // future persisted types
        if (notification.type === "UPDATE_EXPECTED_LODGEMENT_DATE") {
            openExpectedLodgementModal();
            return;
        }
        // default behavior: only mark as read and close popover.
        setNotificationOpen(false);
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

                    window.dispatchEvent(
                        new CustomEvent("deal-notification-opened", {
                            detail: { sourceId: instanceIdRef.current },
                        })
                    );

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
                            disabled={uploading || !canUploadDocument}
                            title={!canUploadDocument ? "Missing WorkDrive folder or identifiers. Ask support to create a folder / fix Analytics mapping." : "Upload document"}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 10px",
                                borderRadius: 10,
                                border: "none",
                                background: "transparent",
                                cursor: uploading || !canUploadDocument ? "not-allowed" : "pointer",
                                opacity: uploading || !canUploadDocument ? 0.6 : 1,
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


                        {!isClosedDeal && (
                            <button
                                type="button"
                                className="deal-actions-menu-item"
                                role="menuitem"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    openMatterLodgedModal();
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
                                Matter Lodged
                            </button>
                        )}

                        {!isClosedDeal && (
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
                        )}

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


                        {!isClosedDeal && (
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
                        )}
                    </div>,
                    document.body
                )}

            {notificationOpen && ReactDOM.createPortal(
                <div
                    ref={notificationPopoverRef}
                    className="deal-notification-popover"
                    style={{ top: notificationPopoverPos.top, left: notificationPopoverPos.left }}
                    onClick={(event) => event.stopPropagation()}
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
                                const createdAt = n.created_at || n.Created_At || n.createdAt;
                                const notificationDealRef = n.deal_ref || n.Deal_Ref || n.deal_id || n.Deal_Id || propertyRefNumber;

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
                                                    setNotificationOpen(false);
                                                } catch (err) {
                                                    console.warn("Failed to mark notification read", err);
                                                }
                                            } else if (n.source === "persisted") {
                                                console.warn("Skipping mark read: persisted notification has no id", n);
                                            }

                                            handleNotificationClick(n);
                                        }}
                                    >
                                        <span className="deal-notification-item-title">
                                            {n.title || n.type || "Notification"}
                                        </span>
                                        <span className="deal-notification-item-message">{n.message || "No message"}</span>
                                        <span className="deal-notification-item-meta">
                                            {notificationDealRef ? `Deal ${notificationDealRef}` : "Deal notification"}
                                            {formatNotificationTimestamp(createdAt) ? ` • ${formatNotificationTimestamp(createdAt)}` : ""}
                                        </span>
                                    </button>
                                );
                            })}
                        </>
                    ) : (
                        <p>No notifications.</p>
                    )}
                </div>,
                document.body
            )}



            {expectedLodgementOpen &&
                ReactDOM.createPortal(
                    <div className="modal-backdrop" onClick={() => setExpectedLodgementOpen(false)}>
                        <div
                            className="readvance-modal expected-date-modal"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="readvance-modal-header">
                                <h3>Update Expected Lodgement Date</h3>
                            </div>

                            <div className="readvance-modal-body">
                                <label>
                                    Expected Lodgement Date
                                    <input
                                        type="date"
                                        value={expectedLodgementDate}
                                        onChange={(event) => setExpectedLodgementDate(event.target.value)}
                                        max="9999-12-31"
                                    />
                                </label>
                                <label>
                                    Reason for Update
                                    <textarea
                                        className="note-modal-textarea"
                                        value={expectedLodgementReason}
                                        onChange={(event) => setExpectedLodgementReason(event.target.value)}
                                        onKeyDown={(event) => event.stopPropagation()}
                                        maxLength={5000}
                                        rows={4}
                                        placeholder="Provide the reason for changing the expected lodgement date."
                                    />
                                </label>

                                {expectedLodgementError && <p className="error">{expectedLodgementError}</p>}

                                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                    <button
                                        type="button"
                                        className="button"
                                        onClick={handleExpectedLodgementSave}
                                        disabled={expectedLodgementSaving}
                                    >
                                        {expectedLodgementSaving ? "Saving…" : "Save"}
                                    </button>
                                    <button
                                        type="button"
                                        className="button"
                                        onClick={() => setExpectedLodgementOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

            {matterLodgedOpen &&
                ReactDOM.createPortal(
                    <div className="modal-backdrop" onClick={() => setMatterLodgedOpen(false)}>
                        <div
                            className="readvance-modal expected-date-modal"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="readvance-modal-header">
                                <h3>Matter Lodged</h3>
                            </div>

                            <div className="readvance-modal-body">
                                <label>
                                    Lodgement Date
                                    <input
                                        type="date"
                                        value={matterLodgedDate}
                                        onChange={(event) => setMatterLodgedDate(event.target.value)}
                                        max="9999-12-31"
                                    />
                                </label>

                                {matterLodgedError && <p className="error">{matterLodgedError}</p>}

                                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                    <button
                                        type="button"
                                        className="button"
                                        onClick={handleMatterLodgedSave}
                                        disabled={matterLodgedSaving}
                                    >
                                        {matterLodgedSaving ? "Saving…" : "Save"}
                                    </button>
                                    <button
                                        type="button"
                                        className="button"
                                        onClick={() => setMatterLodgedOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

            {noteOpen &&
                ReactDOM.createPortal(
                    <div className="modal-backdrop" onClick={() => setNoteOpen(false)}>
                        <div
                            className="readvance-modal note-modal"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="readvance-modal-header">
                                <h3>Add Note</h3>
                            </div>

                            <div className="readvance-modal-body">
                                <label>
                                    Note
                                    <textarea
                                        className="note-modal-textarea"
                                        value={noteContent}
                                        onChange={(event) => setNoteContent(event.target.value)}
                                        onKeyDown={(event) => event.stopPropagation()}
                                        maxLength={5000}
                                        rows={6}
                                    />
                                </label>

                                <div style={{ marginTop: 8, fontSize: 12 }}>
                                    {noteContent.length}/5000
                                </div>

                                {noteError && <p className="error">{noteError}</p>}

                                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                    <button
                                        type="button"
                                        className="button"
                                        onClick={handleSaveNote}
                                        disabled={noteSaving}
                                    >
                                        {noteSaving ? "Saving…" : "Save"}
                                    </button>
                                    <button
                                        type="button"
                                        className="button"
                                        onClick={() => setNoteOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

            {message && (
                <div className="deal-action-message" style={{ marginTop: 6 }}>
                    {message}
                </div>
            )}

            {/* Readvance chooser */}
            {readvanceChooserOpen && ReactDOM.createPortal(
                <div className="modal-backdrop readvance-backdrop" onClick={() => setReadvanceChooserOpen(false)}>
                    <div className="readvance-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="readvance-modal-header">
                            <h3>Readvance</h3>
                            <img
                                src={`${process.env.PUBLIC_URL}/taurus-capital-logo.png`}
                                alt="Taurus Capital"
                                className="app-header-logo"
                            />
                        </div>
                        <div className="readvance-modal-body">
                            <p className="readvance-modal-subtitle">Choose the preferred readvance product</p>
                            <p className="readvance-modal-subtitle">Quick Bridge is paid to the conveyancing firm to settle rates/levies up to your Quick Bridge Limit.</p>
                            <p className="readvance-modal-subtitle">Seller Bridging requires the Seller's signature and a Conveyancing Firm Undertaking</p>
                        </div>
                        <button
                            className="button readvance-modal-button"
                            onClick={async () => {
                                setReadvanceChooserOpen(false);
                                openReadvanceApplication("/seller-proceeds");
                            }}

                        >
                            Seller Bridging Readvance
                        </button>

                        <button
                            className="button"
                            onClick={() => {
                                setReadvanceChooserOpen(false);
                                openReadvanceApplication("/quick-rates");
                            }}
                            style={{ width: "100%" }}
                        >
                            Quick Bridge Readvance
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {/* Seller Bridging Readvance */}
            {sellerReadvanceOpen && ReactDOM.createPortal(
                <div className="modal-backdrop readvance-backdrop" onClick={() => setSellerReadvanceOpen(false)}>
                    <div className="readvance-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="readvance-modal-header">
                            <h3>Seller Bridging Readvance</h3>
                            <img
                                className="readvance-modal-logo"
                                src="/taurus-capital-logo.png"
                                alt="Taurus Capital"
                            />
                        </div>
                        <div className="readvance-modal-body">
                            <p className="readvance-modal-subtitle">
                                Complete the details below, then open the pre-filled readvance form.
                            </p>

                            {readvanceError && <p className="error">{readvanceError}</p>}

                            <section className="readvance-section-card">
                                <h4 className="readvance-section-title">Current Position</h4>
                                <div className="readvance-summary-grid">
                                    <div className="readvance-summary-item">
                                        <div className="readvance-summary-label">Deal Reference</div>
                                        <div className="readvance-summary-value">{propertyRefNumber || "—"}</div>
                                    </div>
                                    <div className="readvance-summary-item">
                                        <div className="readvance-summary-label">Current Balance</div>
                                        <div className="readvance-summary-value">{deal.current_balance || deal["Current Balance"] || "—"}</div>
                                    </div>
                                    <div className="readvance-summary-item">
                                        <div className="readvance-summary-label">Upsell Potential</div>
                                        <div className="readvance-summary-value">{deal.upsell_available || deal["Upsell Available"] || "—"}</div>
                                    </div>
                                    <div className="readvance-summary-item">
                                        <div className="readvance-summary-label">Seller Account</div>
                                        <div className="readvance-summary-value">{sellerAccountId || "—"}</div>
                                    </div>
                                </div>
                            </section>

                            <section className="readvance-section-card">
                                <h4 className="readvance-section-title">Readvance Options</h4>
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
                            </section>

                            <section className="readvance-section-card">
                                <h4 className="readvance-section-title">Action</h4>
                                <div className="readvance-modal-actions">
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
                                                ...buildReadvanceDealPrefillParams(),
                                            });

                                            const popupResult = openPopupWithFallback(formUrl, {
                                                name: "taurus-generate-quote",
                                                width: 1200,
                                                height: 860,
                                            });

                                            if (!popupResult.opened) {
                                                setReadvanceError("Popup was blocked. Please allow popups and try again.");
                                                return;
                                            }

                                            if (popupResult.usedFallback) {
                                                setMessage("Popup was blocked, so the quote form was opened in a new tab.");
                                            }

                                            setSellerReadvanceOpen(false);
                                        }}
                                    >
                                        Generate Quote
                                    </button>
                                    <button className="button readvance-modal-button" onClick={() => setSellerReadvanceOpen(false)}>
                                        Cancel
                                    </button>
                                </div>
                            </section>
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
}
