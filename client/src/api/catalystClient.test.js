import { buildApiError } from "./catalystClient";

describe("Catalyst API error parsing", () => {
  test("extracts Catalyst platform NO_ACCESS details", () => {
    const error = buildApiError(
      { status: 401 },
      JSON.stringify({
        status: "failure",
        data: {
          message: "No privilege to perform this action.",
          error_code: "NO_ACCESS",
        },
      }),
    );

    expect(error.status).toBe(401);
    expect(error.technicalMessage).toBe("No privilege to perform this action.");
    expect(error.errorCode).toBe("NO_ACCESS");
    expect(error.rawBody).toContain("NO_ACCESS");
  });

  test("supports alternate backend message and error code shapes", () => {
    expect(
      buildApiError({ status: 500 }, '{"error":"top error"}')
        .technicalMessage,
    ).toBe("top error");
    expect(
      buildApiError({ status: 500 }, '{"message":"top message"}')
        .technicalMessage,
    ).toBe("top message");
    expect(
      buildApiError({ status: 400 }, '{"data":{"errorCode":"CAMEL_CODE"}}')
        .errorCode,
    ).toBe("CAMEL_CODE");
    expect(
      buildApiError({ status: 400 }, '{"error_code":"SNAKE_CODE"}').errorCode,
    ).toBe("SNAKE_CODE");
  });
});
