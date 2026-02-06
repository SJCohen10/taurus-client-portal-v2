import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
    generateStatement,
    uploadDealDocument,
    fetchBankDetailsForAccount,
} from "../../../services/portalApi";

import { usePortalContext } from "../../../PortalContext";

const SELLER_READVANCE_FORM_URL =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalSellerBridgingApplication/formperma/wBiblctfbTBce_jInGEmX_JbaXdWWg5es95hjlEKdx4";

const ADD_BANK_DETAIL_FORM_URL =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalAddBankDetail/formperma/sMwZkmaaClPpGJ9uLA_jm59z-DBs-l4LoPpWSA3UBr4";

const INITIAL_OR_FURTHER_ADVANCE_ALIAS = "Initial_Advance_Further_Advance";


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

export default function DealActions({ deal, portalEmail, accountId }) {

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



    const rootRef = useRef(null);
    const menuRef = useRef(null);
    const fileInputRef = useRef(null);

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
    const dealId = deal.deal_id || deal.id || deal["Deal Id"] || deal["Id"] || null;

    // Close popup on outside click / ESC
    useEffect(() => {
        function onDocClick(e) {
            const inRoot = rootRef.current?.contains(e.target);
            const inMenu = menuRef.current?.contains(e.target);
            if (!inRoot && !inMenu) setOpen(false);
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

    return (
        <div
            ref={rootRef}
            className="deal-actions"
            onClick={(e) => e.stopPropagation()}
            style={{ position: "relative", display: "inline-block" }}
        >
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleFileChange}
            />

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


            {message && (
                <div className="deal-action-message" style={{ marginTop: 6 }}>
                    {message}
                </div>
            )}

            {/* Readvance chooser */}
            {readvanceChooserOpen && (
                <div className="modal-backdrop" onClick={() => setReadvanceChooserOpen(false)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h3>Readvance</h3>

                        <button
                            className="button"
                            onClick={async () => {
                                setReadvanceChooserOpen(false);
                                setSellerReadvanceOpen(true);
                                await loadSellerBanks();
                            }}
                            style={{ width: "100%", marginBottom: 10 }}
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
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h3>Seller Bridging Readvance</h3>

                        {readvanceError && <p className="error">{readvanceError}</p>}

                        <label>
                            Party Receiving Taurus Funds
                            <select value={partyReceiving} onChange={(e) => setPartyReceiving(e.target.value)}>
                                <option>Conveyancing Firm</option>
                                <option>Seller / Nominated Account</option>
                                <option>Split Between Firm and Seller</option>
                            </select>
                        </label>

                        <label>Total Readvance Amount</label>
                        <input value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} />
                        <label>Readvance Amount to Attorney Firm</label>
                        <input
                            value={amountToFirm}
                            onChange={(e) => setAmountToFirm(e.target.value)}
                            disabled={partyReceiving !== "Split Between Firm and Seller"}
                        />

                        <label>Readvance Amount to Nominated Account</label>
                        <input
                            value={amountToNominated}
                            onChange={(e) => setAmountToNominated(e.target.value)}
                            disabled={partyReceiving !== "Split Between Firm and Seller"}
                        />

                        <label>Firm Bank</label>
                        <select
                            value={selectedFirmBankId}
                            onChange={(e) => setSelectedFirmBankId(e.target.value)}
                            disabled={partyReceiving === "Seller / Nominated Account"}
                        >
                            {firmBankOptions.map((b) => (
                                <option key={b.id} value={b.id}>{b.label}</option>
                            ))}
                        </select>

                        <label>Seller Bank</label>
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


                        {!sellerBankOptions.length && sellerAccountId && (
                            <button
                                className="button"
                                onClick={() =>
                                    window.open(
                                        buildZohoFormUrl(ADD_BANK_DETAIL_FORM_URL, {
                                            account_name: sellerAccountId,
                                        }),
                                        "_blank"
                                    )
                                }
                            >
                                Add Seller Bank Details
                            </button>
                        )}

                        <button
                            className="button"
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

                                window.open(formUrl, "_blank");
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
