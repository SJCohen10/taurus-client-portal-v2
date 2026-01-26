import React, { useMemo, useState, useEffect } from "react";
import QRFormEmbed from "../../../components/QRFormEmbed";
import { usePortalContext } from "../../../PortalContext";

export default function SellerProceedsAdvance({
    title = "Seller Proceeds Application",
    productType = "Seller Proceeds",
    subtitle = "Please complete the application below. Your firm and user details are pre-populated where possible.",
}) {
    const portal = usePortalContext();
    const crm = portal?.context || null;
    const emailFromContext = portal?.email || "";

    const preferredBank =
        crm?.preferredQuickBridgeBank ||
        crm?.preferred_quick_bridge_bank ||
        crm?.preferredQuickRatesBank ||
        crm?.preferred_quick_rates_bank ||
        null;

    const bankOptions = useMemo(() => {
        return crm?.bankDetails || [];
    }, [crm?.bankDetails]);

    const preferredBankDetailId = preferredBank?.id || "";
    const initialDefaultId =
        preferredBankDetailId ||
        crm?.defaultBankDetailId ||
        (bankOptions.length ? bankOptions[0].id : "");

    const [selectedBankDetailId, setSelectedBankDetailId] = useState(initialDefaultId);

    useEffect(() => {
        const nextDefault =
            preferredBankDetailId ||
            crm?.defaultBankDetailId ||
            (bankOptions.length ? bankOptions[0].id : "");

        setSelectedBankDetailId((prev) => (prev ? prev : nextDefault));
    }, [preferredBankDetailId, crm?.defaultBankDetailId, bankOptions]);

    const selectedBank = useMemo(() => {
        return bankOptions.find((b) => b.id === selectedBankDetailId) || null;
    }, [bankOptions, selectedBankDetailId]);

    const baseUrl = "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalSellerBridgingApplication/formperma/wBiblctfbTBce_jInGEmX_JbaXdWWg5es95hjlEKdx4";

    const portalUser = window.portalUser || {};
    const email =
        emailFromContext ||
        portalUser.email ||
        portalUser.email_id ||
        portalUser.user_mailid ||
        portalUser.user_email ||
        "";

    const contactEmail = crm?.contactEmail || email;
    const contactName = crm?.contactName || "";
    const contactFirstName = crm?.contactFirstName || "";
    const contactLastName = crm?.contactLastName || "";
    const contactMobile = crm?.contactMobile || "";
    const portalRole = crm?.portalRole || "";

    const contactId =
        crm?.contactId ||
        crm?.contact_id ||
        crm?.Contact_ID ||
        crm?.contact?.id ||
        "";

    const firmName = crm?.accountName || "";
    const firmRegNumber = crm?.firmRegNumber || "";
    const firmStreetAddress = crm?.firmStreetAddress || "";
    const firmCity = crm?.firmCity || "";
    const firmProvince = crm?.firmProvince || "";
    const firmZipCode = crm?.firmZipCode || "";
    const accountEmail = crm?.accountEmail || contactEmail;
    const accountMobile = crm?.accountMobile || contactMobile;
    const directorName = crm?.directorName || "";
    const directorEmail = crm?.directorEmail || "";
    const quickRatesLimit = crm?.quickRatesLimit ?? crm?.quickBridgeLimit ?? "";

    const prefill = useMemo(
        () => ({
            user_email: email,
            product_type: productType,
            gclid: window.localStorage?.getItem("gclid") || "",
            utm_source: window.localStorage?.getItem("utm_source") || "",
            utm_medium: window.localStorage?.getItem("utm_medium") || "",
            utm_campaign: window.localStorage?.getItem("utm_campaign") || "",

            contact_id: contactId,
            contact_email: contactEmail,

            Firm_Bank_Details_id: selectedBankDetailId || "",

            contact_name: contactName,
            contact_first_name: contactFirstName,
            contact_last_name: contactLastName,
            contact_mobile: contactMobile,
            portal_role: portalRole,

            firm_name: firmName,
            firm_reg_number: firmRegNumber,
            firm_street_address: firmStreetAddress,
            firm_city: firmCity,
            firm_province: firmProvince,
            firm_zip_code: firmZipCode,

            account_email: accountEmail,
            account_mobile: accountMobile,

            director_first_name: directorName,
            director_email: directorEmail,
            quick_rates_limit: quickRatesLimit,

            Attorney_Firm_Bank: selectedBank?.bank || preferredBank?.bank || "",
            Attorney_Firm_Account_Name: selectedBank?.name || preferredBank?.name || "",
            Attorney_Firm_Account_Number:
                selectedBank?.accountNumber || preferredBank?.accountNumber || "",
        }),
        [
            email,
            productType,
            contactId,
            contactEmail,
            contactName,
            contactFirstName,
            contactLastName,
            contactMobile,
            portalRole,
            firmName,
            firmRegNumber,
            firmStreetAddress,
            firmCity,
            firmProvince,
            firmZipCode,
            accountEmail,
            accountMobile,
            directorName,
            directorEmail,
            quickRatesLimit,
            selectedBankDetailId,
            selectedBank?.bank,
            selectedBank?.name,
            selectedBank?.accountNumber,
            preferredBank?.bank,
            preferredBank?.name,
            preferredBank?.accountNumber,
        ]
    );

    return (
        <div>
            <h2>{title}</h2>
            <p className="subtle" style={{ marginBottom: "1rem" }}>
                {subtitle}
            </p>

            {portal?.loading && (
                <p className="subtle" style={{ marginTop: 0 }}>
                    Loading your firm details…
                </p>
            )}

            {portal?.error && (
                <p className="error" style={{ marginTop: "0.5rem" }}>
                    Unable to load your firm details at the moment. The form will still load
                    without CRM prefill.
                </p>
            )}

            {!portal?.loading && !portal?.error && !crm && (
                <p className="error" style={{ marginTop: "0.5rem" }}>
                    Firm context is unavailable. The form will load without CRM prefill.
                </p>
            )}

            <div className="card notice-card" style={{ marginBottom: "1.25rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                    What happens after you submit?
                </h3>
                <p style={{ margin: 0 }}>
                    This application automatically generates a contract to be signed by the
                    Seller(s) and an undertaking to be completed and signed by an authorized
                    signatory of the Firm.
                </p>
            </div>

            <div className="card" style={{ marginBottom: "1.25rem" }}>
                <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
                    Desired Firm Bank Account
                </h3>

                {bankOptions.length ? (
                    <>
                        <select
                            value={selectedBankDetailId}
                            onChange={(e) => setSelectedBankDetailId(e.target.value)}
                            style={{ width: "100%", padding: "0.6rem" }}
                        >
                            {bankOptions.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.label}
                                </option>
                            ))}
                        </select>

                        <div style={{ marginTop: "0.75rem" }}>
                            <div style={{ marginBottom: "0.4rem" }}>
                                <strong>Bank:</strong> {selectedBank?.bank || "—"}
                            </div>
                            <div style={{ marginBottom: "0.4rem" }}>
                                <strong>Account name:</strong> {selectedBank?.name || "—"}
                            </div>
                            <div style={{ marginBottom: "0.4rem" }}>
                                <strong>Account number:</strong>{" "}
                                {selectedBank?.accountNumber
                                    ? `****${String(selectedBank.accountNumber).slice(-4)}`
                                    : "—"}
                            </div>
                        </div>
                    </>
                ) : (
                    <p className="error" style={{ margin: 0 }}>
                        No AVS-verified bank accounts are configured for your firm yet.
                    </p>
                )}
            </div>

            {baseUrl ? (
                <QRFormEmbed
                    baseUrl={baseUrl}
                    prefill={prefill}
                    title={title}
                    key={selectedBankDetailId || "no-bank"}
                />
            ) : (
                <p className="error" style={{ marginTop: "1rem" }}>
                    This application form is not configured yet. Please contact support to continue.
                </p>
            )}
        </div>
    );
}