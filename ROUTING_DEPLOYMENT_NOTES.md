# ROUTING_DEPLOYMENT_NOTES

## Why BrowserRouter caused 404s on Catalyst
`BrowserRouter` uses real path URLs (for example `/app/seller-proceeds`). On refresh, Zoho Catalyst hosting receives that exact path as a file request. Catalyst hosting does not provide SPA rewrite fallback for these nested React paths, so it returns its platform 404 page.

## Why Catalyst rejected `"404": "index.html"`
Catalyst client hosting rejects mapping the 404 page to the same file as the home page. Attempting to set:

```json
{
  "404": "index.html"
}
```

produces the Catalyst validation error: `404 cannot be same as the HOME page: index.html`.

## Why HashRouter solves it
`HashRouter` keeps the route after `#` (fragment), so the server only receives `/app/` and never sees nested client routes. The browser handles `#/seller-proceeds`, `#/quick-rates`, etc., fully on the client side. That avoids refresh 404s on Catalyst.

## Final URL structure
After this change, portal routes are hash-based:

- `/app/#/`
- `/app/#/seller-proceeds`
- `/app/#/quick-rates`
- `/app/#/faq`

## What changed
- `App.js` now uses `HashRouter` globally (no BrowserRouter dev/prod split).
- Login redirects now run consistently from the app shell and `/login` route, using the same Catalyst login URL builder flow.
- Auth redirect URL builders generate Catalyst-safe hash URLs under `/app/#/...`.
- Safe `service_url` handling preserves the intended hash route for post-login return.
- Production canonical redirect normalizes `/`, `/app`, and `/app/` to hash URLs.
- Removed invalid Catalyst client config key `"404": "index.html"` from `client/client-package.json`.

## How to test after deployment
1. Open `https://portal.tauruscapital.co.za/app/#/` and authenticate.
2. Verify internal navigation using menu/links and buttons.
3. Hard refresh each route:
   - `https://portal.tauruscapital.co.za/app/#/`
   - `https://portal.tauruscapital.co.za/app/#/seller-proceeds`
   - `https://portal.tauruscapital.co.za/app/#/quick-rates`
   - `https://portal.tauruscapital.co.za/app/#/faq`
4. Paste each route directly into a new tab and confirm it loads correctly.
5. Verify back/forward browser navigation between pages.
6. Confirm auth redirects return to `#/` or the requested hash route after login.
7. Re-test API-backed pages/actions (dashboard, statements, notifications, uploads) to confirm no server route regressions.
