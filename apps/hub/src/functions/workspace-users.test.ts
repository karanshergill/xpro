import { env } from "cloudflare:workers";
import { createRequestContext, saveHub, type WorkspaceUserInput } from "@xpro/core/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignInFixture, readHubState, type SignInFixture } from "#test/sign-in";
import { preparePlacement, type PreparedWorkspace } from "#test/routing";
import { handleWorkspaceUserRequest } from "#test/workspace-users";
import { createWorkspaceUsers } from "./workspace-users.server";

let fixture: SignInFixture;
let workspace: PreparedWorkspace;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); workspace = await preparePlacement(fixture); });
afterEach(async () => { await fixture.identities.db.destroy(); });

describe("Hub workspace creation transport", () => {
  it("when dispatch selects a configured app then only private props carry creation and request context", async () => {
    const input = creation();
    const context = createRequestContext();
    const outgoing: unknown[] = [];
    const writer = createWorkspaceUsers({ database: env.DB, DISPATCHER: { get(workerName, args) {
      return { async fetch(request) {
        outgoing.push({ workerName, args, url: request.url, method: request.method, headers: [...request.headers], body: await request.text() });
        // Real receiving policy: this test app has another fixed deployment ID.
        return await handleWorkspaceUserRequest({ request, props: args.props }, env);
      } };
    } } });
    const before = await readHubState(fixture.identities);
    expect(await writer.ensure(input, context)).toEqual({ variant: "Err", error: { code: "core_forbidden" } });
    expect(outgoing).toEqual([{ workerName: workspace.workerName, args: { props: { creation: input, context } },
      url: workspace.origin + "/_internal/workspace-users", method: "POST", headers: [], body: "" }]);
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when the local binding reaches an app with another fixed workspace then it returns that real scope refusal", async () => {
    await saveHub(env.DB, [fixture.identities.db.updateTable("workspacePlacements").set({ workerName: "xpro" }).where("id", "=", workspace.placementId).compile()]);
    const writer = createWorkspaceUsers({ database: env.DB, WORKSPACE_USERS: env.WORKSPACE_USERS });
    expect(await writer.ensure(creation(), createRequestContext())).toEqual({ variant: "Err", error: { code: "core_forbidden" } });
  });

  it("when the namespace is unavailable then creation does not fall back to a public request", async () => {
    const writer = createWorkspaceUsers({ database: env.DB, DISPATCHER: { get() { throw new Error("test_namespace_unavailable"); } } });
    const before = await readHubState(fixture.identities);
    await expect(writer.ensure(creation(), createRequestContext())).rejects.toThrow("test_namespace_unavailable");
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when the local directory names an unprepared app then it refuses without calling the local writer", async () => {
    const writer = createWorkspaceUsers({ database: env.DB, WORKSPACE_USERS: env.WORKSPACE_USERS });
    await expect(writer.ensure(creation(), createRequestContext())).rejects.toThrow("The local workspace app is not configured.");
  });

  it("when a workspace has no saved placement then the private call refuses without changing Hub state", async () => {
    const writer = createWorkspaceUsers({ database: env.DB, WORKSPACE_USERS: env.WORKSPACE_USERS });
    const before = await readHubState(fixture.identities);
    await expect(writer.ensure({ ...creation(), workspaceId: crypto.randomUUID() }, createRequestContext())).rejects.toThrow("The workspace app is not prepared.");
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when neither or both transports are configured then setup fails rather than choosing implicitly", () => {
    expect(() => createWorkspaceUsers({ database: env.DB })).toThrow("Exactly one");
    expect(() => createWorkspaceUsers({ database: env.DB, WORKSPACE_USERS: env.WORKSPACE_USERS,
      DISPATCHER: { get() { throw new Error("Unused"); } } })).toThrow("Exactly one");
  });

  it("when a local binding lacks its native method then setup refuses it", () => {
    expect(() => createWorkspaceUsers({ database: env.DB, WORKSPACE_USERS: {} })).toThrow("The local workspace creation binding is invalid.");
  });
});

function creation(): WorkspaceUserInput {
  return { creationId: crypto.randomUUID(), workspaceId: workspace.id, loginId: crypto.randomUUID(), kind: "internal" };
}
