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
    if (window?.catalyst?.auth) return { status: "ready" };
    await sleep(intervalMs);
  }
  return { status: "auth_unavailable" };
}

export async function resolveCatalystSessionStatus({ timeoutMs = 4000 } = {}) {
  const ready = await waitForCatalystAuthReady({ timeoutMs: 5000 });
  if (ready.status !== "ready") return { status: "auth_unavailable" };

  const auth = window?.catalyst?.auth;
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    attempt += 1;
    try {
      if (typeof auth?.isUserAuthenticated === "function") {
        const result = await auth.isUserAuthenticated();
        if (result) return { status: "authenticated", source: "isUserAuthenticated" };
      }

      if (typeof auth?.getCurrentUser === "function") {
        const user = await auth.getCurrentUser();
        if (user) return { status: "authenticated", source: "getCurrentUser" };
      }

      if (auth?.currentUser && typeof auth.currentUser === "object") {
        return { status: "authenticated", source: "currentUser" };
      }
    } catch (error) {
      if (!isRetryableAuthFailure(error)) return { status: "error", error };
    }

    await sleep(Math.min(120 * 2 ** (attempt - 1), 700));
  }

  return { status: "unauthenticated" };
}
