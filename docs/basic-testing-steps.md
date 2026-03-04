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

