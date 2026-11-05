import { pageLoginIdHeader } from "@xpro/core";
import { createErrorResponse, createRequestContext, reportUnexpectedError, type AccessActor, type AccessRequest, type CoreError } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { createHubAccess, withHubRequest, type HubRequest } from "./hub-request.server";

type Services = Pick<HubRequest, "request" | "settings">;
type MasterRequest = HubRequest & { actor: AccessActor };
type Run = (prepared: MasterRequest) => Promise<Response>;

export async function withMasterRequest(services: Services, run: Run): Promise<Response> {
  return await withHubRequest(services, async (prepared) => {
    const actor = authorizeMasterActor(prepared.request, prepared.access);
    return actor.isErr ? createErrorResponse(actor.error, prepared.context) : await run({ ...prepared, actor: actor.value });
  });
}

export async function withMasterReadRequest(services: Services, run: Run): Promise<Response> {
  if (services.request.method === "POST") {
    return await withMasterRequest(services, async (prepared) => addPageActor(await run(prepared), prepared.actor));
  }
  const context = createRequestContext();
  let hasReported = false;
  const reportError = (): Response => {
    if (hasReported) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReported = true; return reportUnexpectedError(context, { app: "hub", operation: "stms_master_read_request" });
  };
  try {
    const { request, settings } = services, url = new URL(request.url);
    // Start invokes read functions directly during these pages' SSR. Public RPC stays POST.
    const isPageRead = request.method === "GET" && /^\/stms\/logins(?:\/[a-f\d-]{36})?\/?$/i.test(url.pathname);
    if (url.origin !== new URL(settings.baseURL).origin || !isPageRead) return createErrorResponse({ code: "core_forbidden" }, context);
    const { auth, access } = await createHubAccess(request, { settings: { ...settings, onUnexpectedError: reportError }, context });
    const actor = authorizeMasterActor(request, access);
    if (actor.isErr) return createErrorResponse(actor.error, context);
    return addPageActor(await run({ ...services, auth, access, context, reportError, actor: actor.value }), actor.value);
  } catch { return reportError(); }
}

export function authorizeMasterActor(request: Request, access: AccessRequest): Result<AccessActor, CoreError> {
  const actor = access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const expected = request.headers.get(pageLoginIdHeader);
  if (expected !== null && expected !== actor.value.loginId) return err({ code: "core_identity_changed" });
  return ok(actor.value);
}

function addPageActor(response: Response, actor: AccessActor): Response {
  if (response.ok) response.headers.set(pageLoginIdHeader, actor.loginId);
  return response;
}
