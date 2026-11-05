import { createErrorResponse, createRequestContext, reportUnexpectedError, requestIdHeader } from "@xpro/core/server";
import { isHttpsOrigin, readPlacement, type HubPlacementBinding } from "@xpro/stms";

export type RouterServices = {
  placements: KVNamespace; hubPlacement: HubPlacementBinding; hubOrigin: string;
  hub: { fetch(request: Request): Promise<Response> };
  dispatch: { get(workerName: string): { fetch(request: Request): Promise<Response> } };
  execution: Pick<ExecutionContext, "waitUntil">;
};
const workspaceIdHeader = "x-xpro-workspace-id";

export async function handleRouterRequest(request: Request, services: RouterServices): Promise<Response> {
  const context = createRequestContext();
  try {
    if (!isHttpsOrigin(services.hubOrigin)) throw new Error("The router requires a fixed HTTPS Hub origin.");
    const url = new URL(request.url);
    if (!isHttpsOrigin(url.origin)) return createErrorResponse({ code: "core_forbidden" }, context);
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      if (name.startsWith("x-xpro-") || ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port"].includes(name)) headers.delete(name);
    }
    headers.set(requestIdHeader, context.requestId);
    if (url.origin === services.hubOrigin) {
      return await services.hub.fetch(new Request(request, { headers, redirect: "manual" }));
    }
    const key = "origin:" + url.origin;
    const cached: unknown = await services.placements.get(key, "json");
    let placement = readPlacement(cached, url.origin);
    if (!placement) {
      const lookup = await services.hubPlacement.resolvePlacement({ origin: url.origin, context });
      if (lookup.status === "found") {
        placement = readPlacement(lookup.placement, url.origin);
        if (!placement) throw new Error("The Hub returned invalid placement.");
        services.execution.waitUntil(services.placements.put(key, JSON.stringify(placement))
          .catch(() => { reportUnexpectedError(context, { app: "router", operation: "stms_cache_placement" }); }));
      } else if (lookup.status !== "missing") throw new Error("The placement service is unavailable.");
    }
    if (!placement) {
      if (request.method !== "GET" && request.method !== "HEAD") return createErrorResponse({ code: "core_forbidden" }, context);
      return new Response(null, { status: 302, headers: { location: services.hubOrigin + "/auth/destination",
        "cache-control": "no-store", [requestIdHeader]: context.requestId } });
    }
    headers.set(workspaceIdHeader, placement.workspaceId);
    // shortcut: KV routing can lag. Keep workspace identity/access authoritative;
    // add explicit cache invalidation before supporting live address remapping.
    return await services.dispatch.get(placement.workerName).fetch(new Request(request, { headers, redirect: "manual" }));
  } catch { return reportUnexpectedError(context, { app: "router", operation: "core_router_request" }); }
}
