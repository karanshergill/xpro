import { createAccessRequest, createErrorResponse, createRequestContext, reportUnexpectedError,
  type AccessRequest, type AccessSession, type RequestContext } from "@xpro/core/server";
import { createHubAuth, type HubAuthSettings } from "#auth/auth.server.ts";
import { validateHubLocalAccess } from "@xpro/accounts/server";

type Services = { request: Request; settings: HubAuthSettings };
export type HubRequest = Services & {
  auth: Awaited<ReturnType<typeof createHubAuth>>; access: AccessRequest; session: AccessSession | null;
  context: RequestContext; reportError(): Response;
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
    const { auth, access, session } = await createHubAccess(request, { settings: { ...settings, onUnexpectedError: reportError }, context });
    return await run({ ...services, auth, access, session, context, reportError });
  } catch { return reportError(); }
}

export async function createHubAccess(request: Request, { settings, context }: { settings: HubAuthSettings; context: RequestContext }): Promise<{
  auth: Awaited<ReturnType<typeof createHubAuth>>; access: AccessRequest; session: AccessSession | null;
}> {
  const auth = await createHubAuth({ ...settings, requestContext: context });
  const nativeSession = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  const session: AccessSession | null = nativeSession
    ? { loginId: nativeSession.user.id, hubSessionId: nativeSession.session.id } : null;
  const access = await createAccessRequest({ app: "hub", session,
    workspaceId: null, context,
    hub: { async validateAccess(value) { return await validateHubLocalAccess(settings.database, value); } },
  });
  return { auth, access, session };
}
