import { managementOperationEntries } from "@xpro/stms";
import { getManagementOperation } from "@xpro/stms/server";
import { createErrorResponse, parseInput, requestIdHeader } from "@xpro/core/server";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { withMasterRequest } from "./master-request.server";

type Services = { request: Request; settings: HubAuthSettings };

export async function handleGetManagementOperation(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ session, context, settings }) => {
    const parsed = parseInput(input, managementOperationEntries);
    if (parsed.isErr) return createErrorResponse(parsed.error, context);
    const result = await getManagementOperation(parsed.value.operationId, { database: settings.database, session, context });
    if (result.isErr) return createErrorResponse(result.error, context);
    return Response.json(result.value, { headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" } });
  });
}
