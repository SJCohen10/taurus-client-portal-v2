import React, { useMemo } from "react";
import QRFormEmbed from "../../../components/QRFormEmbed";
import { usePortalContext } from "../../../PortalContext";

export default function QuickRatesAdvance() {
  const portal = usePortalContext();
  const crm = portal?.context || null;
  const emailFromContext = portal?.email || "";

  // Zoho Form public permalink
  const baseUrl =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalQuickRatesApplication/formperma/c90HISe4lSZnneCy3A41lVxvxS2OpRCydid_cm6fZ4s";

  // Fallback to window.portalUser if needed
  const portalUser = window.portalUser || {};
  const email =
    emailFromContext ||
    portalUser.email ||
    portalUser.email_id ||
    portalUser.user_mailid ||
    portalUser.user_email ||
    "";

  // CRM fields from getportalusercontext
  const contactEmail = crm?.contactEmail || email;
  const contactName = crm?.contactName || "";
  const portalRole = crm?.portalRole || "";
  const firmName = crm?.accountName || "";
  const quickRatesLimit =
    crm?.quickRatesLimit ?? crm?.quickBridgeLimit ?? "";

  /**
   * Prefill object:
   * These keys must match the "Field Link Name" values in Zoho Forms.
   * Adjust the names on the left to whatever you configured there.
   */
  const prefill = useMemo(
    () => ({
      // already in place
      user_email: email,
      product_type: "Quick Rates",
      gclid: window.localStorage?.getItem("gclid") || "",
      utm_source: window.localStorage?.getItem("utm_source") || "",
      utm_medium: window.localStorage?.getItem("utm_medium") || "",
      utm_campaign: window.localStorage?.getItem("utm_campaign") || "",

      // NEW: CRM-driven fields (examples – align with Zoho Form link names)
      contact_email: contactEmail,     // Contacts.Email
      contact_name: contactName,       // Full name if your form expects it
      portal_role: portalRole,         // Contacts.Portal_Role
      firm_name: firmName,             // Accounts.Account_Name
      quick_rates_limit: quickRatesLimit // Accounts.Quick_Rates_Limit (or bridge limit)
    }),
    [
      email,
      contactEmail,
      contactName,
      portalRole,
      firmName,
      quickRatesLimit,
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
