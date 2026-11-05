import { parseInput, reportUnexpectedError, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { optional, pipe, string, uuid } from "valibot";
import { readDestinations } from "./sign-in.db";

export type SignInDestination = { kind: "workspace"; workspaceId: string } | { kind: "stms" | "account" | "unassigned" };
type Services = { database: D1Database; access: AccessRequest; context: RequestContext };

export async function getSignInDestination(input: unknown, services: Services): Promise<Result<SignInDestination, CoreError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, { requestedWorkspaceId: optional(pipe(string(), uuid())) });
  if (parsed.isErr) return err(parsed.error);
  try {
    const { loginId, isMaster } = actor.value;
    const destinations = await readDestinations(services.database, { loginId, ...parsed.value });
    const requested = destinations.requestedWorkspaceId;
    if (requested && (isMaster || requested === destinations.workspaceId)) return ok({ kind: "workspace", workspaceId: requested });
    if (isMaster) return ok({ kind: "stms" });
    if (destinations.workspaceId) return ok({ kind: "workspace", workspaceId: destinations.workspaceId });
    return ok({ kind: destinations.accountId ? "account" : "unassigned" });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_sign_in_destination" });
    return err({ code: "core_unexpected_error" });
  }
}
