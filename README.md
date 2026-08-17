# Taurus Client Portal v2

Taurus Client Portal is a React + Zoho Catalyst application for conveyancing firms (primarily paralegal users today) to:

- view their deals (and optionally firm deals),
- open deal details in a modal,
- run deal actions (upload documents, generate statements, add notes, update expected lodgement date, readvance links),
- launch prefilled Zoho Forms for Quick Bridge and Seller Proceeds applications.

This README documents what currently exists in this repository (no assumed features).

---

## 1) What the app is (current scope)

### Primary user roles implemented today

- **Paralegal** dashboard is the only role-specific dashboard implemented in UI routing. Role selection defaults to `paralegal` if no role is present on `window.portalUser`. (`RoleBasedDashboard`) 
- Other role dashboards are commented placeholders only (agent/seller/RAF attorney).

### Main frontend routes/pages

- `/` and `/dashboard` → role-based dashboard (currently paralegal dashboard).
- `/quick-rates` → Quick Bridge Application (Zoho Form iframe with prefill).
- `/seller-proceeds` → Seller Proceeds Application (Zoho Form iframe with prefill).

### Key dashboard features (implemented)

- Deals table grouped by status buckets (Pending, Active, Closed, Other).
- Click row to open **Deal Details** modal (deal fields + related transactions table).
- Per-row **Actions** menu:
  - Upload Document (to WorkDrive via Catalyst function)
  - Generate Statement (Creator URL resolved from CRM Asset type)
  - Update Expected Lodgement Date (CRM Deal update)
  - Add Note (CRM Notes related record)
  - Readvance workflow (opens external Zoho form with prefilled query params)
- Per-row notification bell with current computed notification count (currently expected-lodgement-overdue only).

---

## 2) High-level architecture

- **Client:** React (Create React App) served by Catalyst client hosting.
- **Backend:** Zoho Catalyst Advanced I/O functions under `functions/`.
- **Systems integrated from functions/client:**
  - Zoho Analytics (deal list source)
  - Zoho CRM (contact/account context, notes, deals updates, transactions, bank details)
  - Zoho WorkDrive (document uploads)
  - Zoho Creator (statement deep-links)
  - Zoho Forms (Quick Bridge + Seller Proceeds forms, Agent referral form)

Request pattern used by the client:

- Production: client calls relative `/server/*` Catalyst routes.
- Local dev: client can call a remote Catalyst host via `REACT_APP_API_BASE`.

---

## 3) Backend functions in use

Configured in `catalyst.json`:

- `getportalusercontext` → resolves CRM contact/account context from email.
- `getportaldeals` → fetches Analytics deals CSV export and maps to client shape.
- `getdealtransactions` → fetches CRM transactions by Asset IDs.
- `uploaddealdocument` → uploads file to WorkDrive folder structure.
- `generatestatement` → resolves Creator statement page URL for asset type.
- `getbankdetailsforaccount` → returns CRM Bank_Details records.
- `createnote` → creates CRM related Note against Deal/Asset.
- `updateexpectedlodgementdate` → updates CRM Deal `Expected_Lodgement_Date`.

Also present but not part of main dashboard flow:

- `authorization_portal_function` (signup validation sample logic).
- `taurus_client_portal_function` (simple placeholder hello function).

---

## 4) Data model / Zoho Analytics mapping used for deals

`getportaldeals` calls Zoho Analytics Export API (CSV) with criteria:

- Owner match: `Contact_Email = email` **or** `Paralegal = email` **or** `Attorney_Conveyancer = email` — all three columns hold email addresses, and matching any one of them makes the deal the user's own ("My Deals").
- Firm match: `Account_Id = accountId`, only when the contact has `Can_View_Firm_Deals`.

The same owner-match list gates authorization in every action function (`updatematterlodged`, `uploaddealdocument`, `createnote`, …), which check the deal appears in `getDealsForPortal` before writing to CRM. Keep the `OWNER_EMAIL_COLUMNS` constant in step across the `lib/portalDeals.js` copies — a deal visible on the dashboard but absent from an action function's list returns 403.

Analytics table/view used:

- `ZOHO_ANALYTICS_PORTAL_DEALS_TABLE` (default `Portal_Deals_View`).

