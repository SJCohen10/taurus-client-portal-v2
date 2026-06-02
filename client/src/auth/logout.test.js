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

  beforeEach(() => {
    locationMock = mockLocationReplace();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    delete window.catalyst;
    locationMock.restore();
    jest.restoreAllMocks();
  });

  test("uses Catalyst SDK signOut, clears local state, broadcasts, and redirects to login", async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    window.catalyst = { auth: { signOut } };
    window.localStorage.setItem("catalyst-token", "token");
    window.sessionStorage.setItem("portal-user", "user");

    await logoutAndRedirect({ serviceUrl: `${window.location.origin}/app/#/` });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("catalyst-token")).toBeNull();
    expect(window.sessionStorage.getItem("portal-user")).toBeNull();
    expect(window.localStorage.getItem(LOGOUT_STORAGE_KEY)).toEqual(expect.any(String));
    expect(locationMock.replace).toHaveBeenCalledWith(
      `${window.location.origin}/__catalyst/auth/login?service_url=${encodeURIComponent(
        `${window.location.origin}/app/#/`,
      )}`,
    );
    expect(locationMock.replace.mock.calls[0][0]).not.toContain("/__catalyst/auth/logout");
  });

  test("still clears state and redirects to login when SDK logout fails", async () => {
    const signOut = jest.fn().mockRejectedValue(new Error("SDK logout failed"));
    window.catalyst = { auth: { signOut } };
    window.localStorage.setItem("portal-auth", "cached");

    await logoutAndRedirect({ serviceUrl: `${window.location.origin}/app/#/` });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("portal-auth")).toBeNull();
    expect(locationMock.replace).toHaveBeenCalledWith(
      expect.stringContaining("/__catalyst/auth/login?service_url="),
    );
    expect(locationMock.replace.mock.calls[0][0]).not.toContain("/__catalyst/auth/logout");
  });

  test("falls back to auth.logout or auth.signout when signOut is unavailable", async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    const signout = jest.fn().mockResolvedValue(undefined);
    window.catalyst = { auth: { logout, signout } };

    await logoutAndRedirect({ serviceUrl: `${window.location.origin}/app/#/` });

    expect(logout).toHaveBeenCalledTimes(1);
    expect(signout).not.toHaveBeenCalled();
    expect(locationMock.replace.mock.calls[0][0]).toContain("/__catalyst/auth/login?service_url=");
    expect(locationMock.replace.mock.calls[0][0]).not.toContain("/__catalyst/auth/logout");
  });
});
