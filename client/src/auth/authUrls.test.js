import {
  buildCatalystLoginUrl,
  normalizePortalReturnUrl,
} from "./authUrls";

describe("production-safe auth urls", () => {
  test("production login URL shape", () => {
    const origin = window.location.origin;
    const loginUrl = buildCatalystLoginUrl(`${origin}/app/#/`);
    expect(loginUrl).toBe(
      `${origin}/__catalyst/auth/login?service_url=${encodeURIComponent(`${origin}/app/#/`)}`
    );
  });

  test("never generates development domain", () => {
    const loginUrl = buildCatalystLoginUrl("https://taurus-client-portal-889090616.development.catalystserverless.com/app/#/");
    expect(loginUrl).not.toContain("development.catalystserverless.com");
  });

  test("nested auth service urls are normalized", () => {
    const origin = window.location.origin;
    const normalized = normalizePortalReturnUrl(
      `${origin}/__catalyst/auth/login?service_url=${encodeURIComponent(`${origin}/app/#/`)}`
    );
    expect(normalized).toBe(`${origin}/app/#/`);
  });

  test("external origins are rejected", () => {
    const origin = window.location.origin;
    expect(normalizePortalReturnUrl("https://evil.example/app/#/")).toBe(`${origin}/app/#/`);
  });

  test("/app becomes /app/", () => {
    const origin = window.location.origin;
    expect(normalizePortalReturnUrl(`${origin}/app`)).toBe(`${origin}/app/`);
  });

  test("safe hash routes are preserved", () => {
    const origin = window.location.origin;
    expect(normalizePortalReturnUrl(`${origin}/app/#/dashboard`)).toBe(`${origin}/app/#/dashboard`);
  });
});
