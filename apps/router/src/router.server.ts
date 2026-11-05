import { handleRouterRequest } from "./routing.server";
import { createRequestContext, reportUnexpectedError, secureResponse } from "@xpro/core/server";

export default {
  async fetch(request: Request, env: RouterEnv, ctx: ExecutionContext): Promise<Response> {
    if (!env.DISPATCHER) return secureResponse(reportUnexpectedError(createRequestContext(), { app: "router", operation: "core_router_fetch" }));
    return secureResponse(await handleRouterRequest(request, { placements: env.PLACEMENTS, hubPlacement: env.HUB_PLACEMENT,
      hubOrigin: env.HUB_ORIGIN, hub: env.HUB, dispatch: env.DISPATCHER, execution: ctx }));
  },
} satisfies ExportedHandler<RouterEnv>;
