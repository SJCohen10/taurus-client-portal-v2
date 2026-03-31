# Basic Step-by-Step: How to Test the App

This is the **quick version** you can follow without deep technical setup.

## Before you start

1. Open the repo root in terminal.
2. Make sure you have Node.js installed.
3. Make sure your Catalyst function environment variables are set (especially Zoho OAuth vars).

---

## Step 1: Install dependencies

From repo root:

```bash
npm install
```

From client folder:

```bash
cd client
npm install
cd ..
```

---

## Step 2: Run a quick security check

From repo root:

```bash
./scripts/verify-security.sh
```

If this fails, stop and fix those issues first.

---

## Step 3: Start the app (frontend)

```bash
cd client
npm start
```

Open the URL shown in terminal (usually `http://localhost:3000`).

---

## Step 4: Sign in and do a basic user flow

1. Log in as a normal portal user.
2. Open the dashboard.
3. Open one deal.
4. Try these actions:
   - Add a note.
   - Upload a document.
   - Generate statement link.
   - Update expected lodgement date.

Expected: allowed records should work with no 500 errors.

---

## Step 5: Do one simple authorization check

Use browser devtools and tamper one request with another deal/asset ID.

Expected: request should be rejected (`403`) if that record is not allowed.

---

## Step 6: Check network boundary

In browser devtools → Network:

- Confirm app calls go to Catalyst `/server/*` endpoints.
- Confirm browser is **not** calling Zoho APIs directly.

---

## Step 7: If you see errors

### If error says `Cannot find module ...`
- This is a function packaging/import issue, not usually a missing env var.
- Redeploy functions after code updates:

```bash
catalyst deploy functions
```

### If error says `Execution Time Exceeded`
- Check external Zoho response times.
- Check function logs in Catalyst for the slow endpoint.
- Retry with smaller payloads where possible (especially uploads).

---

## Step 8: Deploy after successful checks

```bash
catalyst deploy functions
cd client
npm run build
```

Then deploy/upload client build as your normal Catalyst process.


---

## Step 9: Focused login test plan (recommended)

Use this if login is the one area you have not tested yet.

### 9.1 Positive login path

1. Open the portal in a fresh private/incognito browser window.
2. Sign in with a known portal user that has at least one deal.
3. Confirm the first request to `/server/getportalusercontext` returns `200`.
4. Confirm the dashboard loads with the expected user context (name/email/account) and deals.

### 9.2 Missing identity behavior

1. In local development, remove any `REACT_APP_DEV_IMPERSONATE_EMAIL` from `client/.env`.
2. Reload the app without a real portal-authenticated session.
3. Confirm context load fails safely (no data leakage) and the UI does not show another user's deals.

### 9.3 Identity mismatch protection

1. Open devtools network tab.
2. Re-run or replay `getportalusercontext` with a different `email` query value than the authenticated user.
3. Expected result: function rejects with `403` (`User mismatch`) when authenticated headers are present.

### 9.4 Production behavior expectation

In production (`NODE_ENV=production`), requests with no authenticated user context should be rejected (`401`).

### 9.5 Quick local smoke script

Run this to verify the frontend identity resolution fallback order:

```bash
cd client
npm test -- --watchAll=false --runInBand App.test.js
```
