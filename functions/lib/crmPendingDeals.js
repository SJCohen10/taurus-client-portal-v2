"use strict";

// Surfaces freshly-submitted deals that exist in Zoho CRM but have not yet
// synced into the Zoho Analytics export (Analytics syncs ~every 3h; Zoho Flow
// populates CRM Account/Deal/Asset/Transaction within ~3-5 min of submission).
//
// There is no "Pending Review" status on the Deal itself, so we DERIVE pending
// from the linked Transaction: a deal is pending until one of its transactions
// reaches PORTAL_TRANSACTION_PAID_STATUS ("Paid"). The relationship chain is:
//   Deal  <- Asset.Claim       (Asset links to Deal)
//   Asset <- Transaction.Asset (Transaction links to Asset)
//
// A paralegal is linked to a deal via Attorney or Attorney_Conveyancer; the firm
// (account) via Attorney_Firm. Rows are merged Analytics-first and deduped by
// deal_id, so once Analytics catches up the richer row replaces this one.
//
// NB: COQL here cannot SELECT lookup fields (Attorney/...) or the Single Line
// (Unique) field Deal_Reference_Number — so we scope ownership with two separate
// queries and omit the reference number (it appears once the deal syncs).

const { crmRequest } = require("./crm");
const { resolvePortalUserContextByEmail } = require("./portalUserContext");

const PENDING_WINDOW_HOURS = Number(process.env.PORTAL_PENDING_CRM_WINDOW_HOURS || 6);
const PAID_STATUS = String(process.env.PORTAL_TRANSACTION_PAID_STATUS || "Paid").trim().toLowerCase();
const MAX_IDS = 100;

function quoteIdList(ids) {
  return ids.map((id) => `'${String(id).replace(/'/g, "")}'`).join(",");
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? null : n;
}

async function coqlRows(selectQuery, requestId) {
  // crmRequest treats 2xx (incl. 204 "no rows") as success; data may be absent.
  try {
    const res = await crmRequest({ method: "POST", path: "/coql", body: { select_query: selectQuery }, requestId });
    return Array.isArray(res?.data) ? res.data : [];
  } catch (err) {
    if (err && !err.query) err.query = selectQuery;
    throw err;
  }
}

async function fetchPendingDealsFromCrm({ email, requestId }) {
  const safeEmail = String(email || "").trim().toLowerCase();
  const portalUser = await resolvePortalUserContextByEmail({ email: safeEmail, requestId });
  const contactId = String(portalUser?.contactId || "").trim();
  const accountId = String(portalUser?.accountId || "").trim();
  const canViewFirmDeals = Boolean(portalUser?.canViewFirmDeals);

  if (!contactId && !(canViewFirmDeals && accountId)) return [];

  const cutoffMs = Date.now() - PENDING_WINDOW_HOURS * 60 * 60 * 1000;
  const dealById = new Map();

  function addDealRow(row, isOwn) {
    const dealId = String(row.id || "").trim();
    if (!dealId) return;
    const createdMs = Date.parse(row.Created_Time || "");
    if (Number.isFinite(createdMs) && createdMs < cutoffMs) return; // outside window
    const existing = dealById.get(dealId);
    if (existing) {
      if (isOwn) existing.isOwn = true; // seen via both scopes -> treat as own
      return;
    }
    dealById.set(dealId, {
      deal_id: dealId,
      property_description: row.Property_Description || null,
      created_time: row.Created_Time || null,
      isOwn,
      asset_ids: [],
      amount: null,
      hasPaidTransaction: false,
    });
  }

  // Two separate scoped queries — each a COQL shape proven valid. The combined
  // single query (which also selected the lookup fields) is what COQL rejected.
  if (contactId) {
    const myRows = await coqlRows(
      `select id, Property_Description, Created_Time from Deals ` +
        `where (Attorney.id = '${contactId}' or Attorney_Conveyancer.id = '${contactId}') ` +
        `order by Created_Time desc limit 200`,
      requestId
    );
    for (const row of myRows) addDealRow(row, true);
  }
  if (canViewFirmDeals && accountId) {
    const firmRows = await coqlRows(
      `select id, Property_Description, Created_Time from Deals ` +
        `where Attorney_Firm.id = '${accountId}' order by Created_Time desc limit 200`,
      requestId
    );
    for (const row of firmRows) addDealRow(row, false);
  }

  if (!dealById.size) return [];

  const dealIds = Array.from(dealById.keys()).slice(0, MAX_IDS);

  // Enrich with assets -> transactions to derive pending state + amount.
  // Best-effort: on failure, deals still surface as pending with no amount.
  try {
    const assetRows = await coqlRows(
      `select id, Claim from Assets where Claim.id in (${quoteIdList(dealIds)}) limit 200`,
      requestId
    );
    const dealByAsset = new Map();
    for (const a of assetRows) {
      const assetId = String(a.id || "").trim();
      const dealId = String(a.Claim?.id || "").trim();
      if (!assetId || !dealById.has(dealId)) continue;
      dealByAsset.set(assetId, dealId);
      dealById.get(dealId).asset_ids.push(assetId);
    }

    const assetIds = Array.from(dealByAsset.keys()).slice(0, MAX_IDS);
    if (assetIds.length) {
      const txRows = await coqlRows(
        `select id, Asset, Current_Advance_Amount, Transaction_Status ` +
          `from Transactions where Asset.id in (${quoteIdList(assetIds)}) limit 200`,
        requestId
      );
      for (const t of txRows) {
        const assetId = String(t.Asset?.id || "").trim();
        const dealId = dealByAsset.get(assetId);
        if (!dealId || !dealById.has(dealId)) continue;
        const deal = dealById.get(dealId);
        const advance = toNumber(t.Current_Advance_Amount);
        if (advance !== null) deal.amount = (deal.amount || 0) + advance;
        if (String(t.Transaction_Status || "").trim().toLowerCase() === PAID_STATUS) {
          deal.hasPaidTransaction = true;
        }
      }
    }
  } catch (err) {
    console.warn("getportaldeals pending asset/transaction enrich failed", {
      requestId,
      statusCode: err?.statusCode,
      body: err?.body,
    });
  }

  const pending = [];
  for (const deal of dealById.values()) {
    if (deal.hasPaidTransaction) continue; // still pending until a transaction is Paid
    pending.push({
      deal_id: deal.deal_id,
      property_ref_number: null, // Deal_Reference_Number isn't COQL-selectable; fills in once Analytics syncs.
      property_description: deal.property_description,
      status: "Pending Review",
      amount: deal.amount,
      current_balance: null,
      upsell_available: null,
      created_time: deal.created_time,
      // Drives the dashboard My/Firm filter.
      contact_email: deal.isOwn ? safeEmail : "",
      account_id: accountId || null,
      asset_id: deal.asset_ids[0] || null,
      asset_ids: deal.asset_ids.join(","),
      seller: null,
      expectedLodgementDate: null,
      source: "crm_pending",
    });
  }
  return pending;
}

module.exports = { fetchPendingDealsFromCrm };
