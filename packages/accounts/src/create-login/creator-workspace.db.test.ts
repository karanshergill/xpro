import { env } from "cloudflare:workers";
import { CompiledQuery } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createCreationFixture, type CreationFixture } from "#test/create-login";
import { creatorWorkspaceQuery, readCreatorWorkspace } from "./creator-workspace.db";

let fixture: CreationFixture;
beforeEach(async () => { fixture = await createCreationFixture(); });
afterEach(async () => { await fixture.signIn.identities.db.destroy(); });

it("when creation reads a tenant's scope then only their own workspace is returned through indexed native membership", async () => {
  const owner = await fixture.actor("owner"), master = await fixture.actor("master");
  expect(await readCreatorWorkspace(env.DB, owner.loginId)).toEqual({ workspaceId: fixture.workspace.id, name: "Prepared workspace" });
  expect(await readCreatorWorkspace(env.DB, master.loginId)).toBeNull();
  const db = fixture.signIn.identities.db, query = creatorWorkspaceQuery(db, owner.loginId);
  const plan = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
  expect(plan.rows.some((step) => step.detail.startsWith("SEARCH"))).toBe(true);
  expect(plan.rows.filter((step) => step.detail.startsWith("SCAN"))).toEqual([]);
});
