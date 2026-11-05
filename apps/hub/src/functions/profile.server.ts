import { updateProfile, changePassword, type ChangePasswordServices } from "@xpro/accounts/server";
import { createErrorResponse, requestIdHeader, type RequestContext } from "@xpro/core/server";
import type { HubAuthSettings, createHubAuth } from "#auth/auth.server.ts";
import { isAPIError } from "better-auth/api";
import { withProfileRequest } from "./profile-request.server";

type Services = { request: Request; settings: HubAuthSettings };
export async function handleUpdateProfile(input: unknown, services: Services): Promise<Response> {
  return await withProfileRequest(services, async ({ access, context, settings }) => {
    const result = await updateProfile(input, { database: settings.database, access, context });
    return result.isErr ? createErrorResponse(result.error, context) : profileResponse(result.value.loginId, context);
  });
}

export async function handleChangePassword(input: unknown, services: Services): Promise<Response> {
  return await withProfileRequest(services, async ({ auth, access, context, request, reportError }) => {
    const result = await changePassword(input, { access, context, onUnexpectedError: reportError,
      async changePassword(body) { return await changeNativePassword(body, { auth, headers: request.headers, context }); },
    });
    if (result.isOk) return profileResponse(result.value.loginId, context, result.value.headers);
    if (result.error.code !== "accounts_current_password_invalid") return createErrorResponse(result.error, context);
    return Response.json({ code: result.error.code, message: "The current password is incorrect.", requestId: context.requestId }, {
      status: 400, headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
    });
  });
}

export async function changeNativePassword(input: Parameters<ChangePasswordServices["changePassword"]>[0], services: {
  auth: Awaited<ReturnType<typeof createHubAuth>>; headers: HeadersInit; context: RequestContext;
}): Promise<Response> {
  let response: Response;
  try { response = await services.auth.api.changePassword({ body: input, headers: services.headers, asResponse: true }); }
  catch (error) {
    if (isAPIError(error) && error.statusCode < 500) {
      const expected = passwordGuardRefusal(error.body?.code, services.context);
      if (expected) return expected;
    }
    throw error;
  }
  if (response.status >= 400 && response.status < 500) {
    const body: unknown = await response.clone().json().catch((): unknown => null);
    const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
    const expected = passwordGuardRefusal(code, services.context);
    if (expected) return expected;
  }
  return response;
}

function passwordGuardRefusal(code: unknown, context: RequestContext): Response | null {
  return code === "core_identity_changed" || code === "core_unauthenticated" || code === "core_login_inactive" || code === "core_creation_incomplete"
    || code === "core_mfa_required" || code === "core_forbidden" ? createErrorResponse({ code }, context) : null;
}

function profileResponse(loginId: string, context: RequestContext, cookies?: Headers): Response {
  const headers = new Headers(cookies);
  headers.set(requestIdHeader, context.requestId);
  headers.set("cache-control", "no-store");
  return Response.json({ loginId }, { headers });
}
