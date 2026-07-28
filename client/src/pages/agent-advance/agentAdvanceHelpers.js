// Conveyancing Firm Agent Facility — shared helpers (feature gating, agent-deal
// detection, and the Zoho Form prefill payloads). This is the single source of
// truth reused by the standalone Conveyancing Firm Agent Facility page, the
// dashboard filter/drill-in, and the per-deal actions button, so the gate +
// form wiring stay consistent.
//
// The form is surfaced like the existing "Quick Bridge" Zoho Form — an embedded
// iframe (client/src/components/QRFormEmbed.jsx) prefilled with query params —
// but it is a SEPARATE integration with its own field aliases; the two are not
// coupled. First drawdown ("Add Agent Facility Drawdown" / the page's apply
// button) opens the form at the start. Readvance ("Agent Facility Readvance")
// opens the SAME form skipped to its last page via the
// Initial_Advance_Further_Advance dropdown, passing no extra info.
//
// Two aliases are deliberately never prefilled: shortfall_transfer (no portal
// source) and aware_any_issues_may_delay_transfer (a point-in-time declaration
// by the applicant). Both are answered in the form.

// Conveyancing Firm Agent Facility Zoho Form (New Conveyancer/Agent Application).
// Full formperma URL so field prefill works. Prefill depends on the form field
// aliases (payload KEYS) used in the build*Payload functions below.
export const AGENT_ADVANCE_FORM_URL =
  "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/NewConveyancerAgentApplication/formperma/ILW6tjeJvPBKoN7mw9xSWnC2jQe600R6YDg6BmqKbGw";

// Value of the start-of-form Initial_Advance_Further_Advance dropdown that makes
// the Zoho Form skip to its last page (readvance mode). Mirrors the same alias +
// value the Quick Bridge / Seller readvance flows already use.
export const AGENT_FURTHER_ADVANCE_VALUE = "Further Advance";

// Value of the same dropdown for a first drawdown (form opens at the start).
export const AGENT_INITIAL_ADVANCE_VALUE = "Initial Advance";

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

// Transfer-condition aliases on the Agent Facility form, mapped to the deal keys
// getportaldeals surfaces. Only prefilled when a first drawdown is launched from
// the Actions button on an existing deal — a drawdown started from the page is a
// NEW deal with no ref number, so the client answers these in the form.
// Values are normalised to Yes/No; anything blank/unrecognised is omitted so the
// form field stays empty rather than being pre-answered wrongly.
//
// The `deal_`-prefixed keys are the columns added to the deals feed for this form
// (functions/getportaldeals/lib/portalDeals.js). The prefix is deliberate — it
// keeps the Seller Bridging readvance flow's payload unchanged; see the note in
// that file before renaming either side.
const AGENT_DEAL_CONDITION_ALIASES = [
  { alias: "attachment_on_property", dealKeys: ["deal_attachment_on_property"] },
  {
    alias: "Do_the_Bond_attorneys_have_Proceed_to_Lodge",
    dealKeys: ["deal_bond_attorneys_proceed_to_lodge"],
  },
  {
    alias: "seller_has_signed_transfer_documents",
    dealKeys: ["seller_has_signed_transfer_documents"],
  },
  {
    alias: "buyer_has_signed_transfer_documents",
    dealKeys: ["buyer_has_signed_transfer_documents"],
  },
  { alias: "guarantees_issued", dealKeys: ["guarantees_issued"] },
  {
    alias: "rates_clearance_certificate_obtained",
    dealKeys: ["rates_clearance_certificate_obtained"],
  },
  { alias: "transfer_duty_receipt_obtained", dealKeys: ["transfer_duty_receipt_obtained"] },
  { alias: "transfer_costs_paid", dealKeys: ["deal_transfer_costs_paid"] },
  {
    alias: "bond_cancellation_figures_obtained",
    dealKeys: ["bond_cancellation_figures_obtained"],
  },
  { alias: "attorneys_have_original_deed", dealKeys: ["attorneys_have_original_deed"] },
  { alias: "on_sell_transaction", dealKeys: ["deal_on_sell"] },
  { alias: "cash_in_trust", dealKeys: ["cash_in_trust"] },
  { alias: "estate_late_transaction", dealKeys: ["deal_estate_late"] },
  { alias: "related_parties", dealKeys: ["deal_related_parties"] },
  { alias: "sheriff_transfer", dealKeys: ["deal_sheriff_transfer"] },
];

