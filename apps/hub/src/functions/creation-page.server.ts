import { readCreatorWorkspace } from "@xpro/accounts/server";
import { createErrorResponse, createRequestContext, parseInput, reportUnexpectedError, requestIdHeader } from "@xpro/core/server";
import { readWorkspaceOrigin } from "@xpro/stms/server";
import { authorizeCreationActor, createLoginServices } from "#auth/create-login.server.ts";
import type { HubAuthSettings } from "#auth/auth.server.ts";

type ParsedInput = ReturnType<typeof parseInput<Record<string, never>>>;

export function validateCreationPage(input: unknown): ReturnType<ParsedInput["toJSON"]> {
  return parseInput(input, {}).toJSON();
}

export async function handleCreationPage(input: ReturnType<typeof validateCreationPage>, services: {
  request: Request; settings: HubAuthSettings;
}): Promise<Response> {
  const context = createRequestContext();
  if (input.variant === "Err") return createErrorResponse(input.error, context);
  let hasReportedError = false;
  const reportError = (): Response => {
    if (hasReportedError) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReportedError = true;
    return reportUnexpectedError(context, { app: "hub", operation: "accounts_creation_page" });
  };
  try {
    const { request, settings } = services, url = new URL(request.url), origin = new URL(settings.baseURL).origin;
    const isPageRead = request.method === "GET" && url.pathname === "/create-login";
    const isBrowserRead = request.method === "POST" && request.headers.get("origin") === origin;
    if (url.origin !== origin || (!isPageRead && !isBrowserRead)) return createErrorResponse({ code: "core_forbidden" }, context);
    const native = await createLoginServices(request, { settings: { ...settings, onUnexpectedError: reportError }, context });
    const actor = authorizeCreationActor(request, native.access);
    if (actor.isErr) return createErrorResponse(actor.error, context);
    let scope: { kind: "master" } | { kind: "workspace"; workspace: { workspaceId: string; name: string } };
    if (actor.value.isMaster) scope = { kind: "master" };
    else {
      const workspace = await readCreatorWorkspace(settings.database, actor.value.loginId);
      if (!workspace || !await native.identity.hasCreationPermission(workspace.workspaceId)
        || !await readWorkspaceOrigin(settings.database, workspace.workspaceId)) {
        return createErrorResponse({ code: "core_forbidden" }, context);
      }
      scope = { kind: "workspace", workspace };
    }
    return Response.json({ creatorLoginId: actor.value.loginId, scope }, {
      headers: { "cache-control": "no-store", [requestIdHeader]: context.requestId },
    });
  } catch { return reportError(); }
}
