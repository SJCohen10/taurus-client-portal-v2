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

function callbackToPromise(fn, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Catalyst auth callback timed out"));
      }
    }, timeoutMs);

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    try {
      fn(done);
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    }
  });
}

async function resolveCatalystCurrentUser() {
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
      try {
        const result = await callbackToPromise((done) => auth.isUserAuthenticated(done));
        if (result && typeof result === "object") return result;
      } catch {
        // fall through
      }
    }
  }

  if (auth.currentUser && typeof auth.currentUser === "object") {
    return auth.currentUser;
  }

  return null;
}

export async function resolveAuthenticatedPortalIdentity() {
  const catalystUser = await resolveCatalystCurrentUser();
  const portalUser = window?.portalUser || null;

  const email =
    extractEmail(catalystUser) ||
    extractEmail(catalystUser?.content) ||
    extractEmail(portalUser);

  const user = catalystUser || portalUser;
  return {
    user,
    email,
    source: extractEmail(catalystUser)
      ? "catalyst_auth"
      : extractEmail(portalUser)
      ? "window_portal_user"
      : "none",
  };
}
