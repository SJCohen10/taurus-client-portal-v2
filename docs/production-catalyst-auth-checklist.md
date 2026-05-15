# Production Catalyst Auth Checklist

- Ensure the production custom domain `portal.tauruscapital.co.za` is mapped to the **production** Catalyst environment.
- Test Catalyst login directly at: `https://portal.tauruscapital.co.za/__catalyst/auth/login`.
- Ensure the deployed client and deployed functions are in the same production Catalyst environment.
- Verify `/server/getportalusercontext` receives Catalyst authenticated user context (`req.user` and/or Catalyst identity headers).
- If `req.user` is empty after successful login, treat it as a Catalyst function/auth configuration issue (not a CRM access-validation issue).
