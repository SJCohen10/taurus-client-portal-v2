"use strict";

const { URL } = require("url");
const fetch = global.fetch || require("node-fetch");
const analyticsTokenManager = require("./analyticsTokenManager");
const { resolvePortalUserContextByEmail } = require("./portalUserContext");

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(current);
      current = "";
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    current += ch;
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1).map((values) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (values[idx] || "").trim();
    });
    return obj;
  });
}

function parseNumber(val) {
  if (val === undefined || val === null || val === "") return null;
  const numeric = Number(String(val).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(numeric) ? null : numeric;
}

function mapPortalDealRow(row) {
  const assetId =
    row["Asset Id"] ||
    row["Asset_Id"] ||
    row["Asset ID"] ||
    row["asset_id"] ||
    null;

  const assetCreatorId =
    row["Asset Creator ID"] ||
    row["Asset_Creator_ID"] ||
    row["Asset Creator Id"] ||
    null;

  const sellerAccountId = row["Seller_Account_Id"] || null;
  const sellerBankDetailId = row["Seller_Bank_Detail_Id"] || null;

  const accountId =
    row["Account_Id"] || row["Account Id"] || row["Account_ID"] || null;

  const propertyFolderId =
    row["Property Folder Id"] ||
    row["Property_Folder_Id"] ||
    row["Property Folder"] ||
    null;

  const assetIds =
    row["Asset IDs"] || row["Asset_IDs"] || row["Asset Ids"] || null;
  const assetTypes =
    row["Asset Types"] ||
    row["Asset_Types"] ||
    row["Asset types"] ||
    row["asset_types"] ||
    null;

  const assetCreatorIds =
    row["Asset Creator IDs"] || row["Asset_Creator_IDs"] || null;

  const currentBalance = parseNumber(row["Current Balance"]);
  const upsellAvailable = parseNumber(row["Upsell Available"]);

  const seller = row["Seller"] || row["seller"] || row["Seller Name"] || null;

  return {
    property_ref_number: row["Property Ref Number"] || null,
    transfer_duty_receipt_obtained: row["Transfer Duty Receipt Obtained"] || null,
    seller_has_signed_transfer_documents: row["Seller has signed transfer documents"] || null,
    guarantees_issued: row["Guarantees issued"] || null,
    rates_clearance_certificate_obtained: row["Rates Clearance Certificate Obtained"] || null,
    bond_cancellation_figures_obtained: row["Bond Cancellation Figures Obtained"] || null,
    buyer_has_signed_transfer_documents: row["Buyer has signed transfer documents"] || null,
    attorneys_have_original_deed: row["Attorneys are in possession of the original Deed"] || null,
    cash_in_trust: row["Cash in Trust"] || null,
    // Additional transfer-condition columns from Portal_Deals_View, added for the
    // Conveyancing Firm Agent Facility form. Header variants are listed
    // defensively (the view carries some CRM misspellings — "Sherriff",
    // "attatchment") so a corrected header keeps working.
    //
    // NB the deliberate `deal_` prefix: the Seller Bridging readvance flow
    // (client/src/pages/dashboard/components/DealActions.jsx › READVANCE_ONLY_
    // PREFILL_PARAM_MAP) probes the UNPREFIXED names. Those lookups have always
    // resolved to undefined, and the prefix keeps it that way so that flow's
    // payload is unchanged by this addition. Don't "tidy" the prefix away.
    deal_bond_attorneys_proceed_to_lodge:
      row["Do the Bond attorneys have Proceed to Lodge"] || null,
    deal_on_sell: row["On-Sell"] || row["On Sell"] || null,
    deal_transfer_costs_paid:
      row["Buyers have Paid Costs"] || row["Buyers have paid costs"] || null,
    deal_estate_late: row["Estate Late"] || null,
    deal_related_parties: row["Related Parties"] || null,
    deal_sheriff_transfer: row["Sherriff Transfer"] || row["Sheriff Transfer"] || null,
    deal_attachment_on_property:
      row["Is there an attatchment on the property"] ||
      row["Is there an attachment on the property"] ||
      null,
    property_description: row["Property Description"] || null,
    created_time: row["Created time"] || null,
    contact_email: row["Contact_Email"] || null,
    status: row["Status"] || null,
    amount: parseNumber(row["Amount"]),
    current_balance: currentBalance,
    upsell_available: upsellAvailable,
    lodged: row["Lodged"] || null,
    registered: row["Registered"] || null,
    asset_id: assetId,
    asset_creator_id: assetCreatorId,
    account_id: accountId,
    property_folder_id: propertyFolderId,
    asset_ids: assetIds,
    asset_types: assetTypes,
    asset_creator_ids: assetCreatorIds,
    seller_account_id: sellerAccountId,
    seller_bank_detail_id: sellerBankDetailId,
    deal_id: row["Deal_Id"] || null,
    expectedLodgementDate: row["Expected_Lodgement_Date"] || null,
    seller,
  };
}

async function fetchPortalDealsByCriteria({ accessToken, criteria }) {
  const base = process.env.ZOHO_ANALYTICS_BASE || "https://analyticsapi.zoho.com/api";
  const owner = process.env.ZOHO_ANALYTICS_OWNER;
  const db = process.env.ZOHO_ANALYTICS_DB;
  const table = process.env.ZOHO_ANALYTICS_PORTAL_DEALS_TABLE || "Portal_Deals_View";

  if (!owner || !db) {
    throw new Error("Missing Analytics env vars: ZOHO_ANALYTICS_OWNER, ZOHO_ANALYTICS_DB");
  }

  const url = new URL(`${base}/${encodeURIComponent(owner)}/${encodeURIComponent(db)}/${encodeURIComponent(table)}`);
  url.searchParams.set("ZOHO_ACTION", "EXPORT");
  url.searchParams.set("ZOHO_OUTPUT_FORMAT", "CSV");
  url.searchParams.set("ZOHO_ERROR_FORMAT", "JSON");
  url.searchParams.set("ZOHO_API_VERSION", "1.0");
  url.searchParams.set("ZOHO_CRITERIA", criteria);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });

  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const errJson = JSON.parse(trimmed);
      if (errJson.response && errJson.response.error) {
        const err = errJson.response.error;
        throw new Error(`Zoho Analytics error ${err.code || ""}: ${err.message || ""}`);
      }
    } catch (parseErr) {
      throw new Error(`Zoho Analytics returned JSON but parsing failed: ${parseErr.message}; raw=${trimmed}`);
    }
    throw new Error(`Unexpected JSON response from Analytics: ${trimmed}`);
  }

  return parseCsv(text);
}

