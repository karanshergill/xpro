import { WorkerEntrypoint } from "cloudflare:workers";
import { httpsOriginSchema, type PlacementLookup } from "@xpro/stms";
import { resolvePlacement } from "@xpro/stms/server";
import { reportUnexpectedError } from "@xpro/core/server";
import { object, pipe, safeParse, strictObject, string, uuid } from "valibot";

const inputSchema = strictObject({ origin: httpsOriginSchema, context: object({ requestId: pipe(string(), uuid()) }) });

export class HubPlacement extends WorkerEntrypoint<{ DB: D1Database }> {
  async resolvePlacement(input: unknown): Promise<PlacementLookup> {
    const parsed = safeParse(inputSchema, input);
    if (!parsed.success) return { status: "missing" };
    try {
      const placement = await resolvePlacement(this.env.DB, parsed.output.origin);
      return placement ? { status: "found", placement } : { status: "missing" };
    } catch {
      reportUnexpectedError(parsed.output.context, { app: "hub", operation: "stms_resolve_placement" });
      return { status: "unavailable" };
    }
  }
}
