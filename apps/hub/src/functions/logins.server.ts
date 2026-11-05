import { listLogins, searchLogins, getLogin } from "@xpro/stms/server";
import { createErrorResponse, requestIdHeader, type RequestContext } from "@xpro/core/server";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { withMasterReadRequest } from "./master-request.server";

type Services = { request: Request; settings: HubAuthSettings };
type ReadResult = Awaited<ReturnType<typeof listLogins>> | Awaited<ReturnType<typeof getLogin>>;

export async function handleListLogins(input: unknown, services: Services): Promise<Response> {
  return await withMasterReadRequest(services, async ({ access, context, settings }) =>
    readResponse(await listLogins(input, { database: settings.database, access, context }), context));
}

export async function handleSearchLogins(input: unknown, services: Services): Promise<Response> {
  return await withMasterReadRequest(services, async ({ access, context, settings }) =>
    readResponse(await searchLogins(input, { database: settings.database, access, context }), context));
}

export async function handleGetLogin(input: unknown, services: Services): Promise<Response> {
  return await withMasterReadRequest(services, async ({ access, context, settings }) =>
    readResponse(await getLogin(input, { database: settings.database, access, context }), context));
}

function readResponse(result: ReadResult, context: RequestContext): Response {
  const headers = { [requestIdHeader]: context.requestId, "cache-control": "no-store" };
  if (result.isOk) return Response.json(result.value, { headers });
  if (result.error.code === "stms_login_not_found") {
    return Response.json({ code: result.error.code, message: "This login could not be found.", requestId: context.requestId },
      { status: 404, headers });
  }
  return createErrorResponse(result.error, context);
}
