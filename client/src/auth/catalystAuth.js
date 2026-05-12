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

function waitForCatalystAuth(timeoutMs = 4000) {
  if (window?.catalyst?.auth) return Promise.resolve();

  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (window?.catalyst?.auth || Date.now() - start >= timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

async function resolveCatalystCurrentUser() {
  await waitForCatalystAuth();
  const auth = window?.catalyst?.auth;
  if (!auth) return null;

  if (typeof auth.getCurrentUser === "function") {
    try {
      const user = await auth.getCurrentUser();
      if (user) return user;
    } catch {
      // fall through
    }
  }

  if (typeof auth.isUserAuthenticated === "function") {
    try {
      const result = await auth.isUserAuthenticated();
      if (result && typeof result === "object") return result;
    } catch {
    }
  }

  if (auth.currentUser && typeof auth.currentUser === "object") {
    return auth.currentUser;
  }

  return null;
}

export async function resolveAuthenticatedPortalIdentity() {
  const catalyst = window?.catalyst;
  const auth = catalyst?.auth;
  const portalUser = window?.portalUser || null;
  const debugState = {
    catalystExists: Boolean(catalyst),
    catalystAuthExists: Boolean(auth),
    getCurrentUserExists: typeof auth?.getCurrentUser === "function",
    isUserAuthenticatedExists: typeof auth?.isUserAuthenticated === "function",
    authCurrentUserExists: Boolean(auth?.currentUser),
    portalUserExists: Boolean(portalUser),
  };

  const catalystUser = await resolveCatalystCurrentUser();
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

  const user =
    source === "catalyst_auth_content"
      ? catalystUser?.content || catalystUser || portalUser
      : catalystUser || portalUser;

  console.debug("[PortalAuth] Identity resolution", {
    ...debugState,
    source,
    emailFound: Boolean(email),
    email,
  });

  return {
    user,
    email,
    source,
  };
}
