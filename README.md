# Taurus Client Portal

The Taurus Client Portal is a Zoho Catalyst–hosted web application that allows
conveyancing firms and other partners to:

- Log in via Zoho Catalyst Auth
- Load CRM context from Zoho CRM Sandbox based on the logged-in email
- Submit Quick Rates applications via an embedded Zoho Form, prefilled with
  CRM data (Contact + Account)

This repo contains both:

- The **React client** (in `client/`)
- The **Catalyst functions** (in `functions/`)

---

## Tech Stack

- **Frontend:** React (Create React App), React Router
- **Backend / Hosting:** Zoho Catalyst (functions + web client)
- **Auth:** Zoho Catalyst Auth (hosted login)
- **Data source:** Zoho CRM Sandbox via REST API
- **Forms:** Zoho Forms (Quick Rates application embedded via iframe)

---

## Project Structure

```text
Taurus-Client-Portal/
├─ catalyst.json              # Catalyst project config
├─ client/                    # React client source
│  ├─ public/
│  ├─ src/
│  │  ├─ App.js               # Router setup
│  │  ├─ Layout.jsx           # Shell + header + portal context provider
│  │  ├─ PortalContext.jsx    # React context for user + CRM data
│  │  ├─ components/
│  │  │  └─ QRFormEmbed.jsx   # Zoho Form iframe with prefill
│  │  └─ pages/
│  │     └─ forms/
│  │        ├─ Dashboard.jsx          # Legacy/unused (not routed)
│  │        └─ property/
│  │           ├─ QuickBridgeStart.jsx
│  │           ├─ QuickRatesAdvance.jsx
│  │           └─ SellerProceedsStart.jsx
│  ├─ package.json
│  └─ client-package.json     # Config for Catalyst React plugin
└─ functions/                 # Catalyst Node functions
   ├─ authorization_portal_function/
   │  └─ index.js             # Custom signup validation
   ├─ generatestatement/
   │  └─ index.js             # Generate statement link for deals
   ├─ getPortalUserContext/
   │  └─ index.js             # Fetch CRM Contact & Account by email
   ├─ getportaldeals/
   │  └─ index.js             # Load portal deals for the dashboard
   ├─ taurus_client_portal_function/
   │  └─ index.js             # Legacy context function
   └─ uploaddealdocument/
      └─ index.js             # Upload deal documents to WorkDrive

---

## Firm deals, document uploads, and statements

- **Firm deals:** The paralegal dashboard lists deals that belong to the logged-in
  user *and* their firm (Account) so one account can have many contacts.
- **Document uploads:** Deal documents are uploaded straight to Zoho WorkDrive.
  The function uses `ZOHO_WORKDRIVE_ROOT_FOLDER_ID` (or
  `ZOHO_WORKDRIVE_PARENT_FOLDER_ID`) as the parent folder. It will create a
  child folder named with the property reference number (and optional
  description) and upload the file there. The API response returns the target
  WorkDrive folder ID and file metadata for troubleshooting.
- **Statements:** The dashboard has a "View Statement" action that calls the
  `generatestatement` function. That function mirrors the Zoho CRM button logic
  to open the relevant Zoho Creator statement page for the asset type.

---

## How to test (non-expert friendly)

1. **Install dependencies**
   - Run `npm install` once at the repo root to install everything (server and
     client). This may take a few minutes the first time.
2. **Set environment variables for Catalyst functions**
   - Create a `.env` file in the repo root (or set environment variables in your
     runtime) with the following keys:
     - `ZOHO_WORKDRIVE_CLIENT_ID`, `ZOHO_WORKDRIVE_CLIENT_SECRET`,
       `ZOHO_WORKDRIVE_REFRESH_TOKEN` (for WorkDrive OAuth)
     - `ZOHO_WORKDRIVE_ROOT_FOLDER_ID` **or** `ZOHO_WORKDRIVE_PARENT_FOLDER_ID`
       (the WorkDrive folder under which property folders/files should live)
     - `ZOHO_WORKDRIVE_TEAM_ID` (optional, if your org requires a team header)
     - Any existing CRM/Creator auth variables you already use for other
       functions.
3. **Run the React app locally**
   - From the repo root run `npm start` to launch the client (defaults to
     `http://localhost:3000`).
   - Log in with a test portal user so the dashboard can load deals.
4. **Test document upload**
   - In the dashboard, pick a deal and click **Upload Document**.
   - Choose any small file; after upload you should see a success toast.
   - Confirm in Zoho WorkDrive that a folder named with the property reference
     number exists under your configured parent and the file appears inside.
5. **Test statement generation**
   - In the dashboard, click **View Statement** for a deal. A new browser tab
     should open to the Zoho Creator statement page that matches the asset type
     (Seller, Agent, Agency, Bond, LWB, RAFPAY, or AA). If the asset is missing
     a Creator ID, the UI will show an inline error.
6. **Run automated checks (optional)**
   - You can run the React test suite with `CI=true npm test -- --watch=false`.
     In this environment `react-scripts` may not be available, so a failure
     there is expected unless you install it.
