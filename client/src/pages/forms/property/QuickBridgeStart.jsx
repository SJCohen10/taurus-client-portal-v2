import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePortalContext } from "../../../PortalContext";

export default function QuickBridgeStart() {
    const navigate = useNavigate();
    const portalContext = usePortalContext();

    const preferred = portalContext?.context?.preferredQuickBridgeBank || null;
    console.log("PORTAL CONTEXT", portalContext);
    console.log("PREFERRED BANK", preferred);


    const hasPreferred =
        preferred && (preferred.id || preferred.accountNumber || preferred.name);

    function handleContinue() {
        // We will pass the bank details to the form page via URL params
        const params = new URLSearchParams();

        // These keys should match your Zoho Form field link names
        // (adjust if your field link names differ)
        params.set("Attorney_Firm_Bank", preferred?.bank || "");
        params.set("Attorney_Firm_Account_Name", preferred?.name || "");
        params.set("Attorney_Firm_Account_Number", preferred?.accountNumber || "");

        navigate(`/quick-rates?${params.toString()}`);
    }

    if (portalContext?.loading) {
        return <p className="subtle">Loading firm details…</p>;
    }

    if (portalContext?.error) {
        return <p className="error">Error: {portalContext.error}</p>;
    }

    if (!hasPreferred) {
        return (
            <div className="card">
                <h2>Quick Bridge</h2>
                <p className="error" style={{ marginTop: "0.75rem" }}>
                    No preferred firm bank account found. Please set{" "}
                    <strong>Preferred_Quick_Rates_Bank_Accounts</strong> on the firm Account in CRM.
                </p>
            </div>
        );
    }

    return (
        <div className="card">
            <h2>Quick Bridge</h2>
            <p className="subtle" style={{ marginBottom: "1rem" }}>
                Your application will use your firm’s preferred bank account by default.
            </p>

            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1rem" }}>
                <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Bank:</strong> {preferred.bank || "—"}
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Account name:</strong> {preferred.name || "—"}
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Account number:</strong> {preferred.accountNumber || "—"}
                </div>
            </div>

            <button className="button" style={{ marginTop: "1rem" }} onClick={handleContinue}>
                Continue to application form
            </button>
        </div>
    );
}
