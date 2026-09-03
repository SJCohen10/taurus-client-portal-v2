import React, { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import QRFormEmbed from "../../../components/QRFormEmbed";
import { usePortalContext } from "../../../PortalContext";

const READVANCE_VALUE = "further advance";
const READVANCE_PREFILL_PARAM_MAP = [
  { routeKey: "Property_Ref_Number", formKey: "property_ref_number" },
  { routeKey: "Transfer_Duty_Receipt_Obtained", formKey: "transfer_duty_receipt_obtained" },
  { routeKey: "Seller_has_signed_transfer_documents", formKey: "seller_has_signed_transfer_documents" },
  { routeKey: "Guarantees_issued", formKey: "guarantees_issued" },
  { routeKey: "Rates_Clearance_Certificate_Obtained", formKey: "rates_clearance_certificate_obtained" },
  { routeKey: "Bond_Cancellation_Figures_Obtained", formKey: "bond_cancellation_figures_obtained" },
  { routeKey: "Do_the_Bond_attorneys_have_Proceed_to_Lodge", formKey: "do_the_bond_attorneys_have_proceed_to_lodge" },
  { routeKey: "Buyer_has_signed_transfer_documents", formKey: "buyer_has_signed_transfer_documents" },
  { routeKey: "Attorneys_are_in_possession_of_the_original_Deed", formKey: "attorneys_have_original_deed" },
  { routeKey: "Cash_in_Trust", formKey: "cash_in_trust" },
];

export default function QuickRatesAdvance({
  title = "Quick Bridge Application",
  productType = "Quick Bridge",
  subtitle = "Please complete the form below. Your firm and user details are pre-populated where possible.",
}) {
  const portal = usePortalContext();
  const [searchParams] = useSearchParams();
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


  // Preferred ID comes from preferredQuickBridgeBank.id (from context)
  const preferredBankDetailId = preferredBank?.id || "";

  const initialDefaultId =
    preferredBankDetailId ||
    crm?.defaultBankDetailId ||
    (bankOptions.length ? bankOptions[0].id : "");

  const [selectedBankDetailId, setSelectedBankDetailId] = useState(initialDefaultId);

  // Ensure default is set once context arrives (but don't overwrite user selection)
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
  const initialOrFurtherAdvance =
    searchParams.get("Initial_Advance_Further_Advance") || "";
  const isReadvance =
    String(initialOrFurtherAdvance || "").trim().toLowerCase() === READVANCE_VALUE;
  const readvanceOnlyPrefill = useMemo(() => {
    if (!isReadvance) return {};

    return READVANCE_PREFILL_PARAM_MAP.reduce((acc, { routeKey, formKey }) => {
      const value = searchParams.get(routeKey);
      if (value !== null && String(value).trim() !== "") {
        acc[formKey] = value;
      }
      return acc;
    }, {});
  }, [isReadvance, searchParams]);

  const prefill = useMemo(
    () => ({
      user_email: email,
      product_type: productType,
      gclid: window.localStorage?.getItem("gclid") || "",
      utm_source: window.localStorage?.getItem("utm_source") || "",
      utm_medium: window.localStorage?.getItem("utm_medium") || "",
      utm_campaign: window.localStorage?.getItem("utm_campaign") || "",

      // hidden fields
      contact_id: contactId,
      contact_email: contactEmail,

      // ✅ your Zoho Form alias (CRM Bank Details record id)
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
      Initial_Advance_Further_Advance: initialOrFurtherAdvance,
      ...(isReadvance ? readvanceOnlyPrefill : {}),
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
      initialOrFurtherAdvance,
      isReadvance,
      readvanceOnlyPrefill,
      selectedBankDetailId,
    ]
  );

  // Don't mount the iframe until the prefill is settled - Zoho only reads the
  // query params at load, so a later change would remount and discard input.
  // Same guard as AgentAdvance.
  const prefillPending = Boolean(portal?.loading);

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
          without pre-filled firm details.
        </p>
      )}

      {!portal?.loading && !portal?.error && !crm && (
        <p className="error" style={{ marginTop: "0.5rem" }}>
          Firm context is unavailable. The form will load without pre-filled firm details.
        </p>
      )}

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

      {/* Zoho only reads the query params at load, so the iframe must not mount
          until the portal context has resolved - otherwise the initial URL carries
          no values and nothing re-reads them. The key was selectedBankDetailId
          alone, which is "no-bank" both before and after context arrives for a firm
          with no AVS bank details, so that firm never got a remount and never
          prefilled. Keying on the context as well fixes that case. */}
      {prefillPending ? (
        <p className="subtle" style={{ marginTop: 0 }}>
          Loading your firm details…
        </p>
      ) : (
        <QRFormEmbed
          baseUrl={baseUrl}
          prefill={prefill}
          title={title}
          key={[selectedBankDetailId || "no-bank", contactId || "no-contact"].join("|")}
        />
      )}
    </div>
  );
}
