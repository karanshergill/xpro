import { changeEmail, changeUsername, type LoginIdentifierError } from "@xpro/stms/server";
import { createErrorResponse, requestIdHeader, type RequestContext } from "@xpro/core/server";
import type { Result } from "true-myth/result";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { withMasterRequest } from "./master-request.server";

type Services = { request: Request; settings: HubAuthSettings };

export async function handleChangeEmail(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ access, context, settings }) =>
    identifierResponse(await changeEmail(input, { database: settings.database, access, context }), context));
}

export async function handleChangeUsername(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ access, context, settings }) =>
    identifierResponse(await changeUsername(input, { database: settings.database, access, context }), context));
}

function identifierResponse(result: Result<{ loginId: string }, LoginIdentifierError>, context: RequestContext): Response {
  const headers = { [requestIdHeader]: context.requestId, "cache-control": "no-store" };
  if (result.isOk) return Response.json({ loginId: result.value.loginId }, { headers });
  const error = result.error;
  switch (error.code) {
    case "stms_login_not_found": return Response.json({ code: error.code, message: "This login could not be found.", requestId: context.requestId }, { status: 404, headers });
    case "accounts_email_taken": return Response.json({ code: error.code, message: "This email address is already in use.", requestId: context.requestId }, { status: 409, headers });
    case "accounts_username_taken": return Response.json({ code: error.code, message: "This username is already in use.", requestId: context.requestId }, { status: 409, headers });
    case "accounts_username_reserved": return Response.json({ code: error.code, message: "This username is reserved.", requestId: context.requestId }, { status: 409, headers });
    case "accounts_username_invalid": return Response.json({ code: error.code, message: "Check the username format.", requestId: context.requestId }, { status: 400, headers });
    default: return createErrorResponse(error, context);
  }
}
