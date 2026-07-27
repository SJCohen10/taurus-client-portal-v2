// Conveyancing Firm Agent Facility — shared helpers (feature gating, agent-deal
// detection, and the Zoho Form prefill payloads). This is the single source of
// truth reused by the standalone Conveyancing Firm Agent Facility page, the
// dashboard filter/drill-in, and the per-deal actions button, so the gate +
// form wiring stay consistent.
//
// The form is surfaced exactly like the existing "Quick Bridge" Zoho Form: an
// embedded iframe (client/src/components/QRFormEmbed.jsx) prefilled with query
// params. First drawdown ("Add Agent Facility Drawdown" / the page's apply
// button) opens the form at the start with the full Quick Bridge field set.
// Readvance ("Agent Facility Readvance") opens the SAME form skipped to its last
// page via the Initial_Advance_Further_Advance dropdown, passing no extra info.

// Conveyancing Firm Agent Facility Zoho Form (New Conveyancer/Agent Application).
// Full formperma URL so field prefill works. Prefill still depends on the form
// field aliases (payload KEYS) confirmed in the build*Payload functions below.
export const AGENT_ADVANCE_FORM_URL =
  "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/NewConveyancerAgentApplication/formperma/ILW6tjeJvPBKoN7mw9xSWnC2jQe600R6YDg6BmqKbGw";

// Value of the start-of-form Initial_Advance_Further_Advance dropdown that makes
// the Zoho Form skip to its last page (readvance mode). Mirrors the same alias +
// value the Quick Bridge / Seller readvance flows already use.
export const AGENT_FURTHER_ADVANCE_VALUE = "Further Advance";

// TODO(agent-facility): confirm the exact product_type value this form expects.
const AGENT_PRODUCT_TYPE = "Conveyancing Firm Agent Facility";

const AGENT_ASSET_TYPE = "estate agent";

// A deal is an "agent deal" if its "Asset Types" string contains "Estate Agent".
// Parsed defensively: trimmed, case-insensitive, order/count agnostic (the string
// may be "Seller,Estate Agent", "Estate Agent,Seller", or a single value).
export function isAgentDeal(deal) {
  const assetTypes =
    deal?.asset_types ??
    deal?.["Asset Types"] ??
    deal?.assetTypes ??
    deal?.["Asset_Types"] ??
    "";
  return String(assetTypes).toLowerCase().includes(AGENT_ASSET_TYPE);
}

// Feature gate: BOTH account flags must pass — Enabled === "Yes" and
// Status === "Active" (trim + case-insensitive). Reads the two fields surfaced by
// getPortalUserContext. Used to gate the nav link, the route, the actions item,
// and the dashboard filter.
export function isAgentAdvanceEnabled(context) {
  const enabled = String(context?.conveyancingFirmLoanEnabled ?? "").trim().toLowerCase();
  const status = String(context?.conveyancingFirmLoanStatus ?? "").trim().toLowerCase();
  return enabled === "yes" && status === "active";
}

// Baseline payload for a first drawdown ("Add Agent Facility Drawdown") and the
// standalone page's apply button. Replicates the FULL Quick Bridge field set
// (same keys/values as pages/forms/property/QuickRatesAdvance.jsx › prefill),
// resolving the firm's default/preferred bank the same way Quick Bridge does.
//
// TODO(agent-facility): the KEYS below mirror the Quick Bridge form aliases as a
// working assumption. Confirm this form's real field aliases and adjust here only.
export function buildAgentBaselinePayload(context) {
  const crm = context || {};

  const contactId =
    crm.contactId || crm.contact_id || crm.Contact_ID || crm.contact?.id || "";

  // Resolve the firm's default/preferred bank exactly as Quick Bridge does, so the
  // baseline payload carries the same bank fields Quick Bridge sends.
  const bankOptions = Array.isArray(crm.bankDetails) ? crm.bankDetails : [];
  const preferredBank = crm.preferredQuickBridgeBank || null;
  const selectedBankId =
    preferredBank?.id || crm.defaultBankDetailId || bankOptions[0]?.id || "";
  const selectedBank = bankOptions.find((b) => b.id === selectedBankId) || null;

  const ls = typeof window !== "undefined" ? window.localStorage : null;

  return {
    user_email: crm.contactEmail || "",
    product_type: AGENT_PRODUCT_TYPE,
    gclid: ls?.getItem("gclid") || "",
    utm_source: ls?.getItem("utm_source") || "",
    utm_medium: ls?.getItem("utm_medium") || "",
    utm_campaign: ls?.getItem("utm_campaign") || "",

    // hidden fields
    contact_id: contactId,
    contact_email: crm.contactEmail || "",

    // CRM Bank Details record id (Quick Bridge alias)
    Firm_Bank_Details_id: selectedBankId,

    contact_name: crm.contactName || "",
    contact_first_name: crm.contactFirstName || "",
    contact_last_name: crm.contactLastName || "",
    contact_mobile: crm.contactMobile || "",
    portal_role: crm.portalRole || "",

    firm_name: crm.accountName || "",
    firm_reg_number: crm.firmRegNumber || "",
    firm_street_address: crm.firmStreetAddress || "",
    firm_city: crm.firmCity || "",
    firm_province: crm.firmProvince || "",
    firm_zip_code: crm.firmZipCode || "",

    account_email: crm.accountEmail || crm.contactEmail || "",
    account_mobile: crm.accountMobile || crm.contactMobile || "",

    director_first_name: crm.directorName || "",
    director_email: crm.directorEmail || "",
    quick_rates_limit: crm.quickRatesLimit ?? crm.quickBridgeLimit ?? "",

    Attorney_Firm_Bank: selectedBank?.bank || preferredBank?.bank || "",
    Attorney_Firm_Account_Name: selectedBank?.name || preferredBank?.name || "",
    Attorney_Firm_Account_Number:
      selectedBank?.accountNumber || preferredBank?.accountNumber || "",
  };
}

// Payload for a subsequent draw-down ("Agent Facility Readvance"). Opens the SAME
// form skipped to its last page via the Initial_Advance_Further_Advance dropdown,
// passing NO extra deal or firm information — the client only completes the final
// page.
export function buildAgentReadvancePayload() {
  return { Initial_Advance_Further_Advance: AGENT_FURTHER_ADVANCE_VALUE };
}
