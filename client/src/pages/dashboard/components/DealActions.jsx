import React, { useEffect, useRef, useState } from "react";
import {
    generateStatement,
    uploadDealDocument,
} from "../../../services/portalApi";

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
    const [message, setMessage] = useState("");
    const [uploading, setUploading] = useState(false);
    const [statementLoading, setStatementLoading] = useState(false);
    const [selectedAssetId, setSelectedAssetId] = useState("");
    const fileInputRef = useRef(null);

    const propertyRefNumber =
        deal.property_ref_number ||
        deal.matter_name ||
        deal.deal_ref ||
        deal["Property Ref Number"] ||
        "";
    const propertyDescription =
        deal.property_description || deal["Property Description"] || "";
    const assetId =
        deal.asset_id || deal.Asset_Id || deal.assetId || deal["Asset Id"] || null;
    const assetIdsRaw =
        deal.asset_ids ||
        deal.assetIds ||
        deal["Asset Ids"] ||
        deal["Asset IDs"] ||
        deal["Asset Id List"] ||
        null;
    const assetIdsList = Array.isArray(assetIdsRaw)
        ? assetIdsRaw
        : typeof assetIdsRaw === "string"
            ? assetIdsRaw
                .split(/\s*[|;]\s*/)
                .map((item) => item.trim())
                .filter(Boolean)
            : [];
    const assetIds = assetIdsList.length
        ? assetIdsList
        : assetId
            ? [assetId]
            : [];

    useEffect(() => {
        if (assetIds.length === 0) {
            setSelectedAssetId("");
            return;
        }

        if (!selectedAssetId || !assetIds.includes(selectedAssetId)) {
            setSelectedAssetId(assetIds[0]);
        }
    }, [assetIds, selectedAssetId]);

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
                assetId: selectedAssetId || assetId || deal.id || deal.deal_id || null,
            };

            const response = await uploadDealDocument(payload);
            setMessage(
                response?.message ||
                "Uploaded to WorkDrive. You can find it in the property folder."
            );
        } catch (err) {
            console.error("Document upload failed", err);
            setMessage(err.message || "Unable to upload document right now.");
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    }

    async function handleGenerateStatement(event) {
        event.stopPropagation();
        if (!selectedAssetId) {
            setMessage("No Asset ID is linked to this deal yet.");
            return;
        }

        try {
            setStatementLoading(true);
            setMessage("");
            const response = await generateStatement({ assetId: selectedAssetId });

            if (response?.statementUrl) {
                window.open(response.statementUrl, "_blank", "noopener");
                setMessage("Statement opened in a new tab.");
            } else {
                setMessage(
                    response?.message ||
                    "No statement page was returned for this deal."
                );
            }
        } catch (err) {
            console.error("Generate statement failed", err);
            setMessage(err.message || "Unable to generate a statement right now.");
        } finally {
            setStatementLoading(false);
        }
    }

    return (
        <div className="deal-actions" onClick={(e) => e.stopPropagation()}>
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={handleFileChange}
            />
            {assetIds.length > 1 && (
                <select
                    className="deal-action-select"
                    value={selectedAssetId}
                    onChange={(event) => setSelectedAssetId(event.target.value)}
                >
                    {assetIds.map((id) => (
                        <option key={id} value={id}>
                            {id}
                        </option>
                    ))}
                </select>
            )}
            <button
                type="button"
                className="deal-action-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
            >
                {uploading ? "Uploading…" : "Upload Doc"}
            </button>
            <button
                type="button"
                className="deal-action-button secondary"
                onClick={handleGenerateStatement}
                disabled={!selectedAssetId || statementLoading}
                title={
                    selectedAssetId ? "Generate statement" : "No Asset ID available"
                }
            >
                {statementLoading ? "Preparing…" : "Statement"}
            </button>
            {message && <div className="deal-action-message">{message}</div>}
        </div>
    );
}