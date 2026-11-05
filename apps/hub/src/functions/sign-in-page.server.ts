import { createErrorResponse, createRequestContext, parseInput, reportUnexpectedError, requestIdHeader } from "@xpro/core/server";

type ParsedInput = ReturnType<typeof parseInput<Record<string, never>>>;

export function validateSignInPage(input: unknown): ReturnType<ParsedInput["toJSON"]> {
  return parseInput(input, {}).toJSON();
}

export async function handleSignInPage(input: ReturnType<typeof validateSignInPage>, services: {
  request: Request; baseURL: string; siteKey: string;
}): Promise<Response> {
  const context = createRequestContext();
  if (input.variant === "Err") return createErrorResponse(input.error, context);
  try {
    const url = new URL(services.request.url), origin = new URL(services.baseURL).origin;
    const isPageRead = services.request.method === "GET" && url.pathname === "/sign-in";
    const isBrowserRead = services.request.method === "POST" && services.request.headers.get("origin") === origin;
    if (url.origin !== origin || (!isPageRead && !isBrowserRead)) {
      return createErrorResponse({ code: "core_forbidden" }, context);
    }
    if (!services.siteKey?.trim()) return reportUnexpectedError(context, { app: "hub", operation: "accounts_sign_in_page" });
    return Response.json({ siteKey: services.siteKey.trim() }, {
      headers: { "cache-control": "no-store", [requestIdHeader]: context.requestId },
    });
  } catch { return reportUnexpectedError(context, { app: "hub", operation: "accounts_sign_in_page" }); }
}