Mapped frontend deal fields returned by function:

- `property_ref_number` ← `Property Ref Number`
- `property_description` ← `Property Description`
- `created_time` ← `Created time`
- `contact_email` ← `Contact_Email`
- `paralegal` ← `Paralegal`
- `attorney_conveyancer` ← `Attorney_Conveyancer`
- `is_my_deal` ← computed server-side: true when the logged-in email matches any owner column above
- `status` ← `Status`
- `amount` ← `Amount` (parsed number)
- `current_balance` ← `Current Balance` (parsed number)
- `upsell_available` ← `Upsell Available` (parsed number)
- `lodged` ← `Lodged`
- `registered` ← `Registered`
- `asset_id`, `asset_ids`, `asset_creator_id`, `asset_creator_ids`
- `account_id`, `seller_account_id`
- `property_folder_id`
- `deal_id` ← `Deal_Id`
- `expectedLodgementDate` ← `Expected_Lodgement_Date`
- `seller` ← `Seller` (plus tolerant fallback to `seller`/`Seller Name`)

Client normalization:

- `portalApi` now normalizes incoming deals to canonical lowercase `seller` in frontend state while tolerating aliases (`Seller`, `seller`).

---

## 5) Auth/Login flow (what exists today)

### Identity source currently used by client

`PortalContext` resolves email in this order:

1. `window.portalUser` email variants (`email`, `email_id`, `user_mailid`, `user_email`)
2. **Dev-only impersonation env var** `REACT_APP_DEV_IMPERSONATE_EMAIL` (only in `NODE_ENV=development`)

Then it calls:

- `GET /server/getPortalUserContext?email=<resolvedEmail>`

### Hard-coded / insecure behavior audit result

- Prior hard-coded dev fallback email (`paralegal.sandbox@lawfirm.co.za`) was present in client code.
- This has been replaced with **explicit opt-in** dev impersonation env var `REACT_APP_DEV_IMPERSONATE_EMAIL`, disabled by default.
- If no identity is present and no dev impersonation is set, calls requiring email fail (as expected).

### Authorization enforcement status

- UI-level filtering uses `contact_email` / `account_id` from fetched deal payload.
- Hardened backend functions now enforce caller/request email match checks (and reject missing auth context in production) via shared helper patterns.
- Record-level access checks are implemented in the main deal action functions by resolving visible deals server-side.

### Production-safety requirements (remaining)

- Ensure Catalyst-authenticated caller headers/session are consistently available in all deployed environments (prod checks rely on authenticated context).
- Keep OAuth credentials server-side only and rotate tokens/secrets per internal policy.
- Continue validating any newly added endpoints against the same user-context and record-level authorization pattern.

---

6) Notifications (current implementation)

### What exists now

Notifications are loaded from **persisted Catalyst Data Store records** and merged with one computed client-side expected-lodgement signal in `DealActions`:

- Persisted notifications are fetched via `listnotifications` and can be marked read via `marknotificationread`.
- Client still computes one expected-lodgement-overdue notification and merges it with persisted notifications.
- Bell icon count reflects merged notifications.
- Popover actions can open Update Expected Lodgement Date or Add Note flows, and persisted rows are marked read on click when an id is present.

### Persistence status

Persisted notifications are supported in this repo via:

- `createnotification`
- `listnotifications`
- `marknotificationread`

The backing table is expected to be `portal_notifications` (name is env-configurable in `listnotifications`).

---


## Security hardening additions

- Client calls are now centralized through `client/src/api/catalystClient.js`; UI code only calls Catalyst `/server/*` endpoints.
- Shared server utilities now live in `functions/lib/`:
  - `crm.js` for server-side CRM token + request handling with timeout/retry.
  - `security.js` for CORS allowlist handling, auth context checks, request key whitelisting, and per-user rate limiting.
- Hardened functions (`createnote`, `updateexpectedlodgementdate`, `generatestatement`, `getbankdetailsforaccount`, `getportalusercontext`, `getdealtransactions`, `uploaddealdocument`) now enforce authenticated user context, input-key whitelists, and record-level access checks via portal deal mapping where applicable.
- `scripts/verify-security.sh` provides quick verification checks for client-side Zoho leakage, migrated inline OAuth removal checks, and a runtime negative test that extra request fields are rejected.

