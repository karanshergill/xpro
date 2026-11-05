import { pageLoginIdHeader } from "@xpro/core";
import { createErrorResponse, type AccessActor, type AccessRequest, type CoreError } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { withHubRequest } from "./hub-request.server";

export async function withProfileRequest(services: Parameters<typeof withHubRequest>[0], run: Parameters<typeof withHubRequest>[1]): Promise<Response> {
  return await withHubRequest(services, async (prepared) => {
    const actor = authorizeProfileActor(prepared.request, prepared.access);
    return actor.isErr ? createErrorResponse(actor.error, prepared.context) : await run(prepared);
  });
}

export function authorizeProfileActor(request: Request, access: AccessRequest): Result<AccessActor, CoreError> {
  const actor = access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  const expected = request.headers.get(pageLoginIdHeader);
  if (expected !== null && expected !== actor.value.loginId) return err({ code: "core_identity_changed" });
  return ok(actor.value);
}