const YES_VALUES = new Set(["yes", "y", "true", "1"]);
const NO_VALUES = new Set(["no", "n", "false", "0"]);

// Analytics exports CRM booleans as true/false and picklists as Yes/No. The form
// expects Yes/No, so normalise both; return "" for blanks and anything else (free
// text answers are never guessed at).
export function normalizeYesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (YES_VALUES.has(normalized)) return "Yes";
  if (NO_VALUES.has(normalized)) return "No";
  return "";
}

// The firm bank account the picker starts on — same precedence Quick Bridge uses
// (preferred Quick Rates bank → account default → first AVS-verified account).
export function resolveAgentDefaultBankDetailId(context) {
  const crm = context || {};
  const bankOptions = Array.isArray(crm.bankDetails) ? crm.bankDetails : [];
  return (
    crm.preferredQuickBridgeBank?.id || crm.defaultBankDetailId || bankOptions[0]?.id || ""
  );
}

// Locate a deal in the caller's own deals list (getportaldeals only ever returns
// deals this session is authorised to see, so a tampered dealId simply finds
// nothing and no deal values are prefilled).
export function findAgentDealById(deals, dealId) {
  const wanted = String(dealId || "").trim();
  if (!wanted) return null;
  const list = Array.isArray(deals) ? deals : [];
  return (
    list.find((deal) => {
      const id = deal?.deal_id ?? deal?.dealId ?? deal?.["Deal_Id"] ?? deal?.["Deal Id"];
      return String(id || "").trim() === wanted;
    }) || null
  );
}

// Payload for a first drawdown ("Add Agent Facility Drawdown" / the page's apply
// button). Identity fields come from the portal context, which getportalusercontext
// resolves from the AUTHENTICATED session's CRM Contact — never from the URL.
// `deal` is optional: supplied only when the drawdown is launched against an
// existing deal, in which case its ref number and transfer conditions prefill too.
export function buildAgentDrawdownPayload({ context, bankDetailId, deal } = {}) {
  const crm = context || {};

  const contactId =
    crm.contactId || crm.contact_id || crm.Contact_ID || crm.contact?.id || "";

  const payload = {
    // hidden fields
    contact_id: contactId,
    contact_email: crm.contactEmail || "",

    // CRM Bank Details record id — the picker only offers this account's
    // AVS-verified accounts, as surfaced by getportalusercontext.
    Firm_Bank_Details_id: bankDetailId || "",

    Initial_Advance_Further_Advance: AGENT_INITIAL_ADVANCE_VALUE,
  };

  if (!deal) return payload;

  const propertyRefNumber = String(
    deal.property_ref_number ?? deal.propertyRefNumber ?? deal["Property Ref Number"] ?? ""
  ).trim();
  if (propertyRefNumber) payload.property_ref_number = propertyRefNumber;

  AGENT_DEAL_CONDITION_ALIASES.forEach(({ alias, dealKeys }) => {
    const raw = dealKeys
      .map((key) => deal[key])
      .find((candidate) => candidate !== undefined && candidate !== null && String(candidate).trim() !== "");
    const normalized = normalizeYesNo(raw);
    if (normalized) payload[alias] = normalized;
  });

  return payload;
}

// Payload for a subsequent draw-down ("Agent Facility Readvance"). Opens the SAME
// form skipped to its last page via the Initial_Advance_Further_Advance dropdown,
// passing NO extra deal or firm information — the client only completes the final
// page.
export function buildAgentReadvancePayload() {
  return { Initial_Advance_Further_Advance: AGENT_FURTHER_ADVANCE_VALUE };
}
