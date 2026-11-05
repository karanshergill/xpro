import type { AccessError } from "#access/access.ts";
import { requestIdHeader, type RequestContext } from "./request";

export type CoreError =
  | AccessError
  | { code: "core_invalid_input"; fields: string[] }
  | { code: "core_request_too_large" | "core_unsupported_media_type" | "core_sign_in_invalid" | "core_identity_changed" };

type ErrorLocation = { app: "hub" | "router" | "workspace"; operation: string };

const errorDefinitions = {
  core_identity_changed: { status: 409, message: "Your sign-in has changed. Reload this page to continue." },
  core_sign_in_invalid: { status: 400, message: "Sign-in could not be completed. Please try again." },
  core_unauthenticated: { status: 401, message: "Sign in to continue." },
  core_login_inactive: { status: 403, message: "This login is not active." },
  core_creation_incomplete: { status: 403, message: "This login is not ready to use yet." },
  core_profile_incomplete: { status: 403, message: "Complete the required profile details." },
  core_mfa_required: { status: 403, message: "Complete multi-factor authentication to continue." },
  core_mfa_recent_verification_required: { status: 403, message: "Verify multi-factor authentication again to make this change." },
  core_forbidden: { status: 403, message: "You do not have permission to do this." },
  core_invalid_input: { status: 400, message: "Check the submitted details." },
  core_request_too_large: { status: 413, message: "The request is too large." },
  core_unsupported_media_type: { status: 415, message: "Use the content type supported by this endpoint." },
  core_unexpected_error: { status: 500, message: "Something went wrong. Please try again." },
} as const;

export function createErrorResponse(error: CoreError, context: RequestContext): Response {
  const definition = errorDefinitions[error.code];
  return Response.json({
    code: error.code,
    message: definition.message,
    requestId: context.requestId,
    ...(error.code === "core_invalid_input" || error.code === "core_profile_incomplete" ? { fields: error.fields } : {}),
  }, {
    status: definition.status,
    headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
  });
}

export function reportUnexpectedError(context: RequestContext, location: ErrorLocation): Response {
  // Location labels are fixed in code; request data and caught errors can contain credentials.
  // shortcut: report locations without exception internals; add reviewed private
  // diagnostics if location and request ID cannot isolate failures.
  console.error(JSON.stringify({ event: "core_unexpected_error", requestId: context.requestId,
    app: location.app, operation: location.operation }));
  return createErrorResponse({ code: "core_unexpected_error" }, context);
}
