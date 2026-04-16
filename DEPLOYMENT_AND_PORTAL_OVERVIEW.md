# Taurus Client Portal – Deployment and Solution Overview

## Executive Summary
The Taurus Client Portal is a secure web portal that allows external legal and conveyancing stakeholders to manage and track deal activity with Taurus Capital through a single digital interface. The current solution is built with a React frontend hosted in Zoho Catalyst and a set of Catalyst serverless functions that integrate with Zoho CRM, Zoho Analytics, Zoho WorkDrive, Zoho Creator, and Zoho Forms.

The portal exists to reduce email-driven back-and-forth, improve transparency for clients, and provide faster operational turnaround on critical deal actions (for example document uploads, lodgement updates, and statement access). The primary live user experience in this repository is paralegal-focused, with role-based framework support in place for further expansion.

For Taurus Capital, the platform provides improved operational consistency, auditability, and controlled self-service for clients. For clients (attorneys/firms), it provides better visibility, faster actioning, and clearer communication on deal progress.

## Business Purpose
The portal addresses several common business pain points:

- Limited client visibility into deal progress.
- Slow manual handling of routine actions (notes, updates, document handling).
- Fragmented systems where users must rely on internal staff for status checks.
- Risk of delays caused by communication overhead and missing context.

By consolidating key workflows into a secured client-facing portal, Taurus Capital can:

- Improve client confidence through transparent status and transaction visibility.
- Reduce repetitive internal servicing work for routine requests.
- Standardize data capture and action flows into existing Zoho systems.
- Improve response speed for critical actions in active matters.

## Key Portal Functions
The current repository implements the following key capabilities:

- **Secure client access and context resolution** using authenticated portal user context (with strict production checks in backend functions).
- **Deal dashboard visibility** with grouping by status and detail drilldown.
- **Deal status tracking** including key fields such as lodged/registered and expected lodgement date.
- **Notes and communication support** via CRM note creation and notifications.
- **Expected lodgement date updates** with server-side authorization and CRM update.
- **Matter lodged action** (mark as lodged + set lodgement date) with authorization checks.
- **Document uploads** to WorkDrive with file type and payload controls.
- **Statement generation** with asset-type-driven Creator destination routing.
- **Quote/form launching** via integrated Zoho Forms links/iframes where applicable.
- **Notifications and reminders** via Catalyst Data Store-backed notification endpoints and UI notification flows.
- **Readvance / submission support** through dashboard actions and prefilled forms.

Where functionality depends on external Zoho configuration (for example table names, OAuth setup, Creator page configuration), behavior is environment-dependent and should be validated in production-like staging before go-live.

## Solution Overview
At a high level, users access the React portal, which calls Catalyst `/server/*` endpoints. Those endpoints enforce user context and action-level authorization, then broker data/actions to Zoho backend systems.

- **Frontend app (React):**
  - Routes users to the dashboard and related forms.
  - Displays deals, transactions, and actions.
  - Calls only Catalyst server endpoints for backend operations.

- **Catalyst backend functions:**
  - Resolve authenticated portal context.
  - Enforce access control at request and deal scope.
  - Perform API interactions with CRM/Analytics/WorkDrive/Creator.
  - Handle updates (notes, dates, lodged status) and uploads.

- **Zoho CRM:**
  - System of record for contact/account context and core deal updates.
  - Used for notes, transactions, account/bank context, and deal field writes.

- **Zoho Analytics:**
  - Provides filtered portal deal views used to determine deal visibility and list content.

- **Zoho WorkDrive:**
  - Stores uploaded deal documents via server-side upload handling.

- **Zoho Creator:**
  - Hosts statement pages; function returns a statement destination URL based on asset type.

- **Zoho Forms:**
  - Supports external form launch flows (for example quick-rates and seller-proceeds flows).

## Architecture Overview
The portal follows a layered architecture that keeps direct third-party credentials and privileged API calls on the server side.

