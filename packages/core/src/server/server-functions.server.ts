import { createErrorResponse } from "./errors.server";
import { readInputText } from "./input.server";
import type { RequestContext } from "./request";

export async function prepareServerFunctionRequest(request: Request, settings: {
  baseURL: string; context: RequestContext;
}): Promise<Request | Response> {
  const origin = new URL(settings.baseURL).origin;
  if (request.method !== "POST" || new URL(request.url).origin !== origin || request.headers.get("origin") !== origin) {
    return createErrorResponse({ code: "core_forbidden" }, settings.context);
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return createErrorResponse({ code: "core_unsupported_media_type" }, settings.context);
  }
  // Bound native RPC JSON before Start deserializes it; validators run afterwards.
  const body = await readInputText(request);
  if (body.isErr) return createErrorResponse(body.error, settings.context);
  try { JSON.parse(body.value); }
  catch { return createErrorResponse({ code: "core_invalid_input", fields: [] }, settings.context); }
  return new Request(request, { body: body.value });
}
