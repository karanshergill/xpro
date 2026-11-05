import { secureResponse } from "@xpro/core/server";
import type { HubPlacementBinding } from "@xpro/stms";
import { handleRouterRequest } from "./routing.server";

type LocalEnvironment = { PLACEMENTS: KVNamespace; HUB_PLACEMENT: HubPlacementBinding; HUB_ORIGIN: string; HUB: Fetcher; LOCAL_WORKSPACE: Fetcher };

export default {
  async fetch(request: Request, env: LocalEnvironment, ctx: ExecutionContext): Promise<Response> {
    return secureResponse(await handleRouterRequest(request, { placements: env.PLACEMENTS, hubPlacement: env.HUB_PLACEMENT,
      hubOrigin: env.HUB_ORIGIN, hub: env.HUB, execution: ctx, dispatch: { get(workerName) {
        // shortcut: local development has one prepared app. Use a staging dispatch
        // namespace before verifying routing among deployed workspace Workers.
        if (workerName !== "xpro") throw new Error("The local workspace app is not configured.");
        return env.LOCAL_WORKSPACE;
      } } }));
  },
} satisfies ExportedHandler<LocalEnvironment>;
