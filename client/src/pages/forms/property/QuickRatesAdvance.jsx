import React, { useMemo } from "react";
import QRFormEmbed from "../../../components/QRFormEmbed";

export default function QuickRatesAdvance() {
  // TODO: replace with your actual Zoho Forms public link
  const baseUrl =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalQuickRatesApplication/formperma/c90HISe4lSZnneCy3A41lVxvxS2OpRCydid_cm6fZ4s";

  const portalUser = window.portalUser || {};
  const email =
    portalUser.email ||
    portalUser.email_id ||
    portalUser.user_mailid ||
    portalUser.user_email ||
    "";

  // These keys must match your Zoho Form "Field Link Name" values
  const prefill = useMemo(
    () => ({
      user_email: email,
      product_type: "Quick Rates",
      gclid: window.localStorage?.getItem("gclid") || "",
      utm_source: window.localStorage?.getItem("utm_source") || "",
      utm_medium: window.localStorage?.getItem("utm_medium") || "",
      utm_campaign: window.localStorage?.getItem("utm_campaign") || "",
    }),
    [email]
  );

  return (
    <div>
      <h2>Quick Rates Application</h2>
      <p className="subtle" style={{ marginBottom: "1rem" }}>
        Please complete the form below. Your firm details and user email
        will be pre-populated where possible.
      </p>
      <QRFormEmbed baseUrl={baseUrl} prefill={prefill} />
    </div>
  );
}
