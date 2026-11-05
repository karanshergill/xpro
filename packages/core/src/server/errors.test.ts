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
    { code: "core_identity_changed", status: 409, message: "Your sign-in has changed. Reload this page to continue." },
    { code: "core_sign_in_invalid", status: 400, message: "Sign-in could not be completed. Please try again." },
    { code: "core_unauthenticated", status: 401, message: "Sign in to continue." },
    { code: "core_login_inactive", status: 403, message: "This login is not active." },
    { code: "core_creation_incomplete", status: 403, message: "This login is not ready to use yet." },
    { code: "core_mfa_required", status: 403, message: "Complete multi-factor authentication to continue." },
    { code: "core_mfa_recent_verification_required", status: 403, message: "Verify multi-factor authentication again to make this change." },
    { code: "core_forbidden", status: 403, message: "You do not have permission to do this." },
    { code: "core_request_too_large", status: 413, message: "The request is too large." },
    { code: "core_unsupported_media_type", status: 415, message: "Use the content type supported by this endpoint." },
    { code: "core_unexpected_error", status: 500, message: "Something went wrong. Please try again." },
  ] as const)("when $code occurs then it returns the declared status and safe message", async ({ code, status, message }) => {
    const context = createRequestContext();
    const response = createErrorResponse({ code }, context);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, message, requestId: context.requestId });
  });

  it("when profile completion is required then only the field names and safe error are returned", async () => {
    const context = createRequestContext();
    const response = createErrorResponse({ code: "core_profile_incomplete", fields: ["phone"] }, context);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "core_profile_incomplete", message: "Complete the required profile details.",
      requestId: context.requestId, fields: ["phone"] });
  });

  it.each(["hub", "router", "workspace"] as const)("when %s reports a failure then only its fixed location and request ID are logged", async (app) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const privateData = { password: "private-password", authorization: "Bearer private-token", cookie: "private-cookie",
      email: "private@example.test", phone: "+919876543210", code: "123456", backupCode: "private-backup-code",
      secret: "private-mfa-secret", url: "https://hub.example.test/callback?code=private-oauth-code",
      error: new Error("private-database-failure", { cause: "private-error-cause" }) };
    const context = { ...createRequestContext(), ...privateData };
    const location = { app, operation: "core_test_failure", ...privateData };
    const response = reportUnexpectedError(context, location);
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      event: "core_unexpected_error",
      requestId: context.requestId,
      app, operation: "core_test_failure",
    }));
    expect(response.status).toBe(500);
    expect(response.headers.get(requestIdHeader)).toBe(context.requestId);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      code: "core_unexpected_error",
      message: "Something went wrong. Please try again.",
      requestId: context.requestId,
    });
  });

  it("when different apps report failures then each event and response keep their own request ID and operation", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hub = createRequestContext(), workspace = createRequestContext();
    const first = reportUnexpectedError(hub, { app: "hub", operation: "accounts_create_login" });
    const second = reportUnexpectedError(workspace, { app: "workspace", operation: "core_workspace_request" });
    expect(log.mock.calls).toEqual([
      [JSON.stringify({ event: "core_unexpected_error", requestId: hub.requestId, app: "hub", operation: "accounts_create_login" })],
      [JSON.stringify({ event: "core_unexpected_error", requestId: workspace.requestId, app: "workspace", operation: "core_workspace_request" })],
    ]);
    expect(await first.json()).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId: hub.requestId });
    expect(await second.json()).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId: workspace.requestId });
  });
});