## Setup + testing guide

For a simple operational guide covering Catalyst env vars, Zoho OAuth clients/setup, and manual/security test steps, see:

- `docs/portal-testing-and-setup.md`
- `docs/basic-testing-steps.md` (very basic quick-start test checklist)

## 7) Environment variables

### Client (`client/.env` for local dev)

- `REACT_APP_API_BASE` (optional): Catalyst base host, e.g. `https://<project>.development.catalystserverless.com`
- `REACT_APP_DEV_IMPERSONATE_EMAIL` (optional, dev only): explicit local impersonation email. Disabled by default.

### Functions (Catalyst function env variables)

Common CRM OAuth:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_API_DOMAIN` (optional)
- `ZOHO_ACCOUNTS_URL` (optional)
- `ZOHO_CRM_VERSION` (optional)

Analytics (`getportaldeals`):

- `ZOHO_ANALYTICS_CLIENT_ID`
- `ZOHO_ANALYTICS_CLIENT_SECRET`
- `ZOHO_ANALYTICS_REFRESH_TOKEN`
- `ZOHO_ANALYTICS_OWNER`
- `ZOHO_ANALYTICS_DB`
- `ZOHO_ANALYTICS_BASE` (optional)
- `ZOHO_ANALYTICS_PORTAL_DEALS_TABLE` (optional, default `Portal_Deals_View`)

WorkDrive (`uploaddealdocument`):

- `ZOHO_WORKDRIVE_CLIENT_ID`
- `ZOHO_WORKDRIVE_CLIENT_SECRET`
- `ZOHO_WORKDRIVE_REFRESH_TOKEN`
- `ZOHO_WORKDRIVE_BASE` (optional)
- `ZOHO_WORKDRIVE_TEAM_ID` (optional)
- `ZOHO_WORKDRIVE_ROOT_FOLDER_ID` or `ZOHO_WORKDRIVE_PARENT_FOLDER_ID`
- `PORTAL_UPLOAD_FOLDER_NAME` (optional)
- `PORTAL_UPLOAD_MAX_BYTES` (optional)
- `PORTAL_UPLOAD_MAX_BODY_BYTES` (optional)

Creator statement URL:

- `ZOHO_CREATOR_STATEMENT_BASE` (optional)

---

## 8) Local development

Prerequisites observed in repo config:

- Node.js compatible with Catalyst function stacks (functions are configured with `node20`).
- npm
- Zoho Catalyst CLI (for serve/deploy workflows)

Install:

```bash
npm install
cd client && npm install
```

Run client locally:

```bash
cd client
npm start
```

Important local auth note:

- local React dev does not automatically provide Catalyst hosted `window.portalUser`.
- use `REACT_APP_DEV_IMPERSONATE_EMAIL` only for local development when needed.

Running functions locally is done through Catalyst CLI (`catalyst serve`) if configured in your environment.

---

## 9) Deploy

Catalyst project config is in `catalyst.json` with:

- client source: `client`
- functions source: `functions`

Typical deploy commands:

```bash
catalyst deploy functions
catalyst deploy client
# or full project:
catalyst deploy
```

(Use your team’s standard Catalyst environment promotion process where applicable.)

---

## 10) Data flow (deals → modal → actions)

1. Client resolves user email in `PortalContext`.
2. Client calls `getPortalUserContext` to load CRM user/account context.
3. Dashboard calls `getportaldeals` with `email` and/or `accountId`.
4. `getportaldeals` queries Zoho Analytics export API and maps rows to normalized deal objects.
5. Client renders table by status buckets.
6. Row click opens details modal using selected row data.
7. Modal and actions can trigger:
   - `getdealtransactions`
   - `updateexpectedlodgementdate`
   - `createnote`
   - `uploaddealdocument`
   - `generatestatement`

---

## 11) Known limitations / clarifications

- Some legacy/sample functions remain in repo (`authorization_portal_function`, `taurus_client_portal_function`) and are not part of the hardened portal API flow.
- `scripts/test-extra-fields-rejected.js` currently asserts a legacy error shape (`error`) while `updateexpectedlodgementdate` responds using an envelope (`message`/`details`) for failures.
- Role handling in UI currently defaults to paralegal.
