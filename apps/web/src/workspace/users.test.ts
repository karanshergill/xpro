import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { createRequestContext, createWorkspaceDatabase, type WorkspaceUserInput } from "@xpro/core/server";
import { describe, expect, it } from "vitest";
import { handleWorkspaceUserRequest } from "./users.server";

describe("Private workspace user transport", () => {
  it("when the Hub's private RPC binding creates a configured workspace user then retries return its saved receipt", async () => {
    const input = creation();
    const expected = { variant: "Ok", value: { workspaceId: input.workspaceId, loginId: input.loginId, kind: input.kind } };
    expect(await env.WORKSPACE_USERS.ensure(input, createRequestContext())).toEqual(expected);
    const saved = await users(input.workspaceId);
    expect(saved).toHaveLength(1);
    expect(await env.WORKSPACE_USERS.ensure(input, createRequestContext())).toEqual(expected);
    expect(await users(input.workspaceId)).toEqual(saved);
  });

  it("when a private RPC names another deployment then it cannot create a user there", async () => {
    const input = { ...creation(), workspaceId: crypto.randomUUID() };
    expect(await env.WORKSPACE_USERS.ensure(input, createRequestContext())).toEqual({ variant: "Err", error: { code: "core_forbidden" } });
    expect(await users(input.workspaceId)).toEqual([]);
  });

  it("when direct namespace RPC chooses a different deployment's object then it cannot bypass the Worker scope", async () => {
    const input = { ...creation(), workspaceId: crypto.randomUUID() };
    const stub = env.WORKSPACES.getByName(input.workspaceId);
    expect(await stub.ensureCreatedWorkspaceUser(input, createRequestContext())).toEqual({ variant: "Err", error: { code: "core_forbidden" } });
    expect(await users(input.workspaceId)).toEqual([]);
  });

  it("when direct namespace RPC addresses the wrong object for the configured workspace then no user is saved", async () => {
    const input = creation();
    const actualId = crypto.randomUUID();
    expect(await env.WORKSPACES.getByName(actualId).ensureCreatedWorkspaceUser(input, createRequestContext()))
      .toEqual({ variant: "Err", error: { code: "core_forbidden" } });
    expect(await users(actualId)).toEqual([]);
  });

  it.each(["body", "headers", "missing props", "wrong method"] as const)("when a public request uses %s then it cannot supply the private capability", async (attempt) => {
    const input = creation();
    const props = { creation: input, context: createRequestContext() };
    const request = new Request("https://workspace.test/_internal/workspace-users", {
      method: attempt === "wrong method" ? "GET" : "POST",
      headers: attempt === "headers" ? { "x-xpro-creation": JSON.stringify(input), "x-xpro-role": "admin" } : {},
      ...(attempt === "body" ? { body: JSON.stringify(props) } : {}),
    });
    const response = await handleWorkspaceUserRequest({ request, props: attempt === "wrong method" ? props : undefined }, env);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "core_forbidden" });
    expect(await users(input.workspaceId)).toEqual([]);
  });

  it("when a dispatch invocation supplies valid private props then the real object saves the user", async () => {
    const input = creation();
    const response = await handleWorkspaceUserRequest({ request: new Request("https://workspace.test/_internal/workspace-users", { method: "POST" }),
      props: { creation: input, context: createRequestContext() } }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ variant: "Ok", value: { workspaceId: input.workspaceId, loginId: input.loginId, kind: input.kind } });
    expect(await users(input.workspaceId)).toHaveLength(1);
  });
});

function creation(): WorkspaceUserInput {
  return { creationId: crypto.randomUUID(), workspaceId: env.WORKSPACE_ID, loginId: crypto.randomUUID(), kind: "internal" };
}
async function users(workspaceId: string) {
  return await runInDurableObject(env.WORKSPACES.getByName(workspaceId), async (_instance, state) => {
    const db = createWorkspaceDatabase(state.storage.sql);
    try { return await db.selectFrom("workspaceUsers").selectAll().execute(); }
    finally { await db.destroy(); }
  });
}