function dedupeDealsById(deals) {
  const unique = [];
  const seen = new Set();

  for (const deal of deals) {
    const key = String(deal?.deal_id || "").trim();
    if (!key) {
      unique.push(deal);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(deal);
  }

  return unique;
}

async function getDealsForPortal({ email, requestId }) {
  const portalUser = await resolvePortalUserContextByEmail({ email, requestId });
  const resolvedAccountId = String(portalUser?.accountId || "").trim();
  const canViewFirmDeals = Boolean(portalUser?.canViewFirmDeals);
  const safeEmail = String(email || "").trim().toLowerCase();

  const accessToken = await analyticsTokenManager.getAccessToken({ requestId });

  const escapedEmail = safeEmail.replace(/'/g, "\\'");
  const myRows = safeEmail
    ? await fetchPortalDealsByCriteria({
      accessToken,
      criteria: `"Contact_Email"='${escapedEmail}'`,
    })
    : [];

  let firmRows = [];
  if (canViewFirmDeals && resolvedAccountId) {
    const escapedAccountId = resolvedAccountId.replace(/'/g, "\\'");
    firmRows = await fetchPortalDealsByCriteria({
      accessToken,
      criteria: `"Account_Id"='${escapedAccountId}'`,
    });
  }

  const normalizedMyDeals = myRows.map(mapPortalDealRow);
  const normalizedFirmDeals = firmRows.map(mapPortalDealRow);
  const dedupedDeals = dedupeDealsById([...normalizedMyDeals, ...normalizedFirmDeals]);

  console.log("[portalDeals] visibility resolved", {
    requestId,
    email: safeEmail,
    resolvedAccountId: resolvedAccountId || null,
    canViewFirmDeals,
    myDealsCount: normalizedMyDeals.length,
    firmDealsCount: normalizedFirmDeals.length,
    dedupedCount: dedupedDeals.length,
    first10DealIds: dedupedDeals.slice(0, 10).map((deal) => String(deal?.deal_id || "").trim()),
  });

  return dedupedDeals;
}

module.exports = {
  getDealsForPortal,
  mapPortalDealRow,
};
