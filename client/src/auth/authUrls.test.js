import {
  buildCatalystLoginUrl,
  buildCatalystLogoutUrl,
  getCleanAppReturnUrl,
  normalizePortalReturnUrl,
} from "./authUrls";

describe("auth URL helpers", () => {
  beforeEach(() => {
    delete window.location;
    window.location = new URL("https://portal.tauruscapital.co.za/app/#/dashboard");
  });

  test("builds login url with clean app return url", () => {
    const url = buildCatalystLoginUrl("https://portal.tauruscapital.co.za/app/");
    expect(url).toBe("https://portal.tauruscapital.co.za/__catalyst/auth/login?service_url=https%3A%2F%2Fportal.tauruscapital.co.za%2Fapp%2F");
  });

  test("builds logout url with clean app return url", () => {
    const url = buildCatalystLogoutUrl("https://portal.tauruscapital.co.za/app/");
    expect(url).toBe("https://portal.tauruscapital.co.za/__catalyst/auth/logout?service_url=https%3A%2F%2Fportal.tauruscapital.co.za%2Fapp%2F");
  });

  test("normalizes nested catalyst auth url back to app", () => {
    const nested = "https://portal.tauruscapital.co.za/__catalyst/auth/login?service_url=https%3A%2F%2Fportal.tauruscapital.co.za%2Fapp%2F%23%2F";
    expect(normalizePortalReturnUrl(nested)).toBe(getCleanAppReturnUrl());
  });

  test("logout service url never points at catalyst login", () => {
    const nested = "https://portal.tauruscapital.co.za/__catalyst/auth/login?service_url=https%3A%2F%2Fportal.tauruscapital.co.za%2Fapp%2F";
    const url = buildCatalystLogoutUrl(nested);
    expect(decodeURIComponent(url)).not.toContain("/__catalyst/auth/login");
  });
});
