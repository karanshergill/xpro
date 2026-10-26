import { afterEach, describe, expect, it, vi } from "vitest";
import { createErrorResponse, reportUnexpectedError } from "@xpro/core/server";
import { createRequestContext, requestIdHeader } from "./request";

afterEach(() => vi.restoreAllMocks());

describe("server errors", () => {
  it("when input is invalid then the response includes all fields, its request ID and no private extras", async () => {
    const context = createRequestContext();
    const failure = {
      code: "core_invalid_input" as const,
      fields: ["email", "password"],
      message: "Private database message",
      password: "private-password",
      stack: "Private stack trace",
    };
    const response = createErrorResponse(failure, context);
    expect(response.status).toBe(400);
    expect(response.headers.get(requestIdHeader)).toBe(context.requestId);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      code: "core_invalid_input",
      message: "Check the submitted details.",
      requestId: context.requestId,
      fields: ["email", "password"],
    });
  });

  it.each([
    { code: "core_request_too_large", status: 413, message: "The request is too large." },
    { code: "core_unsupported_media_type", status: 415, message: "Send the request as JSON." },
    { code: "core_unexpected_error", status: 500, message: "Something went wrong. Please try again." },
  ] as const)("when $code occurs then it returns the declared status and safe message", async ({ code, status, message }) => {
    const context = createRequestContext();
    const response = createErrorResponse({ code }, context);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, message, requestId: context.requestId });
  });

  it("when an unexpected failure is reported then one safe JSON event and a generic response share the request ID", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const context = { ...createRequestContext(), password: "private-password", authorization: "Bearer private-token" };
    const response = reportUnexpectedError(context);
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      event: "core_unexpected_error",
      requestId: context.requestId,
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "core_unexpected_error",
      message: "Something went wrong. Please try again.",
      requestId: context.requestId,
    });
  });
});
