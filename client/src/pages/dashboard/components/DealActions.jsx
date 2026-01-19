import React, { useRef, useState } from "react";
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
    const fileInputRef = useRef(null);

    const propertyRefNumber =
        deal.property_ref_number ||
        deal.matter_name ||
        deal.deal_ref ||
        deal["Property Ref Number"] ||
        "";
    const propertyDescription =
        deal.property_description || deal["Property Description"] || "";
    const assetIdsRaw =
        deal["Asset IDs"] ||
        deal.asset_ids ||
        deal.assetIds ||
        null;

    const assetIds = String(assetIdsRaw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);


    const propertyFolderId =
        deal.property_folder_id || deal["Property Folder Id"] || null;

    const dealId =
        deal.deal_id || deal.id || deal["Deal Id"] || deal["Id"] || null;

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
                propertyFolderId,  // <-- THIS is what your upload function prefers
                dealId,
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

        if (!assetIds.length) {
            setMessage("No Assets are linked to this deal yet.");
            return;
        }

        try {
            setStatementLoading(true);
            setMessage("");

            // Option A: first asset only
            // const targetIds = [assetIds[0]];

            // Option B: generate ALL assets (what you asked for)
            const targetIds = assetIds;

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
                disabled={!assetIds.length || statementLoading}
                title={assetIds.length ? "Generate statement" : "No Asset IDs available"}
            >
                {statementLoading ? "Preparing…" : "Statement"}
            </button>

            {message && <div className="deal-action-message">{message}</div>}
        </div>
    );

    console.log("Deal row keys:", Object.keys(deal));
    console.log("Deal row sample:", deal);
    console.log("Asset IDs raw:", deal["Asset IDs"], deal["Asset IDs "], deal["Asset IDs"]?.length);

}