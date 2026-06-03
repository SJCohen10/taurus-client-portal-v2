import { LOGOUT_STORAGE_KEY, logoutAndRedirect } from "./logout";

function mockLocationReplace() {
  const replace = jest.fn();
  const replaceDescriptor = Object.getOwnPropertyDescriptor(window.Location.prototype, "replace");

  Object.defineProperty(window.Location.prototype, "replace", {
    configurable: true,
    value: replace,
  });

  return {
    replace,
    restore: () => {
      if (replaceDescriptor) {
        Object.defineProperty(window.Location.prototype, "replace", replaceDescriptor);
      }
    },
  };
}

describe("portal logout", () => {
  let locationMock;
  let originalFetch;

  beforeEach(() => {
    locationMock = mockLocationReplace();
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(undefined);
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    delete window.catalyst;
    global.fetch = originalFetch;
    locationMock.restore();
    jest.restoreAllMocks();
  });

  test("uses Catalyst SDK signOut with hashless redirect, clears state, broadcasts, and does not await or replace", async () => {
    const signOut = jest.fn();
    window.catalyst = { auth: { signOut } };
    window.localStorage.setItem("catalyst-token", "token");
    window.sessionStorage.setItem("portal-user", "user");

    await logoutAndRedirect();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(`${window.location.origin}/app/`);
    expect(window.localStorage.getItem("catalyst-token")).toBeNull();
    expect(window.sessionStorage.getItem("portal-user")).toBeNull();
    expect(window.localStorage.getItem(LOGOUT_STORAGE_KEY)).toEqual(expect.any(String));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(locationMock.replace).not.toHaveBeenCalled();
  });

  test("falls back to BaaS logout and hashless redirect when SDK signOut is unavailable", async () => {
    window.catalyst = { auth: {} };
    window.localStorage.setItem("portal-auth", "cached");

    await logoutAndRedirect();

    expect(window.localStorage.getItem("portal-auth")).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      `${window.location.origin}/baas/logout?logout=true&PROJECT_ID=23570000000015028`,
      {
        method: "GET",
        credentials: "include",
        keepalive: true,
      },
    );
    expect(locationMock.replace).toHaveBeenCalledWith(`${window.location.origin}/app/`);
    expect(locationMock.replace.mock.calls[0][0]).not.toContain("/__catalyst/auth/logout");
  });

  test("falls back to BaaS logout and hashless redirect when SDK signOut throws synchronously", async () => {
    const signOut = jest.fn(() => {
      throw new Error("SDK logout failed");
    });
    window.catalyst = { auth: { signOut } };

    await logoutAndRedirect();

    expect(signOut).toHaveBeenCalledWith(`${window.location.origin}/app/`);
    expect(global.fetch).toHaveBeenCalledWith(
      `${window.location.origin}/baas/logout?logout=true&PROJECT_ID=23570000000015028`,
      expect.objectContaining({
        credentials: "include",
        keepalive: true,
      }),
    );
    expect(locationMock.replace).toHaveBeenCalledWith(`${window.location.origin}/app/`);
    expect(locationMock.replace.mock.calls[0][0]).not.toContain("/__catalyst/auth/logout");
  });

  test("still redirects to hashless app URL when BaaS logout fetch fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network failure"));

    await logoutAndRedirect();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(locationMock.replace).toHaveBeenCalledWith(`${window.location.origin}/app/`);
    expect(locationMock.replace.mock.calls[0][0]).not.toContain("/__catalyst/auth/logout");
  });
});
