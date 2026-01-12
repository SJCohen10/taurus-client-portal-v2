import React, { useMemo } from "react";
import QRFormEmbed from "../../../components/QRFormEmbed";
import { usePortalContext } from "../../../PortalContext";

export default function QuickRatesAdvance({
  title = "Quick Bridge Application",
  productType = "Quick Bridge",
  subtitle = "Please complete the form below. Your firm and user details are pre-populated where possible.",
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


  const baseUrl =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalQuickRatesApplication/formperma/c90HISe4lSZnneCy3A41lVxvxS2OpRCydid_cm6fZ4s";

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

      contact_email: contactEmail,
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

      // ✅ NEW: default firm bank details for Quick Bridge
      Attorney_Firm_Bank: preferredBank?.bank || "",
      Attorney_Firm_Account_Name: preferredBank?.name || "",
      Attorney_Firm_Account_Number: preferredBank?.accountNumber || "",
    }),
    [
      email,
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
      preferredBank?.bank,
      preferredBank?.name,
      preferredBank?.accountNumber,
      productType,
    ]
  );

  const hasPreferredBank =
    preferredBank && (preferredBank.bank || preferredBank.name || preferredBank.accountNumber);


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
          Unable to load your firm details at the moment. The form will still
          load without CRM prefill.
        </p>
      )}

      {!portal?.loading && !portal?.error && !crm && (
        <p className="error" style={{ marginTop: "0.5rem" }}>
          Firm context is unavailable. The form will load without CRM prefill.
        </p>
      )}

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>
          Preferred Quick Rates Bank Account
        </h3>
        <p className="subtle" style={{ marginTop: 0 }}>
          Pulled automatically from the firm account’s <strong>Preferred_Quick_Rates_Bank_Accounts</strong> lookup.
          These values are passed through to the Zoho form below.
        </p>
        {hasPreferredBank ? (
          <div>
            <div style={{ marginBottom: "0.4rem" }}>
              <strong>Bank:</strong> {preferredBank?.bank || "—"}
            </div>
            <div style={{ marginBottom: "0.4rem" }}>
              <strong>Account name:</strong> {preferredBank?.name || "—"}
            </div>
            <div style={{ marginBottom: "0.4rem" }}>
              <strong>Account number:</strong> {preferredBank?.accountNumber || "—"}
            </div>
          </div>
        ) : (
          <p className="error" style={{ margin: 0 }}>
            No preferred bank account is configured for your firm yet. The Zoho form will load without these fields prefilled.
          </p>
        )}
      </div>

      <QRFormEmbed baseUrl={baseUrl} prefill={prefill} />
    </div>
  );
}