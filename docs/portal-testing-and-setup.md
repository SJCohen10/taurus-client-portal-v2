# Portal Testing + Setup Guide (Simple)

This guide explains:

1. Which **Catalyst environment variables** you need.
2. Which **Zoho OAuth clients / refresh tokens** you need.
3. A simple **step-by-step test plan** for the hardened portal architecture.

---

## 1) Architecture rule (must stay true)

- The **React client must only call Catalyst endpoints** (`/server/*`).
- The browser must **never** call Zoho CRM APIs directly.
- OAuth tokens, client secrets, and refresh tokens must stay **server-side only** in Catalyst environment variables (or Catalyst Connections).

Quick check command:

```bash
./scripts/verify-security.sh
```

---

## 2) Catalyst environment variables

Set these in Catalyst Console for each environment (Development / Production).

## 2.1 Core CRM OAuth (used by CRM-related functions)

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `ZOHO_ACCOUNTS_URL` (optional, default `https://accounts.zoho.com`)
- `ZOHO_API_DOMAIN` (optional, default from token response)
- `ZOHO_CRM_VERSION` (optional, e.g. `v8`)

## 2.2 WorkDrive OAuth (used by upload function)

- `ZOHO_WORKDRIVE_CLIENT_ID`
- `ZOHO_WORKDRIVE_CLIENT_SECRET`
- `ZOHO_WORKDRIVE_REFRESH_TOKEN`
- `ZOHO_WORKDRIVE_BASE` (optional, default `https://www.zohoapis.com/workdrive/api/v1`)
- `ZOHO_WORKDRIVE_TEAM_ID` (optional; required in some WorkDrive org setups)

## 2.3 Analytics OAuth + config (used by portal-deal mapping functions)

- `ZOHO_ANALYTICS_CLIENT_ID`
- `ZOHO_ANALYTICS_CLIENT_SECRET`
- `ZOHO_ANALYTICS_REFRESH_TOKEN`
- `ZOHO_ANALYTICS_OWNER`
- `ZOHO_ANALYTICS_DB`
- `ZOHO_ANALYTICS_BASE` (optional, default analytics API base)
- `ZOHO_ANALYTICS_PORTAL_DEALS_TABLE` (optional, default `Portal_Deals_View`)

## 2.4 Security / app hardening settings

- `PORTAL_ALLOWED_ORIGINS`
  - Comma-separated list of exact allowed portal origins.
  - Example: `https://portal.example.com,https://staging-portal.example.com`
- `STATEMENT_SIGNING_SECRET`
  - Random strong secret used to sign short-lived statement tokens.
- `NODE_ENV=production` in production deployments.

## 2.5 Upload behavior settings (optional but recommended)

- `PORTAL_UPLOAD_FOLDER_NAME` (default `Portal Document Uploads`)
- `PORTAL_UPLOAD_MAX_BYTES` (default `10485760`)
- `PORTAL_UPLOAD_MAX_BODY_BYTES` (default `14680064`)
- `ZOHO_WORKDRIVE_ROOT_FOLDER_ID` (or equivalent root folder env used by your setup)

---

## 3) Zoho OAuth clients you should create

Use dedicated clients and least privilege scopes. Prefer one “portal API user” with restricted profile/role.

## 3.1 CRM OAuth client

Create a server-side OAuth client for CRM usage.

Recommended scope approach:
- Keep read scopes for required modules.
- Add write scopes only if strictly needed by:
  - expected lodgement date update
  - note creation
  - any other approved write flow

Typical scope examples (adapt to your actual module/API use):
- `ZohoCRM.modules.READ`
- `ZohoCRM.modules.deals.READ`
- `ZohoCRM.modules.deals.UPDATE`
- `ZohoCRM.modules.notes.CREATE`

> Avoid broad all-access scopes when module-level scopes are possible.

## 3.2 WorkDrive OAuth client

Create a separate OAuth client for WorkDrive upload flow with minimal file/folder scopes needed for:
- searching/creating folders
- uploading files

## 3.3 Analytics OAuth client

Create a separate OAuth client for Analytics export access used by `Portal_Deals_View` reads.

---

## 4) How to get refresh tokens (simple flow)

For each OAuth client (CRM / WorkDrive / Analytics):

1. Generate an authorization code with the right scopes.
2. Exchange code for access + refresh token.
3. Save refresh token only in Catalyst environment variables.
4. Never expose refresh tokens to React client.

If you rotate credentials, update Catalyst env vars and redeploy functions.

---

## 5) Client environment variables (local dev)

In `client/.env`:

- `REACT_APP_API_BASE` (optional in local dev, points to Catalyst base URL)
- `REACT_APP_DEV_IMPERSONATE_EMAIL` (optional, development only)

Do not place any Zoho secret/token variables in client `.env`.

---

## 6) Simple test checklist

Run these in repo root.

## 6.1 Static security checks

```bash
./scripts/verify-security.sh
```

Expected:
- client has no direct `zohoapis`/OAuth patterns.
- migrated functions do not contain inline OAuth refresh token payload handling.
- update endpoint rejects unexpected keys test passes.

## 6.2 Syntax checks

```bash
node --check functions/lib/crm.js
node --check functions/lib/security.js
node --check functions/getPortalUserContext/index.js
node --check functions/getdealtransactions/index.js
node --check functions/uploaddealdocument/index.js
node --check functions/createnote/index.js
node --check functions/updateexpectedlodgementdate/index.js
node --check functions/generatestatement/index.js
node --check functions/getbankdetailsforaccount/index.js
```

## 6.3 Manual functional tests (portal user)

Use a real portal user account that has restricted CRM permissions.

1. **Login and dashboard load**
   - Confirm app loads deals normally.

2. **Network boundary check (important)**
   - In browser devtools → Network:
   - Confirm requests are only to your portal/Catalyst `/server/*` routes.
   - Confirm no browser request goes to `zohoapis` domains.

3. **Record-level read authorization**
   - Open a deal you should have access to: success.
   - Try forcing another deal/asset ID (tamper request): expect `403`.

4. **Deal field update security**
   - Valid update of expected lodgement date: success.
   - Tamper payload by adding extra keys: expect rejection (`400`).
   - Try updating unauthorized deal ID: expect `403`.

5. **Note creation security**
   - Create note on allowed deal/asset: success.
   - Oversized or invalid content: expect validation rejection.
   - Unauthorized record ID: expect `403`.

6. **Generate statement security**
   - POST should return short-lived statement URL token route.
   - Open token URL promptly: should redirect.
   - Reuse after expiry: should fail (`401`/invalid token behavior).

7. **Upload document security**
   - Upload valid file to allowed deal: success.
   - Invalid mime/base64/oversize: validation rejection.
   - Tampered unauthorized dealId: expect `403`.

8. **CORS check**
   - From allowed portal domain: requests succeed.
   - From non-allowed origin: browser should block by CORS policy.

9. **Rate limit check**
   - Burst repeated calls to same endpoint/user.
   - Confirm rate-limit response (`429`) once threshold exceeded.

---

## 7) Definition of done for secure deployment

You are done when all are true:

- Client only calls Catalyst `/server/*`.
- No Zoho OAuth tokens/secrets in client code or client env.
- CRM/WorkDrive/Analytics tokens stored server-side in Catalyst env vars (or Connections).
- Record-level checks block unauthorized IDs.
- Update/note endpoints reject extra/unexpected keys.
- Statement endpoint uses short-lived signed flow.
- CORS allowlist and rate limiting are active.
- `./scripts/verify-security.sh` passes in CI/deploy pipeline.
