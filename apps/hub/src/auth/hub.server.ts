import { getSignInDestination } from "@xpro/accounts/server";
import { createAccessRequest, createErrorResponse, createRequestContext, reportUnexpectedError, requestIdHeader,
  type RequestContext } from "@xpro/core/server";
import { isHttpsOrigin } from "@xpro/stms";
import { readWorkspaceOrigin } from "@xpro/stms/server";
import { createHubAuth } from "./auth.server";
import { handleHubAuthRequest, type HubRequestSettings } from "./oidc.server";
import { validateHubLocalAccess } from "./validate-access.server";

export async function handleHubRequest(request: Request, settings: HubRequestSettings): Promise<Response | null> {
  const url = new URL(request.url);
  const context = createRequestContext();
  let hasReportedError = false;
  const reportError = (): Response => {
    if (hasReportedError) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReportedError = true;
    return reportUnexpectedError(context, { app: "hub", operation: "core_hub_request" });
  };
  try {
    const origin = new URL(settings.baseURL).origin;
    if (!isHttpsOrigin(origin) || url.origin !== origin) return createErrorResponse({ code: "core_forbidden" }, context);
    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/.well-known/oauth-authorization-server/api/auth") {
      return await handleHubAuthRequest(request, settings);
    }
    if (url.pathname !== "/" && url.pathname !== "/auth/destination" && url.pathname !== "/account") return null;
    if (request.method !== "GET" && request.method !== "HEAD") return createErrorResponse({ code: "core_forbidden" }, context);
    const auth = await createHubAuth({ ...settings, requestContext: context, onUnexpectedError: reportError });
    const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
    if (!session) return redirect(origin + "/sign-in", context);
    const access = await createAccessRequest({ app: "hub", session: { loginId: session.user.id, hubSessionId: session.session.id },
      workspaceId: null, context, hub: { async validateAccess(input) { return await validateHubLocalAccess(settings.database, input); } } });
    if (url.searchParams.getAll("requestedWorkspaceId").length > 1) return createErrorResponse({ code: "core_invalid_input", fields: ["requestedWorkspaceId"] }, context);
    const requestedWorkspaceId = url.searchParams.get("requestedWorkspaceId");
    const destinationSearch = requestedWorkspaceId === null ? "" : "?" + new URLSearchParams({ requestedWorkspaceId });
    const destination = await getSignInDestination(requestedWorkspaceId === null ? {} : { requestedWorkspaceId },
      { database: settings.database, access, context });
    if (destination.isErr) {
      if (destination.error.code === "core_mfa_required") return redirect(origin + "/mfa" + destinationSearch, context);
      if (destination.error.code === "core_profile_incomplete") return redirect(origin + "/complete-profile" + destinationSearch, context);
      if (destination.error.code === "core_unauthenticated") return redirect(origin + "/sign-in", context);
      return createErrorResponse(destination.error, context);
    }
    if (url.pathname === "/account" && destination.value.kind === "account") return null;
    switch (destination.value.kind) {
      case "workspace": {
        const target = await readWorkspaceOrigin(settings.database, destination.value.workspaceId);
        if (!target || !isHttpsOrigin(target) || target === origin) throw new Error("The workspace has no valid primary address.");
        return redirect(target, context);
      }
      case "account": return redirect(origin + "/account", context);
      case "stms": return redirect(origin + "/stms", context);
      case "unassigned": return redirect(origin + "/no-workspace", context);
    }
  } catch { return reportError(); }
}

function redirect(location: string, context: RequestContext): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", [requestIdHeader]: context.requestId } });
}
