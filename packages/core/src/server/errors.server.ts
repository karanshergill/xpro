import { requestIdHeader, type RequestContext } from "./request";

export type CoreError =
  | { code: "core_invalid_input"; fields: string[] }
  | { code: "core_request_too_large" | "core_unsupported_media_type" | "core_unexpected_error" };

const errorDefinitions = {
  core_invalid_input: { status: 400, message: "Check the submitted details." },
  core_request_too_large: { status: 413, message: "The request is too large." },
  core_unsupported_media_type: { status: 415, message: "Send the request as JSON." },
  core_unexpected_error: { status: 500, message: "Something went wrong. Please try again." },
} as const;

export function createErrorResponse(error: CoreError, context: RequestContext): Response {
  const definition = errorDefinitions[error.code];
  return Response.json({
    code: error.code,
    message: definition.message,
    requestId: context.requestId,
    ...(error.code === "core_invalid_input" ? { fields: error.fields } : {}),
  }, {
    status: definition.status,
    headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
  });
}

export function reportUnexpectedError(context: RequestContext): Response {
  // Caught error messages, causes and request data can contain credentials.
  // shortcut: log only the event and request ID during scaffolding; add reviewed,
  // sanitized diagnostics before the first live client.
  console.error(JSON.stringify({ event: "core_unexpected_error", requestId: context.requestId }));
  return createErrorResponse({ code: "core_unexpected_error" }, context);
}
