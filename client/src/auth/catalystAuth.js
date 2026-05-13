function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function extractEmail(candidate) {
  if (!candidate || typeof candidate !== "object") return "";
  return normalizeEmail(
    candidate.email ||
      candidate.email_id ||
      candidate.user_mailid ||
      candidate.user_email ||
      candidate.primary_email ||
      candidate.mail
  );
}

function isRetryableAuthFailure(error) {
  const code = error?.data?.error_code || error?.error_code;
  return code === "AUTHENTICATION_FAILURE";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCatalystAuthReady({ timeoutMs = 5000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window?.catalyst?.auth) return { status: "authenticated" };
    await sleep(intervalMs);
  }
  return { status: "auth_unavailable" };
}

async function resolveCatalystCurrentUser({ timeoutMs = 2500 } = {}) {
  const ready = await waitForCatalystAuthReady({ timeoutMs });
  if (ready.status === "auth_unavailable") return { status: "auth_unavailable", user: null };

  const auth = window?.catalyst?.auth;
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    attempt += 1;
    try {
      if (typeof auth?.getCurrentUser === "function") {
        const user = await auth.getCurrentUser();
        if (user) return { status: "authenticated", user };
      }

      if (typeof auth?.isUserAuthenticated === "function") {
        const result = await auth.isUserAuthenticated();
        if (result && typeof result === "object") return { status: "authenticated", user: result };
      }

      if (auth?.currentUser && typeof auth.currentUser === "object") {
        return { status: "authenticated", user: auth.currentUser };
      }
    } catch (error) {
      if (!isRetryableAuthFailure(error) || Date.now() - start >= timeoutMs) {
        return { status: isRetryableAuthFailure(error) ? "unauthenticated" : "error", user: null, error };
      }
    }

    await sleep(Math.min(100 * 2 ** (attempt - 1), 500));
  }

  return { status: "unauthenticated", user: null };
}

export async function resolveAuthenticatedPortalIdentity() {
  const portalUser = window?.portalUser || null;
  const identity = await resolveCatalystCurrentUser();
  const catalystUser = identity.user;

  const catalystEmail = extractEmail(catalystUser);
  const catalystContentEmail = extractEmail(catalystUser?.content);
  const portalUserEmail = extractEmail(portalUser);
  const email = catalystEmail || catalystContentEmail || portalUserEmail;

  const source = catalystEmail
    ? "catalyst_auth"
    : catalystContentEmail
      ? "catalyst_auth_content"
      : portalUserEmail
        ? "window_portal_user"
        : "none";

  const user = source === "catalyst_auth_content" ? catalystUser?.content || catalystUser || portalUser : catalystUser || portalUser;

  return {
    user,
    email,
    source,
    readinessStatus: identity.status,
  };
}
