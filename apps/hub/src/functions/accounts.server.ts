import { listAccounts, searchAccounts, getAccount, createAccount, renameAccount } from "@xpro/stms/server";
import type { AccountReadError, CreateAccountError, RenameAccountError } from "@xpro/stms/server";
import { createErrorResponse, requestIdHeader } from "@xpro/core/server";
import type { RequestContext } from "@xpro/core/server";
import type { Result } from "true-myth/result";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { withMasterReadRequest, withMasterRequest } from "./master-request.server";

type Services = { request: Request; settings: HubAuthSettings };
type AccountError = AccountReadError | CreateAccountError | RenameAccountError;

export async function handleListAccounts(input: unknown, services: Services): Promise<Response> {
  return await withMasterReadRequest(services, async ({ session, context, settings }) =>
    accountResponse(await listAccounts(input, { database: settings.database, session, context }), context));
}
export async function handleSearchAccounts(input: unknown, services: Services): Promise<Response> {
  return await withMasterReadRequest(services, async ({ session, context, settings }) =>
    accountResponse(await searchAccounts(input, { database: settings.database, session, context }), context));
}
export async function handleGetAccount(input: unknown, services: Services): Promise<Response> {
  return await withMasterReadRequest(services, async ({ session, context, settings }) =>
    accountResponse(await getAccount(input, { database: settings.database, session, context }), context));
}
export async function handleCreateAccount(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ session, context, settings }) =>
    accountResponse(await createAccount(input, { database: settings.database, session, context }), context));
}
export async function handleRenameAccount(input: unknown, services: Services): Promise<Response> {
  return await withMasterRequest(services, async ({ session, context, settings }) =>
    accountResponse(await renameAccount(input, { database: settings.database, session, context }), context));
}

function accountResponse<Value>(result: Result<Value, AccountError>, context: RequestContext): Response {
  const headers = { [requestIdHeader]: context.requestId, "cache-control": "no-store" };
  if (result.isOk) return Response.json(result.value, { headers });
  const error = result.error;
  if (error.code === "stms_account_not_found") {
    return Response.json({ code: error.code, message: "This account could not be found.", requestId: context.requestId }, { status: 404, headers });
  }
  if (error.code === "stms_account_holder_unavailable") {
    return Response.json({ code: error.code, message: "This login is not available to hold a new account.", requestId: context.requestId }, { status: 409, headers });
  }
  if (error.code === "stms_operation_conflict") {
    return Response.json({ code: error.code, message: "This command conflicts with the current state or a previously recorded command.", requestId: context.requestId }, { status: 409, headers });
  }
  return createErrorResponse(error, context);
}