```text
User Browser
  -> React Client Portal (Catalyst-hosted)
    -> Catalyst Serverless Functions (/server/*)
      -> Zoho CRM (records/updates/context)
      -> Zoho Analytics (deal visibility dataset)
      -> Zoho WorkDrive (document storage)
      -> Zoho Creator (statement pages)
      -> Zoho Forms (external submission flows)
```

This model supports controlled integration, cleaner security boundaries, and clearer operational ownership.

## Environment and Setup Requirements
A production deployment requires:

- Zoho Catalyst project/environment with client hosting and all required functions deployed.
- OAuth clients/tokens configured server-side for:
  - CRM access
  - Analytics access
  - WorkDrive access
- Connected Zoho services and data model alignment (CRM modules, Analytics view/table, Data Store table, WorkDrive folder structure, Creator page access).
- Frontend environment configuration for API base behavior (development only) and optional development impersonation.
- Domain and allowlist settings for:
  - CORS allowed origins where configured
  - OAuth client redirect/authorized domains
  - Any portal-hosted domain assumptions

Configuration relies on environment variables. Only categories should be managed in deployment documentation and secret management; no secrets should be hardcoded in source or release notes.

## Security and Access Model
The current implementation uses a server-mediated security approach:

- Frontend calls Catalyst endpoints rather than direct OAuth-protected Zoho APIs.
- Backend functions enforce authenticated user context checks, including production behavior that rejects missing authenticated context.
- Sensitive integrations (OAuth refresh/access logic) remain server-side.
- Key mutation actions (uploads, notes, statement access, date updates, matter lodged updates) include deal-level authorization checks against visible deals.
- Upload handling includes payload key whitelisting, mime-type constraints, body/file size limits, and rate limiting controls.
- Rate limiting is applied per-user on multiple endpoints to reduce abuse risk.

This creates a practical balance of client usability and controlled backend authorization without exposing credentials in the browser.

## Deployment Approach
Recommended deployment approach:

1. Deploy functions and client into a controlled production environment via Catalyst deployment process.
2. Verify all required environment variables and service credentials before opening access.
3. Execute focused end-to-end smoke testing across critical user journeys.
4. Start with a pilot/phased release (limited user cohort), then widen rollout after operational confirmation.
5. Assign clear post-go-live ownership for:
   - Environment configuration changes
   - Incident triage/support
   - Monitoring of function errors/timeouts and integration health

## Risks and Operational Considerations
Primary operational risks to manage:

- **External dependency risk:** Availability/performance of Zoho services (CRM/Analytics/WorkDrive/Creator) directly impacts portal behavior.
- **OAuth and environment dependency risk:** Misconfigured tokens, scopes, or variable names can break flows.
- **Permissions/visibility risk:** Incorrect CRM contact/account relationships or role flags can affect deal visibility.
- **Upload/processing risk:** Large files, folder configuration mismatches, and service latency can affect upload reliability.
- **Function timeout/concurrency risk:** Certain flows already include timeout controls; monitor for production latency and adjust budgets where required.
- **Operational support risk during rollout:** Early-stage usage may surface edge-case data conditions requiring rapid support response.

## Recommended Go-Live Checklist
- Confirm all Catalyst functions listed in `catalyst.json` are deployed to production.
- Confirm all required OAuth/environment variables are present and correct for each function.
- Validate authenticated portal user context is present in production requests.
- Validate deal authorization behavior for:
  - User with own deals only
  - User allowed to view firm deals
- Test critical flows end-to-end:
  - Deal load and detail modal
  - Upload document
  - Generate statement
  - Create note
  - Update expected lodgement date
  - Mark matter lodged
  - Notifications list/read/create paths
- Confirm WorkDrive root folder and per-deal folder behavior.
- Confirm Creator statement destination pages are accessible and mapped as expected.
- Confirm Analytics view/table and column mapping alignment.
- Confirm monitoring/log access and on-call support process for launch window.

## Conclusion
The Taurus Client Portal repository reflects a mature pre-production implementation with clear separation between frontend presentation and server-side integrations. With environment configuration validated, critical flow smoke tests completed, and controlled rollout governance in place, the solution is positioned for production use with manageable operational risk.
