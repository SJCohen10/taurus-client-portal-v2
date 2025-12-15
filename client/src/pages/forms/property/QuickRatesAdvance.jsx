import React, { useMemo } from "react";
import QRFormEmbed from "../../../components/QRFormEmbed";
import { usePortalContext } from "../../../PortalContext";

export default function QuickRatesAdvance() {
  const portal = usePortalContext();
  const crm = portal?.context || null;
  const emailFromContext = portal?.email || "";

  // ✅ add this HERE
  const preferredBank = crm?.preferredQuickBridgeBank || null;

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
  const portalRole = crm?.portalRole || "";
  const firmName = crm?.accountName || "";
  const quickRatesLimit = crm?.quickRatesLimit ?? crm?.quickBridgeLimit ?? "";

  const prefill = useMemo(
    () => ({
      user_email: email,
      product_type: "Quick Rates",
      gclid: window.localStorage?.getItem("gclid") || "",
      utm_source: window.localStorage?.getItem("utm_source") || "",
      utm_medium: window.localStorage?.getItem("utm_medium") || "",
      utm_campaign: window.localStorage?.getItem("utm_campaign") || "",

      contact_email: contactEmail,
      contact_name: contactName,
      portal_role: portalRole,
      firm_name: firmName,
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
      portalRole,
      firmName,
      quickRatesLimit,
      preferredBank, // ✅ add dependency
    ]
  );

  return (
    <div>
      <h2>Quick Bridge Application</h2>
      <p className="subtle" style={{ marginBottom: "1rem" }}>
        Please complete the form below. Your firm and user details are
        pre-populated from CRM where possible.
      </p>
      <QRFormEmbed baseUrl={baseUrl} prefill={prefill} />
    </div>
  );
}
