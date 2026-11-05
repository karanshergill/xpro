import { createLogin, completeLoginCreation, type CreateLoginError } from "@xpro/accounts/server";
import { createErrorResponse, createRequestContext, reportUnexpectedError, requestIdHeader,
  type RequestContext, type WorkspaceUsers } from "@xpro/core/server";
import { authorizeCreationActor, createLoginServices } from "#auth/create-login.server.ts";
import type { HubAuthSettings } from "#auth/auth.server.ts";

const creationErrors = {
  accounts_email_taken: { status: 409, message: "This email is already taken." },
  accounts_username_taken: { status: 409, message: "This username is already taken." },
  accounts_username_reserved: { status: 409, message: "This username is reserved." },
  accounts_username_invalid: { status: 400, message: "Check the username." },
  accounts_creation_conflict: { status: 409, message: "The login creation request does not match." },
} as const;

export async function handleCreateLogin(input: unknown, services: {
  request: Request; settings: HubAuthSettings; workspaceUsers: WorkspaceUsers;
}): Promise<Response> {
  const context = createRequestContext();
  let hasReportedError = false;
  const reportError = (): Response => {
    if (hasReportedError) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReportedError = true;
    return reportUnexpectedError(context, { app: "hub", operation: "accounts_create_login_request" });
  };
  try {
    const origin = new URL(services.settings.baseURL).origin;
    if (new URL(services.request.url).origin !== origin || services.request.method !== "POST"
      || services.request.headers.get("origin") !== origin) return createErrorResponse({ code: "core_forbidden" }, context);
    const native = await createLoginServices(services.request, { settings: { ...services.settings,
      requestContext: context, onUnexpectedError: reportError }, context });
    const actor = authorizeCreationActor(services.request, native.access);
    if (actor.isErr) return createErrorResponse(actor.error, context);
    const prepared = await createLogin(input, native);
    if (prepared.isErr) return creationErrorResponse(prepared.error, context);
    const completed = await completeLoginCreation(prepared.value, { database: services.settings.database,
      workspaceUsers: services.workspaceUsers, context });
    return completed.isErr ? createErrorResponse(completed.error, context)
      : Response.json({ creationId: completed.value.creationId, loginId: completed.value.loginId }, {
        headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
      });
  } catch { return reportError(); }
}

function creationErrorResponse(error: CreateLoginError, context: RequestContext): Response {
  switch (error.code) {
    case "accounts_email_taken": case "accounts_username_taken": case "accounts_username_reserved":
    case "accounts_username_invalid": case "accounts_creation_conflict": {
      const definition = creationErrors[error.code];
      return Response.json({ code: error.code, message: definition.message, requestId: context.requestId }, {
        status: definition.status, headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
      });
    }
    default: return createErrorResponse(error, context);
  }
}
