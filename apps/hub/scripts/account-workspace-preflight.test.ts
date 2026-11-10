import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { createHubConnection, saveHub } from "@xpro/core/server";
import { sql, type Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubAuth } from "#auth/auth.server.ts";
import { createHubMigrator } from "#db/hub.db.ts";
import type { HubIdentities } from "#test/hub-identities";
import { readAccountWorkspacePreflight } from "./account-workspace-preflight.db";

type LegacyTables = {
  accounts: { id: string; ownerLoginId: string; createdAt: string };
  user: { id: string; name: string; role: string | null };
  member: { id: string; organizationId: string };
};
let db: Kysely<LegacyTables>;
let auth: HubIdentities["auth"];
const previousMigration = "2026-10-31-014344-master-mfa";

beforeEach(async () => {
  db = await createHubConnection<LegacyTables>(env.DB);
  const migrated = await createHubMigrator(db).migrateTo(previousMigration);
  if (migrated.error) throw migrated.error;
  auth = await createHubAuth({ database: env.DB, baseURL: "https://hub.example.test",
    secret: crypto.randomUUID() + crypto.randomUUID() });
  await (await auth.$context).checkSchema?.();
});
afterEach(async () => { await db.destroy(); });

describe("retained account/workspace preflight", () => {
  it("when native tables have not been initialized then it reports missing tables without creating them", async () => {
    await reset();
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({
      status: "uninitialized", missingTables: ["accounts", "organization", "member"],
    });
    expect((await db.introspection.getTables()).map((table) => table.name)).not.toContain("accounts");
  });

  it("when the old schema has no retained records then no mapping is invented", async () => {
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "clear", issues: [] });
    expect(await db.selectFrom("accounts").selectAll().execute()).toEqual([]);
  });

  it("when a retained holder has duplicate accounts then only those accounts are identified and no records change", async () => {
    const first = await createLogin();
    const second = await createLogin();
    const accounts = await createAccounts([first, first, second]);
    const before = await db.selectFrom("user").select(["id", "name", "role"]).orderBy("id").execute();
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_duplicate_account_holder", recordIds: accounts.slice(0, 2).map((row) => row.id).sort(), hasMore: false },
      { code: "stms_missing_account_name", recordIds: accounts.map((row) => row.id).sort(), hasMore: false },
    ] });
    expect(await db.selectFrom("accounts").selectAll().orderBy("id").execute()).toEqual([...accounts].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await db.selectFrom("user").select(["id", "name", "role"]).orderBy("id").execute()).toEqual(before);
  });

  it("when a retained native workspace has one owner but no account mapping then it reports the workspace without inferring a holder", async () => {
    const owner = await createLogin();
    const workspaceId = await createWorkspace(owner);
    const before = await db.selectFrom("member").selectAll().orderBy("id").execute();
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_missing_workspace_account", recordIds: [workspaceId], hasMore: false },
    ] });
    expect(await db.selectFrom("accounts").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("member").selectAll().orderBy("id").execute()).toEqual(before);
  });

  it("when a retained workspace name is whitespace then its missing label is reported without changing ownership", async () => {
    const workspaceId = await createWorkspace(await createLogin());
    await saveHub(env.DB, [sql`update organization set name = ${" \t\u00a0"} where id = ${workspaceId}`.compile(db)]);
    const before = await db.selectFrom("member").selectAll().execute();
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_missing_workspace_name", recordIds: [workspaceId], hasMore: false },
      { code: "stms_missing_workspace_account", recordIds: [workspaceId], hasMore: false },
    ] });
    expect(await db.selectFrom("member").selectAll().execute()).toEqual(before);
  });

  it.each(["none", "multiple"] as const)("when retained workspace ownership is %s then ownership requires review", async (owners) => {
    const workspaceId = await createWorkspace(await createLogin());
    if (owners === "none") {
      await saveHub(env.DB, [db.withoutPlugins().deleteFrom("member").where("organizationId", "=", workspaceId).compile()]);
    } else {
      await auth.api.addMember({ body: { organizationId: workspaceId, userId: await createLogin(), role: "owner" } });
    }
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_missing_workspace_account", recordIds: [workspaceId], hasMore: false },
      { code: "stms_workspace_owner_review", recordIds: [workspaceId], hasMore: false },
    ] });
  });

  it.each([null, " \t\n\u00a0", "Retained account"])("when an interrupted upgrade has label %j then only a real label clears its issue", async (name) => {
    const [account] = await createAccounts([await createLogin()]);
    if (!account) throw new Error("Missing account fixture.");
    await db.schema.alterTable("accounts").addColumn("name", "text").execute();
    await saveHub(env.DB, [sql`update accounts set name = ${name} where id = ${account.id}`.compile(db)]);
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual(name === "Retained account"
      ? { status: "clear", issues: [] }
      : { status: "needs_review", issues: [{ code: "stms_missing_account_name", recordIds: [account.id], hasMore: false }] });
  });

  it("when more than one hundred records need the same review then output is bounded and explicitly truncated", async () => {
    const owner = await createLogin();
    const accounts = await createAccounts(Array.from({ length: 101 }, () => owner));
    const recordIds = accounts.map((row) => row.id).sort().slice(0, 100);
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_duplicate_account_holder", recordIds, hasMore: true },
      { code: "stms_missing_account_name", recordIds, hasMore: true },
    ] });
    expect(await db.selectFrom("accounts").select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow())
      .toEqual({ count: 101 });
  });
});

async function createLogin(): Promise<string> {
  const { user } = await auth.api.createUser({ body: { name: "Preflight fixture", password: "Preflight-fixture123!",
    email: `preflight-${crypto.randomUUID()}@example.test`, data: { username: `u${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}` } } });
  return user.id;
}

async function createAccounts(owners: string[]): Promise<LegacyTables["accounts"][]> {
  const rows = owners.map((ownerLoginId) => ({ id: crypto.randomUUID(), ownerLoginId, createdAt: new Date().toISOString() }));
  const statements = [];
  for (let index = 0; index < rows.length; index += 25) {
    statements.push(db.insertInto("accounts").values(rows.slice(index, index + 25)).compile());
  }
  await saveHub(env.DB, statements);
  return rows;
}

async function createWorkspace(owner: string): Promise<string> {
  const workspace = await auth.api.createOrganization({ body: {
    name: "Retained workspace", slug: `preflight-${crypto.randomUUID()}`, userId: owner,
  } });
  if (!workspace) throw new Error("Native workspace creation failed.");
  return workspace.id;
}
