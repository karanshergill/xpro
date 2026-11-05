import { env } from "cloudflare:workers";
import type { CoreError } from "@xpro/core/server";
import type { Result } from "true-myth/result";
import { handleCreateLogin as handle } from "../../apps/hub/src/functions/create-login.server";
import { saveCreatedWorkspaceUser as saveUser } from "../../packages/core/src/workspace-users/workspace-users.db";
import { handleHubAuthRequest } from "../../apps/hub/src/auth/oidc.server";
import { createSignInFixture, hubRequest, withWorkspace, type SignInFixture } from "./sign-in";
import type { SignedInLogin } from "./hub-identities";
import { preparePlacement, type PreparedWorkspace } from "./routing";

export type CreationInput = {
  creationId: string; email: string; username: string; name: string;
  phone: { country: string; number: string }; password: string;
  workspaceId?: string; kind?: "internal" | "external";
};
export type WorkspaceUserInput = { creationId: string; workspaceId: string; loginId: string; kind: "internal" | "external" };
export type WorkspaceUserReceipt = { workspaceId: string; loginId: string; kind: "internal" | "external" };
export type WorkspaceUsers = { ensure(input: WorkspaceUserInput): Promise<ReturnType<Result<WorkspaceUserReceipt, CoreError>["toJSON"]>> };
type HubCreationServices = { request: Request; settings: SignInFixture["settings"]; workspaceUsers: WorkspaceUsers };
const handleCreateLogin: (input: unknown, services: HubCreationServices) => Promise<Response> = handle;
const saveCreatedWorkspaceUser: (input: WorkspaceUserInput, services: { storage: DurableObjectStorage; workspaceId: string }) =>
  Promise<Result<WorkspaceUserReceipt, CoreError>> = saveUser;
export type CreationFixture = {
  signIn: SignInFixture; workspace: PreparedWorkspace; other: PreparedWorkspace; workspaceUsers: WorkspaceUsers;
  actor(role: "master" | "owner" | "admin" | "member"): Promise<SignedInLogin>;
  submit(input: unknown, options: { creator: SignedInLogin | null; database?: D1Database; workspaceUsers?: WorkspaceUsers; headers?: HeadersInit }): Promise<Response>;
};

export async function createCreationFixture(): Promise<CreationFixture> {
  const signIn = await createSignInFixture(env.DB);
  try {
    const workspace = await preparePlacement(signIn);
    const unrelated = await signIn.identities.createLogin();
    const other = await preparePlacement(signIn, { loginId: unrelated.loginId });
    const workspaces = [workspace, other];
    const workspaceUsers: WorkspaceUsers = { async ensure(input) {
      const target = workspaces.find((current) => current.id === input.workspaceId);
      if (!target) throw new Error("No prepared workspace transport.");
      // Adapt only the transport. The real Core action owns validation and saving.
      return await withWorkspace(target, async ({ storage }) =>
        (await saveCreatedWorkspaceUser(input, { storage, workspaceId: target.id })).toJSON());
    } };
    return { signIn, workspace, other, workspaceUsers,
      async actor(role) {
        if (role === "owner") {
          const owner = await signIn.identities.db.withoutPlugins().selectFrom("member").innerJoin("user", "user.id", "member.userId")
            .select(["user.id as loginId", "user.email"]).where("member.organizationId", "=", workspace.id)
            .where("member.role", "=", "owner").executeTakeFirstOrThrow();
          return await signIn.signIn(owner, handleHubAuthRequest);
        }
        const created = await signIn.identities.createLogin({ role: role === "master" ? "admin" : "user" });
        if (role !== "master") await signIn.identities.auth.api.addMember({ body: {
          userId: created.loginId, organizationId: workspace.id, role,
        } });
        return await signIn.signIn(created, handleHubAuthRequest);
      },
      async submit(input, options) {
        const request = hubRequest("/_server/create-login", input, options.creator?.cookie);
        const headers = new Headers(request.headers);
        for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
        return await handleCreateLogin(input, { request: new Request(request, { headers }),
          settings: { ...signIn.settings, database: options.database ?? env.DB },
          workspaceUsers: options.workspaceUsers ?? workspaceUsers });
      },
    };
  } catch (error) { await signIn.identities.db.destroy(); throw error; }
}

export function creationInput(workspace?: PreparedWorkspace): CreationInput {
  return { creationId: crypto.randomUUID(), email: `created-${crypto.randomUUID()}@example.test`,
    username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7), name: "Created person",
    phone: { country: "US", number: "2025550123" }, password: "Created-person123!",
    ...(workspace ? { workspaceId: workspace.id, kind: "internal" } : {}),
  };
}
