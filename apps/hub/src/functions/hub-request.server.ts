import { createAccessRequest, createErrorResponse, createRequestContext, reportUnexpectedError,
  type AccessRequest, type RequestContext } from "@xpro/core/server";
import { createHubAuth, type HubAuthSettings } from "#auth/auth.server.ts";
import { validateHubLocalAccess } from "#auth/validate-access.server.ts";

type Services = { request: Request; settings: HubAuthSettings };
export type HubRequest = Services & {
  auth: Awaited<ReturnType<typeof createHubAuth>>; access: AccessRequest; context: RequestContext; reportError(): Response;
};

export async function withHubRequest(services: Services, run: (request: HubRequest) => Promise<Response>): Promise<Response> {
  const context = createRequestContext();
  let hasReportedError = false;
  const reportError = (): Response => {
    if (hasReportedError) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReportedError = true;
    return reportUnexpectedError(context, { app: "hub", operation: "core_hub_function_request" });
  };
  try {
    const { settings, request } = services;
    const origin = new URL(settings.baseURL).origin;
    if (request.method !== "POST" || new URL(request.url).origin !== origin || request.headers.get("origin") !== origin) {
      return createErrorResponse({ code: "core_forbidden" }, context);
    }
    const { auth, access } = await createHubAccess(request, { settings: { ...settings, onUnexpectedError: reportError }, context });
    return await run({ ...services, auth, access, context, reportError });
  } catch { return reportError(); }
}

export async function createHubAccess(request: Request, { settings, context }: { settings: HubAuthSettings; context: RequestContext }): Promise<{
  auth: Awaited<ReturnType<typeof createHubAuth>>; access: AccessRequest;
}> {
  const auth = await createHubAuth({ ...settings, requestContext: context });
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  const access = await createAccessRequest({ app: "hub",
    session: session ? { loginId: session.user.id, hubSessionId: session.session.id } : null,
    workspaceId: null, context,
    hub: { async validateAccess(value) { return await validateHubLocalAccess(settings.database, value); } },
  });
  return { auth, access };
}
