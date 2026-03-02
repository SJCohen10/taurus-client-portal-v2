#!/usr/bin/env bash
set -euo pipefail

echo "Checking client for direct Zoho API/OAuth usage..."
if rg -n "zohoapis|Zoho-oauthtoken|oauth/v2/token|refresh_token|client_secret|ZohoCRM\.modules\.ALL" client/src; then
  echo "Found disallowed client usage" >&2
  exit 1
fi

echo "Checking update endpoint rejects unexpected fields (static check)..."
rg -n "assertAllowedKeys\(body, \[\"email\", \"dealId\", \"expectedLodgementDate\"\]\)" functions/updateexpectedlodgementdate/index.js

echo "Security verification checks passed."
