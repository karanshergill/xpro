import { WorkerEntrypoint } from "cloudflare:workers";
import { object, nullable, pipe, safeParse, strictObject, string, uuid } from "valibot";
import type { HubAccessResult } from "@xpro/core/server";
import { validateHubAccess } from "./validate-access.server";

const idSchema = pipe(string(), uuid());
const inputSchema = strictObject({
  loginId: idSchema, hubSessionId: idSchema, workspaceId: nullable(idSchema),
  context: object({ requestId: idSchema }),
});

export class HubAccess extends WorkerEntrypoint<{ DB: D1Database }> {
  async validateAccess(input: unknown): Promise<HubAccessResult> {
    const parsed = safeParse(inputSchema, input);
    if (!parsed.success) return { status: "invalid", code: "core_unauthenticated" };
    return await validateHubAccess(this.env.DB, parsed.output);
  }
}
