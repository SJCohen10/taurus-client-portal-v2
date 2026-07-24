// Agent Advance — shared helpers (feature gating, agent-deal detection, and
// launching the Zoho Form). This is the single source of truth reused by the
// standalone Agent Advance page, the dashboard filter/drill-in, and the per-deal
// actions button, so the gate + form wiring stay consistent.
//
// The form-launch helpers mirror the existing pattern in
// pages/dashboard/components/DealActions.jsx (buildZohoFormUrl + a centered
// popup with a new-tab fallback) so the Agent Advance form opens the same way as
// the "Generate Quote" / readvance flows. They are replicated here (not imported)
// to keep this change strictly additive and avoid altering the live DealActions.

// Agent Advance Zoho Form (New Conveyancer Agent Application).
// Full formperma URL so field prefill works. Prefill still depends on the form
// field aliases (payload KEYS) confirmed in the build*Payload functions below.
export const AGENT_ADVANCE_FORM_URL =
  "https://forms.zohopublic.com/tauruscapitalfinancegroup/form/NewConveyancerAgentApplication/formperma/ILW6tjeJvPBKoN7mw9xSWnC2jQe600R6YDg6BmqKbGw";

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

// Baseline payload for a first agent transaction ("Add Agent Transaction") and
// the standalone page's apply button. The VALUES are wired from portal context and
// ready; only the KEYS (Zoho Form field aliases) are placeholders.
//
// TODO(agent-advance): rename the keys below to the real Zoho Form field aliases
// for the baseline case, and confirm the full baseline field list.
export function buildAgentBaselinePayload(context) {
  const crm = context || {};
  const contactId = crm.contactId || crm.contact_id || crm.contact?.id || "";
  return {
    user_email: crm.contactEmail || "",
    product_type: "Agent Advance",
    contact_id: contactId,
    contact_email: crm.contactEmail || "",
    contact_name: crm.contactName || "",
    contact_first_name: crm.contactFirstName || "",
    contact_last_name: crm.contactLastName || "",
    contact_mobile: crm.contactMobile || "",
    portal_role: crm.portalRole || "",
    firm_name: crm.accountName || "",
    firm_reg_number: crm.firmRegNumber || "",
    account_email: crm.accountEmail || "",
    account_mobile: crm.accountMobile || "",
  };
}

// Payload for a subsequent draw-down ("Agent Readvance"). The deal already exists,
// so we pre-fill from it to minimise re-entry. Same key-placeholder caveat.
//
// TODO(agent-advance): rename keys to the real Zoho Form field aliases for the
// readvance case, and confirm exactly which existing-deal fields to pre-fill.
export function buildAgentReadvancePayload(deal, context) {
  const base = buildAgentBaselinePayload(context);
  const dealRef =
    deal?.property_ref_number ||
    deal?.["Property Ref Number"] ||
    deal?.deal_ref ||
    "";
  const dealId =
    deal?.deal_id || deal?.dealId || deal?.["Deal_Id"] || deal?.["Deal Id"] || "";
  return {
    ...base,
    Initial_Advance_Further_Advance: "Further Advance",
    Deal_Reference_Number: dealRef,
    deal_id: dealId,
    // TODO(agent-advance): confirm additional existing-deal fields to prefill, e.g.
    // asset_ids: deal?.asset_ids || "",
    // current_balance: deal?.current_balance || "",
  };
}

// Mirrors DealActions.jsx buildZohoFormUrl — sets each non-empty param on the URL.
export function buildZohoFormUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v);
    if (!s) return;
    url.searchParams.set(k, s);
  });
  return url.toString();
}

// Mirrors DealActions.jsx openPopupWithFallback — centered popup, new-tab fallback
// if the popup is blocked. Returns { opened, usedFallback }.
function openPopupWithFallback(url, { name = "taurus-agent-advance", width = 1100, height = 760 } = {}) {
  const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
  const dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || window.screen.width;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || window.screen.height;

  const left = Math.max(0, Math.round(dualScreenLeft + (viewportWidth - width) / 2));
  const top = Math.max(0, Math.round(dualScreenTop + (viewportHeight - height) / 2));

  const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`;
  const popup = window.open(url, name, features);
  if (popup) return { opened: true, usedFallback: false };

  const fallback = window.open(url, "_blank", "noopener,noreferrer");
  return { opened: Boolean(fallback), usedFallback: Boolean(fallback) };
}

// Open the Agent Advance Zoho Form with the given payload (popup, new-tab fallback).
export function openAgentAdvanceForm(payload) {
  const url = buildZohoFormUrl(AGENT_ADVANCE_FORM_URL, payload);
  return openPopupWithFallback(url, { name: "taurus-agent-advance", width: 1200, height: 860 });
}
