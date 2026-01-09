import React, { useMemo } from "react";
import QRFormEmbed from "../../../components/QRFormEmbed";
import { usePortalContext } from "../../../PortalContext";

export default function SellerProceedsAdvance({
  title = "Seller Proceeds Application",
  productType = "Seller Proceeds",
  subtitle = "Please complete the form below. Your details are pre-populated where possible.",
}) {
  const portal = usePortalContext();
  const emailFromContext = portal?.email || "";

  const portalUser = window.portalUser || {};
  const email =
    emailFromContext ||
    portalUser.email ||
    portalUser.email_id ||
    portalUser.user_mailid ||
    portalUser.user_email ||
    "";

  // ✅ Your Seller Proceeds / Seller Bridging form permalink
  const baseUrl =
    "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/ClientPortalSellerBridgingApplication/formperma/wBiblctfbTBce_jInGEmX_JbaXdWWg5es95hjlEKdx4";

  const prefill = useMemo(
    () => ({
      user_email: email,
      product_type: productType,

      // marketing tracking (optional, safe)
      gclid: window.localStorage?.getItem("gclid") || "",
      utm_source: window.localStorage?.getItem("utm_source") || "",
      utm_medium: window.localStorage?.getItem("utm_medium") || "",
      utm_campaign: window.localStorage?.getItem("utm_campaign") || "",
    }),
    [email, productType]
  );

  return (
    <div>
      <h2>{title}</h2>
      <p className="subtle" style={{ marginBottom: "1rem" }}>
        {subtitle}
      </p>

      {portal?.loading && (
        <p className="subtle" style={{ marginTop: 0 }}>
          Loading your details…
        </p>
      )}

      <QRFormEmbed baseUrl={baseUrl} prefill={prefill} />
    </div>
  );
}
