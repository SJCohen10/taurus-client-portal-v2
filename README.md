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
│  │        ├─ Dashboard.jsx
│  │        └─ property/
│  │           └─ QuickRatesAdvance.jsx
│  ├─ package.json
│  └─ client-package.json     # Config for Catalyst React plugin
└─ functions/                 # Catalyst Node functions
   ├─ getportalusercontext/
   │  └─ index.js             # Fetch CRM Contact & Account by email
   ├─ authorization_portal_function/
   │  └─ index.js             # (Optional) custom signup validation
   └─ taurus_client_portal_function/
      └─ index.js             # (Optional) duplicate / legacy context function
