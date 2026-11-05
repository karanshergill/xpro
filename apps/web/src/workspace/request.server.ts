import { pageLoginIdHeader } from "@xpro/core";
import { prepareServerFunctionRequest, clearWorkspaceSessionCookie, createErrorResponse, createWorkspaceAccessRequest, reportUnexpectedError,
  requestIdHeader, type AccessActor, type AccessRequest, type CoreError, type RequestContext, type SessionServices } from "@xpro/core/server";
import { finishSignIn, startSignIn, type SignInServices } from "#auth/oidc.server.ts";
import { receiveHubSignOut, signOut } from "#auth/sign-out.server.ts";
import { readWorkspaceUserKind } from "./access.db";

export type WorkspaceRequestContext = {
  workspaceId: string; storage: DurableObjectStorage; access: AccessRequest; actor: AccessActor;
  kind: "internal" | "external"; context: RequestContext;
};
export type WorkspaceRequestServices = SignInServices & SessionServices & {
  render(request: Request, context: WorkspaceRequestContext): Promise<Response>;
};

export async function handleWorkspaceRequest(request: Request, services: WorkspaceRequestServices): Promise<Response> {
  try {
    const url = new URL(request.url);
    const workspaceHint = request.headers.get("x-xpro-workspace-id");
    if (url.origin !== services.origin || (workspaceHint !== null && workspaceHint !== services.workspaceId)) {
      return createErrorResponse({ code: "core_forbidden" }, services.context);
    }
    switch (url.pathname) {
      case "/auth/start": return await startSignIn(request, services);
      case "/auth/callback": return await finishSignIn(request, services);
      case "/auth/sign-out": return await signOut(request, services);
      case "/auth/back-channel-sign-out": return await receiveHubSignOut(request, services);
    }
    if (url.pathname.startsWith("/auth/")) return new Response(null, { status: 404 });
    const isRead = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
    if (!isRead && request.headers.get("origin") !== services.origin) return createErrorResponse({ code: "core_forbidden" }, services.context);
    if (url.pathname.startsWith("/_serverFn/")) {
      const prepared = await prepareServerFunctionRequest(request, { baseURL: services.origin, context: services.context });
      if (prepared instanceof Response) return prepared;
      request = prepared;
    }
    const access = await createWorkspaceAccessRequest(request, services);
    const actor = access.authorize({ kind: "protected", hasLocalPermission: true });
    if (actor.isErr) return accessFailure(request, { services, error: actor.error });
    // This optional UI precondition grants no authority. Authenticate first,
    // then reject a request belonging to a different mounted login.
    const expectedLoginId = request.headers.get(pageLoginIdHeader);
    if (expectedLoginId !== null && expectedLoginId !== actor.value.loginId) {
      return createErrorResponse({ code: "core_identity_changed" }, services.context);
    }
    const kind = actor.value.isMaster ? "internal" : await readWorkspaceUserKind(services.storage, actor.value.loginId);
    if (!kind) return accessFailure(request, { services, error: { code: "core_forbidden" } });
    if (url.pathname === "/" && kind === "external" && isPageNavigation(request)) return redirect(services.origin + "/portal", services.context);
    const response = await services.render(request, { workspaceId: services.workspaceId, storage: services.storage,
      access, actor: actor.value, kind, context: services.context });
    const headers = new Headers(response.headers);
    headers.set(requestIdHeader, services.context.requestId);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch { return reportUnexpectedError(services.context, { app: "workspace", operation: "core_workspace_request" }); }
}

function accessFailure(request: Request, input: { services: WorkspaceRequestServices; error: CoreError }): Response {
  const { services, error } = input;
  if (!isPageNavigation(request)) return createErrorResponse(error, services.context);
  let target: string;
  switch (error.code) {
    case "core_unauthenticated":
      target = services.origin + "/auth/start?returnTo=" + encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search);
      break;
    case "core_forbidden":
    case "core_login_inactive": target = new URL(services.issuer).origin + "/auth/destination"; break;
    case "core_profile_incomplete": target = new URL(services.issuer).origin + "/complete-profile"; break;
    default: return createErrorResponse(error, services.context);
  }
  const response = redirect(target, services.context);
  response.headers.append("set-cookie", clearWorkspaceSessionCookie());
  return response;
}

function isPageNavigation(request: Request): boolean {
  const isRead = request.method === "GET" || request.method === "HEAD";
  return isRead && (request.headers.get("sec-fetch-mode") === "navigate" || (request.headers.get("accept")?.includes("text/html") ?? false));
}

function redirect(location: string, context: RequestContext): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", [requestIdHeader]: context.requestId } });
}
