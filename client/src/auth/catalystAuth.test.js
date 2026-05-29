import { extractCatalystAuthError, resolveCatalystSessionStatus } from "./catalystAuth";

describe("Catalyst auth failure detection", () => {
  afterEach(() => {
    delete window.catalyst;
    jest.restoreAllMocks();
  });

  test("extracts auth error details from nested SDK response shapes", () => {
    const extracted = extractCatalystAuthError({
      response: {
        data: {
          data: {
            error_code: "AUTHENTICATION_FAILURE",
            message: "Authentication failed",
          },
        },
      },
    });

    expect(extracted.errorCode).toBe("AUTHENTICATION_FAILURE");
    expect(extracted.allText).toMatch(/Authentication failed/i);
  });

  test("treats thrown AUTHENTICATION_FAILURE as unauthenticated", async () => {
    window.catalyst = {
      auth: {
        isUserAuthenticated: jest.fn().mockRejectedValue({
          data: {
            error_code: "AUTHENTICATION_FAILURE",
            message: "Authentication failed",
          },
        }),
      },
    };

    await expect(resolveCatalystSessionStatus()).resolves.toEqual({
      status: "unauthenticated",
      source: "authentication_failure",
    });
  });

  test("treats returned AUTHENTICATION_FAILURE payloads as unauthenticated", async () => {
    window.catalyst = {
      auth: {
        isUserAuthenticated: jest.fn().mockResolvedValue({
          status: "failure",
          data: {
            error_code: "AUTHENTICATION_FAILURE",
            message: "Authentication failed",
          },
        }),
      },
    };

    await expect(resolveCatalystSessionStatus()).resolves.toEqual({
      status: "unauthenticated",
      source: "authentication_failure",
    });
  });
});
