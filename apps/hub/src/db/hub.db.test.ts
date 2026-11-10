import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { v7 } from "uuid";
import { signInAtHub } from "#test/hub-auth";
import { createHubAuth } from "#auth/auth.server.ts";
import { createHubDatabase, createHubMigrator } from "./hub.db";
import { saveHub } from "./hub-save.db";
import { authTableNames, authSchemaStatements } from "./migrations/2026-10-27-010000-auth.generated";

type HubDatabase = Awaited<ReturnType<typeof createHubDatabase>>;
type HubAuth = Awaited<ReturnType<typeof createHubAuth>>;
const origin = "https://hub.example.test";
const password = "Test-password123!";
let db: HubDatabase;
let auth: HubAuth;

beforeEach(async () => {
  db = await createHubDatabase(env.DB);
  const result = await createHubMigrator(db).migrateToLatest();
  expect(result.error).toBeUndefined();
  auth = await createHubAuth({ database: env.DB, baseURL: origin, secret: crypto.randomUUID() + crypto.randomUUID() });
  await (await auth.$context).checkSchema?.();
});
afterEach(async () => { await db.destroy(); });

describe("Hub schema", () => {
  it("when installation stops after its first real DDL statement then rerunning migrations finishes the schema", async () => {
    await reset();
    await sql.raw(authSchemaStatements[0]).execute(db);
    const result = await createHubMigrator(db).migrateToLatest();
    expect(result.error).toBeUndefined();
    expect(await db.selectFrom("reservedUsernames").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("auditEntries").selectAll().execute()).toEqual([]);
  });

  it("when the actual migrations run then all native auth tables exist and xpro tables are strict", async () => {
    const tables = (await sql<{ name: string; type: string; strict: number }>`pragma table_list`.execute(db)).rows;
    for (const name of [...authTableNames, "twoFactor"]) expect(tables.find((table) => table.name === name)?.strict, name).toBe(0);
    for (const name of ["accounts", "reserved_usernames", "login_creations", "audit_entries"]) {
      expect(tables.find((table) => table.name === name)?.strict, name).toBe(1);
    }
    const nativeTables = new Set<string>([...authTableNames, "twoFactor", "kysely_migration", "kysely_migration_lock"]);
    const unexpected = tables.filter((table) => table.type === "table" && table.strict !== 1
      && !nativeTables.has(table.name) && !table.name.startsWith("sqlite_") && !table.name.startsWith("_cf_"));
    expect(unexpected).toEqual([]);
  });

  it("when a reference is stored then its child column has an index", async () => {
    const tables = (await sql<{ name: string }>`select name from sqlite_master where type = 'table'
      and name not like 'sqlite_%' and name not like '_cf_%'`.execute(db)).rows;
    for (const { name } of tables) {
      const references = (await sql<{ from: string }>`pragma foreign_key_list(${sql.lit(name)})`.execute(db)).rows;
      const indexes = (await sql<{ name: string }>`pragma index_list(${sql.lit(name)})`.execute(db)).rows;
      const firstColumns: (string | null | undefined)[] = [];
      for (const index of indexes) {
        const columns = (await sql<{ seqno: number; name: string | null }>`pragma index_info(${sql.lit(index.name)})`.execute(db)).rows;
        firstColumns.push(columns.find((column) => column.seqno === 0)?.name);
      }
      for (const reference of references) expect(firstColumns, `${name}.${reference.from}`).toContain(reference.from);
    }
  });

  it("when a login already belongs to one workspace then adding another membership is refused", async () => {
    const first = await createWorkspace();
    const second = await createWorkspace();
    const login = await createLogin();
    await auth.api.addMember({ body: { userId: login.id, organizationId: first, role: "member" } });
    const before = await db.selectFrom("member").selectAll().orderBy("id").execute();
    await expect(auth.api.addMember({ body: { userId: login.id, organizationId: second, role: "member" } })).rejects.toThrow();
    expect(await db.selectFrom("member").selectAll().orderBy("id").execute()).toEqual(before);
  });

  it("when a login already has a password account then a second credential is refused", async () => {
    const login = await createLogin();
    const context = await auth.$context;
    const before = await db.selectFrom("account").selectAll().orderBy("id").execute();
    await expect(context.internalAdapter.linkAccount({
      userId: login.id, accountId: v7(), providerId: "credential", password: await context.password.hash(password),
    })).rejects.toThrow();
    expect(await db.selectFrom("account").selectAll().orderBy("id").execute()).toEqual(before);
  });

  it.each(["email", "username"] as const)("when %s differs only by capitalization and surrounding spaces then the database refuses the duplicate", async (field) => {
    const first = await createLogin();
    const second = await createLogin();
    const before = await db.selectFrom("user").selectAll().orderBy("id").execute();
    await expect(saveHub(env.DB, [db.updateTable("user").set({ [field]: ` ${first[field].toUpperCase()} ` }).where("id", "=", second.id).compile()])).rejects.toThrow();
    expect(await db.selectFrom("user").selectAll().orderBy("id").execute()).toEqual(before);
  });

  it("when a username has been reserved then native creation and renaming cannot reuse it", async () => {
    const login = await createLogin();
    const username = `r${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}`;
    const reserved = { id: v7(), username, addedAt: new Date().toISOString() };
    await saveHub(env.DB, [db.insertInto("reservedUsernames").values(reserved).compile()]);
    const before = await db.selectFrom("user").selectAll().orderBy("id").execute();
    await expect(auth.api.createUser({ body: { name: "Reserved name", email: `reserved-${v7()}@example.test`, password, data: { username } } })).rejects.toThrow();
    await expect((await auth.$context).internalAdapter.updateUser(login.id, { username })).rejects.toThrow();
    expect(await db.selectFrom("user").selectAll().orderBy("id").execute()).toEqual(before);
    expect(await db.selectFrom("reservedUsernames").selectAll().execute()).toEqual([reserved]);
  });

  it("when two logins claim the same creation reference then the second link is refused", async () => {
    const creator = await createLogin();
    const first = await createLogin();
    const second = await createLogin();
    const creation = makeCreation(creator.id);
    await saveHub(env.DB, [db.insertInto("loginCreations").values(creation).compile()]);
    await saveHub(env.DB, [db.updateTable("user").set({ loginCreationId: creation.id }).where("id", "=", first.id).compile()]);
    const before = await db.selectFrom("user").selectAll().orderBy("id").execute();
    await expect(saveHub(env.DB, [db.updateTable("user").set({ loginCreationId: creation.id }).where("id", "=", second.id).compile()])).rejects.toThrow();
    expect(await db.selectFrom("user").selectAll().orderBy("id").execute()).toEqual(before);
  });

  it("when a creation link references a missing request then the database refuses it", async () => {
    const login = await createLogin();
    const before = await db.selectFrom("user").selectAll().execute();
    await expect(saveHub(env.DB, [db.updateTable("user").set({ loginCreationId: v7() }).where("id", "=", login.id).compile()])).rejects.toThrow();
    expect(await db.selectFrom("user").selectAll().execute()).toEqual(before);
  });

  it.each(["kind", "details"] as const)("when creation %s contains an invalid stored value then the database refuses the change", async (field) => {
    const creator = await createLogin();
    const creation = makeCreation(creator.id);
    await saveHub(env.DB, [db.insertInto("loginCreations").values(creation).compile()]);
    const invalid = field === "kind" ? "unsupported" : "invalid JSON";
    const query = sql`update login_creations set ${sql.ref(field)} = ${invalid} where id = ${creation.id}`.compile(db);
    await expect(saveHub(env.DB, [query])).rejects.toThrow();
    expect(await db.selectFrom("loginCreations").selectAll().execute()).toEqual([creation]);
  });

  it("when native storage updates server-owned profile fields then persistence uses their configured columns and session responses hide them", async () => {
    const login = await createLogin();
    const context = await auth.$context;
    await context.internalAdapter.updateUser(login.id, { phone: "+14155552671", pictureKey: "profiles/test.webp" });
    expect(await db.selectFrom("user").select(["phone", "pictureKey"]).where("id", "=", login.id).executeTakeFirst()).toEqual({
      phone: "+14155552671", pictureKey: "profiles/test.webp",
    });
    const response = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { cookie: login.cookie } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("user.id", login.id);
    for (const field of ["phone", "pictureKey", "archivedAt", "statusBeforeArchiving", "loginCreationId"]) {
      expect(body).not.toHaveProperty(`user.${field}`);
    }
  });

  it("when native HTTP attempts to change server-owned markers then the authenticated request is refused", async () => {
    const login = await createLogin();
    const before = await db.selectFrom("user").selectAll().execute();
    const response = await auth.handler(new Request(`${origin}/api/auth/update-user`, {
      method: "POST", headers: { origin, cookie: login.cookie, "content-type": "application/json" },
      body: JSON.stringify({ loginCreationId: v7(), archivedAt: new Date().toISOString(), role: "admin" }),
    }));
    expect(response.status).toBe(404);
    expect(await db.selectFrom("user").selectAll().execute()).toEqual(before);
  });

  it("when a login is physically deleted then the database refuses it and its credential and session remain valid", async () => {
    const login = await createLogin();
    const credentials = await db.selectFrom("account").selectAll().execute();
    await expect(saveHub(env.DB, [db.deleteFrom("user").where("id", "=", login.id).compile()])).rejects.toThrow();
    expect(await db.selectFrom("account").selectAll().execute()).toEqual(credentials);
    expect((await auth.api.getSession({ headers: { cookie: login.cookie } }))?.user.id).toBe(login.id);
  });

  it("when the shared sign-in fixture receives a refusal then it reports failure without accepting the login", async () => {
    const login = await createLogin();
    await expect(signInAtHub({ handle: auth.handler, origin, email: login.email, password: "Wrong-password123!" }))
      .rejects.toThrow("Hub fixture sign-in was refused (401).");
  });
});

async function createLogin() {
  const identity = { email: `login-${v7()}@example.test`, username: `u${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}` };
  const { user } = await auth.api.createUser({ body: { email: identity.email, name: "Schema test", password, data: { username: identity.username } } });
  const cookie = await signInAtHub({ handle: auth.handler, origin, email: identity.email, password });
  return { ...identity, id: user.id, cookie };
}

async function createWorkspace(): Promise<string> {
  const owner = await createLogin();
  const organization = await auth.api.createOrganization({ body: { name: "Schema workspace", slug: `workspace-${v7()}`, userId: owner.id } });
  if (!organization) throw new Error("Prepared workspace creation must succeed.");
  return organization.id;
}

function makeCreation(creatorLoginId: string) {
  return {
    id: v7(), creatorLoginId, organizationId: null, createdLoginId: null, kind: null,
    details: JSON.stringify({ email: `created-${v7()}@example.test` }), createdAt: new Date().toISOString(), completedAt: null,
  };
}
