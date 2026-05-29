function safeStringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function extractCatalystAuthError(error) {
  const candidates = [
    error?.data?.error_code,
    error?.error_code,
    error?.data?.data?.error_code,
    error?.response?.data?.error_code,
    error?.response?.data?.data?.error_code,
  ].filter(Boolean);

  const messageCandidates = [
    error?.data?.message,
    error?.message,
    error?.data?.data?.message,
    error?.response?.data?.message,
    error?.response?.data?.data?.message,
    safeStringify(error),
  ].filter(Boolean);

  return {
    errorCode: candidates.find((code) => typeof code === "string") || "",
    message: messageCandidates.find((message) => typeof message === "string") || "",
    allText: [...candidates, ...messageCandidates].map((value) => String(value)).join(" "),
  };
}

function isCatalystAuthenticationFailure(error) {
  const { errorCode, allText } = extractCatalystAuthError(error);
  return (
    errorCode === "AUTHENTICATION_FAILURE" ||
    /authentication failed/i.test(allText)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(timeoutMessage);
      err.code = "TIMEOUT";
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
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
        const result = await withTimeout(
          auth.isUserAuthenticated(),
          1500,
          "Timed out while checking Catalyst authentication status"
        );
        if (isCatalystAuthenticationFailure(result)) {
          return { status: "unauthenticated", source: "authentication_failure" };
        }
        if (result) return { status: "authenticated", source: "isUserAuthenticated" };
      }

      if (typeof auth?.getCurrentUser === "function") {
        const user = await withTimeout(
          auth.getCurrentUser(),
          1500,
          "Timed out while loading Catalyst current user"
        );
        if (isCatalystAuthenticationFailure(user)) {
          return { status: "unauthenticated", source: "authentication_failure" };
        }
        if (user) return { status: "authenticated", source: "getCurrentUser" };
      }

      if (auth?.currentUser && typeof auth.currentUser === "object") {
        return { status: "authenticated", source: "currentUser" };
      }
    } catch (error) {
      if (isCatalystAuthenticationFailure(error)) {
        return { status: "unauthenticated", source: "authentication_failure" };
      }
      const safeMessage = error?.message || "Unexpected Catalyst auth error";
      return { status: "error", error: safeMessage };
    }

    await sleep(Math.min(120 * 2 ** (attempt - 1), 700));
  }

  return { status: "unauthenticated" };
}
