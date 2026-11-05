import { suspendLogin, reactivateLogin, archiveLogin, restoreLogin, type LoginStatusError } from "@xpro/stms/server";
import { createErrorResponse, requestIdHeader, type RequestContext } from "@xpro/core/server";
import type { Result } from "true-myth/result";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { withMasterRequest } from "./master-request.server";

type Services = { request: Request; settings: HubAuthSettings };

export async function handleSuspendLogin(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ access, context, settings }) =>
    statusResponse(await suspendLogin(input, { database: settings.database, access, context }), context));
}

export async function handleReactivateLogin(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ access, context, settings }) =>
    statusResponse(await reactivateLogin(input, { database: settings.database, access, context }), context));
}

export async function handleArchiveLogin(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ access, context, settings }) =>
    statusResponse(await archiveLogin(input, { database: settings.database, access, context }), context));
}

export async function handleRestoreLogin(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ access, context, settings }) =>
    statusResponse(await restoreLogin(input, { database: settings.database, access, context }), context));
}

function statusResponse(result: Result<{ loginId: string }, LoginStatusError>, context: RequestContext): Response {
  const headers = { [requestIdHeader]: context.requestId, "cache-control": "no-store" };
  if (result.isOk) return Response.json({ loginId: result.value.loginId }, { headers });
  const error = result.error;
  if (error.code === "stms_login_not_found") {
    return Response.json({ code: error.code, message: "This login could not be found.", requestId: context.requestId }, { status: 404, headers });
  }
  if (error.code === "stms_login_state_conflict") {
    return Response.json({ code: error.code, message: "This login's status has changed. Refresh and try again.", requestId: context.requestId },
      { status: 409, headers });
  }
  if (error.code === "stms_self_suspend_forbidden") {
    return Response.json({ code: error.code, message: "You cannot suspend your own login.", requestId: context.requestId }, { status: 403, headers });
  }
  if (error.code === "stms_self_archive_forbidden") {
    return Response.json({ code: error.code, message: "You cannot archive your own login.", requestId: context.requestId }, { status: 403, headers });
  }
  return createErrorResponse(error, context);
}
