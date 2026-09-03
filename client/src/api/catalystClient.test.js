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
    expect(error.rawBody).toBeUndefined();
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

  test("message carries the safe server message and the request id", () => {
    const error = buildApiError(
      { status: 500 },
      JSON.stringify({ error: "Unable to save note.", requestId: "req_abc123" }),
    );

    expect(error.message).toBe("Unable to save note. Reference: req_abc123");
    expect(error.requestId).toBe("req_abc123");
  });

  test("message omits the reference when there is no request id", () => {
    expect(
      buildApiError({ status: 403 }, '{"error":"Forbidden"}').message,
    ).toBe("Forbidden");
  });

  test("falls back to a generic message rather than the bare status string", () => {
    expect(buildApiError({ status: 401 }, "").message).toBe(
      "Your session has expired. Please sign in again.",
    );
    expect(buildApiError({ status: 500 }, "").message).toBe(
      "Something went wrong on our side. Please try again.",
    );
    expect(buildApiError({ status: 500 }, "").message).not.toContain(
      "Request failed with status",
    );
  });

  test("never surfaces the raw response body", () => {
    const stackish = [
      "Error: connect ECONNREFUSED 10.0.0.4:443",
      "    at TCPConnectWrap.afterConnect (net.js:1146:16)",
      "    recordId=4392110000012345678",
    ].join(String.fromCharCode(10));
    const error = buildApiError({ status: 500 }, stackish);

    expect(error.rawBody).toBeUndefined();
    expect(error.message).toBe("Something went wrong on our side. Please try again.");
    expect(error.technicalMessage).not.toContain("ECONNREFUSED");
    expect(error.technicalMessage).not.toContain("4392110000012345678");
  });
});
