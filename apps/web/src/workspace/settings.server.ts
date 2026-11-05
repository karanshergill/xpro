import { err, ok, type Result } from "true-myth/result";
import { array, check, minLength, object, pipe, safeParse, string, uuid } from "valibot";
import type { CoreError, HubAccessBinding } from "@xpro/core/server";
import type { SignInServices } from "#auth/oidc.server.ts";
import type { Workspace } from "./workspace.db";

// The same explicit binding contract is visible to the Worker and its data object.
export type WorkspaceEnvironment = {
  WORKSPACE_ID: string; WORKSPACE_ORIGINS: string; HUB_ORIGIN: string;
  OIDC_CLIENT_ID: string; OIDC_CLIENT_SECRET: string; WORKSPACE_SESSION_SECRET: string;
  WORKSPACES: DurableObjectNamespace<Workspace>; HUB: SignInServices["hub"]; HUB_ACCESS: HubAccessBinding;
};
const originSchema = pipe(string(), check(isHttpsOrigin));
const settingsSchema = object({
  workspaceId: pipe(string(), uuid()), origins: pipe(array(originSchema), minLength(1)),
  hubOrigin: originSchema, clientId: pipe(string(), minLength(1)), clientSecret: pipe(string(), minLength(1)),
  secret: pipe(string(), minLength(32)),
});

export function readWorkspaceSettings(request: Request, env: WorkspaceEnvironment): Result<Omit<SignInServices, "context">, CoreError> {
  const parsed = safeParse(settingsSchema, {
    workspaceId: env.WORKSPACE_ID, origins: JSON.parse(env.WORKSPACE_ORIGINS), hubOrigin: env.HUB_ORIGIN,
    clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET, secret: env.WORKSPACE_SESSION_SECRET,
  });
  if (!parsed.success) throw new Error("The workspace settings are incomplete or invalid.");
  const origin = new URL(request.url).origin;
  const requestedWorkspaceId = request.headers.get("x-xpro-workspace-id");
  if (!parsed.output.origins.includes(origin) || (requestedWorkspaceId !== null && requestedWorkspaceId !== parsed.output.workspaceId)) {
    return err({ code: "core_forbidden" });
  }
  return ok({ workspaceId: parsed.output.workspaceId, origin, issuer: parsed.output.hubOrigin + "/api/auth",
    clientId: parsed.output.clientId, clientSecret: parsed.output.clientSecret, secret: parsed.output.secret, hub: env.HUB });
}

function isHttpsOrigin(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === value; }
  catch { return false; }
}
