#!/usr/bin/env bash
set -euo pipefail

echo "Checking client for direct Zoho API/OAuth usage..."
if rg -n "zohoapis|Zoho-oauthtoken|oauth/v2/token|refresh_token|client_secret|ZohoCRM\.modules\.ALL" client/src; then
  echo "Found disallowed client usage" >&2
  exit 1
fi

echo "Checking migrated functions no longer contain inline refresh token payload handling..."
if rg -n "refresh_token|client_secret|oauth/v2/token" functions/getPortalUserContext/index.js functions/getdealtransactions/index.js; then
  echo "Found inline OAuth handling in migrated CRM functions" >&2
  exit 1
fi

echo "Checking update endpoint rejects unexpected fields..."
node scripts/test-extra-fields-rejected.js

echo "Security verification checks passed."
