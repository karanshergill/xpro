import { createAccessRequest, createErrorResponse, createRequestContext, parseInput, reportUnexpectedError,
  requestIdHeader, type ProfileField } from "@xpro/core/server";
import { createHubAuth, type HubAuthSettings } from "#auth/auth.server.ts";
import { validateHubLocalAccess } from "#auth/validate-access.server.ts";

type ParsedInput = ReturnType<typeof parseInput<Record<string, never>>>;

export function validateCompletionPage(input: unknown): ReturnType<ParsedInput["toJSON"]> {
  return parseInput(input, {}).toJSON();
}

export async function handleCompletionPage(
  input: ReturnType<typeof validateCompletionPage>, services: { request: Request; settings: HubAuthSettings },
): Promise<Response> {
  const context = createRequestContext();
  if (input.variant === "Err") return createErrorResponse(input.error, context);
  let hasReportedError = false;
  const reportError = (): Response => {
    if (hasReportedError) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReportedError = true;
    return reportUnexpectedError(context, { app: "hub", operation: "accounts_completion_page" });
  };
  try {
    const { request, settings } = services;
    const url = new URL(request.url), origin = new URL(settings.baseURL).origin;
    // Start calls this reader directly during SSR. Public RPC stays JSON POST.
    const isPageRead = request.method === "GET" && url.pathname === "/complete-profile";
    const isBrowserRead = request.method === "POST" && request.headers.get("origin") === origin;
    if (url.origin !== origin || (!isPageRead && !isBrowserRead)) {
      return createErrorResponse({ code: "core_forbidden" }, context);
    }
    const auth = await createHubAuth({ ...settings, requestContext: context, onUnexpectedError: reportError });
    const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
    const access = await createAccessRequest({ app: "hub",
      session: session ? { loginId: session.user.id, hubSessionId: session.session.id } : null,
      workspaceId: null, context,
      hub: { async validateAccess(value) { return await validateHubLocalAccess(settings.database, value); } },
    });
    // The shared check refuses inactive/unfinished logins before profile fields.
    const complete = access.authorize({ kind: "protected", hasLocalPermission: true });
    const fields: ProfileField[] = [];
    if (complete.isErr) {
      if (complete.error.code !== "core_profile_incomplete") return createErrorResponse(complete.error, context);
      fields.push(...complete.error.fields);
    }
    return Response.json({ fields }, {
      headers: { "cache-control": "no-store", [requestIdHeader]: context.requestId },
    });
  } catch { return reportError(); }
}
