# ROUTING_DEPLOYMENT_NOTES

## 1) Why refresh on nested routes caused a 404
The app uses React Router with `BrowserRouter` and a production basename of `/app`, so routes like `/app/seller-proceeds`, `/app/quick-rates`, and `/app/faq` are client-side routes. On browser refresh, Catalyst receives a direct HTTP request for those paths. Without an SPA fallback configured, hosting treats those as missing files and returns a 404 instead of serving the React entry point.

## 2) Which file/config fixes it
Updated `client/client-package.json` to add:

- `"404": "index.html"`

This tells Catalyst Web Client Hosting to serve `index.html` when a client-side route path under the hosted app would otherwise 404, allowing React Router to resolve the route in-browser.

## 3) How to test it after deployment
After deploying the client:

1. Open and sign in at `https://portal.tauruscapital.co.za/app/`.
2. Confirm in-app navigation works.
3. Hard refresh each URL directly in the browser:
   - `https://portal.tauruscapital.co.za/app/`
   - `https://portal.tauruscapital.co.za/app/seller-proceeds`
   - `https://portal.tauruscapital.co.za/app/quick-rates`
   - `https://portal.tauruscapital.co.za/app/faq`
4. Confirm each loads the SPA and renders the expected React page (not Catalyst 404).
5. Also verify canonicalization:
   - `https://portal.tauruscapital.co.za/app` should redirect to `/app/`.

## 4) Routes that must continue to bypass SPA fallback
These should continue to be handled by Catalyst platform routing (not React fallback):

- Function/API routes: `/server/*` (e.g. `/server/getportalusercontext`, `/server/getportaldeals`, `/server/uploaddealdocument`, `/server/generatestatement`)
- Catalyst auth/system routes: `/__catalyst/*` (e.g. `/__catalyst/auth/login`)
- Static asset paths (`/app/static/*`, manifest, icons, etc.)

If any of the above are unexpectedly returning `index.html`, validate Catalyst route precedence in hosting/gateway settings so platform routes are matched before client 404 handling.
