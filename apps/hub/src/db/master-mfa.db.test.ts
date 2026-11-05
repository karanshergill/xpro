import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { betterAuth } from "better-auth";
import { CompiledQuery, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createHubAuth, createHubAuthOptions } from "#auth/auth.server.ts";
import { createUserPersistenceHooks } from "#auth/user-persistence.server.ts";
import { createHubDatabase, createHubMigrator } from "./hub.db";

const predecessor = "2026-10-29-100000-login-search";
const origin = "https://migration.example.test";
const password = "Migration-password123!";
let db: Awaited<ReturnType<typeof createHubDatabase>>;
let settings: { database: D1Database; baseURL: string; secret: string };
let login: { id: string; cookie: string };

beforeEach(async () => {
  db = await createHubDatabase(env.DB);
  expect((await createHubMigrator(db).migrateTo(predecessor)).error).toBeUndefined();
  settings = { database: env.DB, baseURL: origin, secret: crypto.randomUUID() + crypto.randomUUID() };
  const auth = legacyAuth();
  await (await auth.$context).checkSchema?.();
  const email = "legacy-" + crypto.randomUUID() + "@example.test";
  const { user } = await auth.api.createUser({ body: { email, password, name: "Existing master", role: "admin" } });
  const reply = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  expect(reply.status).toBe(200);
  login = { id: user.id, cookie: reply.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ") };
  await (await auth.$context).internalAdapter.createVerificationValue({
    identifier: "unrelated-" + crypto.randomUUID(), value: "unchanged", expiresAt: new Date(Date.now() + 3_600_000),
  });
  for (let index = 0; index < 2; index += 1) {
    const { user: owner } = await auth.api.createUser({ body: {
      email: "workspace-owner-" + crypto.randomUUID() + "@example.test", name: "Existing owner", role: "user",
    } });
    const workspace = await auth.api.createOrganization({ body: {
      name: "Existing workspace", slug: "preserved-" + crypto.randomUUID(), userId: owner.id,
    } });
    if (!workspace) throw new Error("Missing predecessor workspace.");
  }
});
afterEach(async () => { await db.destroy(); });

describe("Forward native MFA storage", () => {
  it("when real predecessor data is upgraded then revisions start at zero and no old session receives MFA proof", async () => {
    const before = await rows(db);
    expect((await createHubMigrator(db).migrateToLatest()).error).toBeUndefined();
    const after = await rows(db);
    expectUpgradedRows(before, after);
    const current = await createHubAuth(settings), older = legacyAuth();
    for (const auth of [current, older]) {
      await (await auth.$context).checkSchema?.();
      expect((await auth.api.getSession({ headers: { cookie: login.cookie } }))?.user.id).toBe(login.id);
    }
    expect((await createHubMigrator(db).migrateToLatest()).error).toBeUndefined();
    expect(await rows(db)).toEqual(after);
  });

  it.each([
    'alter table "user" add column "twoFactorEnabled"',
    'alter table "user" add column "auth_revision"',
    'alter table "session" add column "auth_revision"',
    'alter table "session" add column "mfa_verified_at"',
    'alter table "verification" add column "auth_revision"',
    'create table if not exists "twoFactor"',
    'create index if not exists "twoFactor_secret_idx"',
    'create unique index if not exists "twoFactor_userId_idx"',
    'create index if not exists verification_mfa_login_idx',
  ])("when a committed migration statement loses its reply (%s) then a fresh run resumes safely", async (statement) => {
    const before = await rows(db);
    const interrupted = await createHubDatabase(interruptAfterWrite(env.DB, (query) => query.startsWith(statement)));
    try { expect((await createHubMigrator(interrupted).migrateToLatest()).error).toBeDefined(); }
    finally { await interrupted.destroy(); }
    const fresh = await createHubDatabase(env.DB);
    try {
      expect((await createHubMigrator(fresh).migrateToLatest()).error).toBeUndefined();
      const after = await rows(fresh);
      expectUpgradedRows(before, after);
      const auth = await createHubAuth(settings);
      await (await auth.$context).checkSchema?.();
      expect((await auth.api.getSession({ headers: { cookie: login.cookie } }))?.user.id).toBe(login.id);
    } finally { await fresh.destroy(); }
  });

  it.each(["user", "session", "verification"] as const)("when %s revisions are saved then only nonnegative safe integers fit", async (table) => {
    expect((await createHubMigrator(db).migrateToLatest()).error).toBeUndefined();
    const before = await rows(db), record = before[table === "user" ? "users" : table === "session" ? "sessions" : "verification"][0];
    if (!record) throw new Error("Missing predecessor record.");
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "not-an-integer"]) {
      await expect(saveHub(env.DB, [sql`update ${sql.table(table)} set auth_revision = ${value} where id = ${record.id}`.compile(db)]))
        .rejects.toThrow(new RegExp(table + "_auth_revision_range"));
      expect(await rows(db)).toEqual(before);
    }
    if (table !== "verification") {
      await expect(saveHub(env.DB, [sql`update ${sql.table(table)} set auth_revision = null where id = ${record.id}`.compile(db)]))
        .rejects.toThrow(/NOT NULL/);
    }
    // These boundary fixtures invalidate old revision matches; they never mint MFA time.
    await saveHub(env.DB, [sql`update ${sql.table(table)} set auth_revision = ${Number.MAX_SAFE_INTEGER} where id = ${record.id}`.compile(db)]);
    const stored = await sql<{ auth_revision: number }>`select auth_revision from ${sql.table(table)} where id = ${record.id}`.execute(db.withoutPlugins());
    expect(stored.rows).toEqual([{ auth_revision: Number.MAX_SAFE_INTEGER }]);
  });

  it("when native factor rows are stored then one factor per login is enforced and native booleans and dates keep their conversion", async () => {
    expect((await createHubMigrator(db).migrateToLatest()).error).toBeUndefined();
    const lockedUntil = new Date(Date.now() + 60_000), id = crypto.randomUUID();
    // An unverified schema fixture exercises native storage, never successful factor verification.
    await saveHub(env.DB, [sql`insert into "twoFactor"
      (id, "userId", secret, "backupCodes", verified, "failedVerificationCount", "lockedUntil")
      values (${id}, ${login.id}, 'schema-only-secret', 'schema-only-backups', 0, 2, ${lockedUntil.toISOString()})`.compile(db)]);
    await expect(saveHub(env.DB, [sql`insert into "twoFactor" (id, "userId", secret, "backupCodes", verified)
      values (${crypto.randomUUID()}, ${login.id}, 'other-secret', 'other-backups', 0)`.compile(db)]))
      .rejects.toThrow(/UNIQUE constraint failed: twoFactor.userId/);
    const auth = await createHubAuth(settings);
    const factor = await (await auth.$context).adapter.findOne<{
      verified: boolean; failedVerificationCount: number; lockedUntil: Date;
    }>({ model: "twoFactor", where: [{ field: "id", value: id }] });
    expect(factor?.verified).toBe(false);
    expect(factor?.failedVerificationCount).toBe(2);
    expect(factor?.lockedUntil).toEqual(lockedUntil);
    expect(await db.selectFrom("session").select("mfaVerifiedAt").execute()).toEqual([{ mfaVerifiedAt: null }]);
  });

  it("when a factor or targeted main challenge is looked up then its real query plan uses the approved indexes", async () => {
    expect((await createHubMigrator(db).migrateToLatest()).error).toBeUndefined();
    for (const { query, index } of [
      { query: sql`select id from "twoFactor" where "userId" = ${login.id}`.compile(db), index: "twoFactor_userId_idx" },
      { query: sql`select id from verification where value = ${login.id} and auth_revision is not null`.compile(db), index: "verification_mfa_login_idx" },
    ]) {
      const plan = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
      expect(plan.rows.some(({ detail }) => detail.includes(index))).toBe(true);
      expect(plan.rows.filter(({ detail }) => /\bSCAN\b/.test(detail))).toEqual([]);
    }
  });
});

function legacyAuth() {
  const options = createHubAuthOptions(settings);
  // This historical factory runs on the pre-MFA schema using the real native APIs.
  const { authRevision, ...additionalFields } = options.user.additionalFields;
  expect(authRevision.fieldName).toBe("auth_revision");
  return betterAuth({ ...options, user: { ...options.user, additionalFields },
    session: { ...options.session, additionalFields: {} }, verification: { additionalFields: {} },
    plugins: options.plugins.filter((plugin) => plugin.id !== "two-factor"),
    databaseHooks: createUserPersistenceHooks(undefined).databaseHooks,
  });
}

async function rows(database: Awaited<ReturnType<typeof createHubDatabase>>) {
  return {
    users: await database.selectFrom("user").selectAll().orderBy("id").execute(),
    sessions: await database.selectFrom("session").selectAll().orderBy("id").execute(),
    verification: await database.selectFrom("verification").selectAll().orderBy("id").execute(),
    credentials: await database.selectFrom("account").selectAll().orderBy("id").execute(),
    organizations: await database.selectFrom("organization").selectAll().orderBy("id").execute(),
    memberships: await database.selectFrom("member").selectAll().orderBy("id").execute(),
  };
}

function expectUpgradedRows(before: Awaited<ReturnType<typeof rows>>, after: Awaited<ReturnType<typeof rows>>): void {
  expect(after.users.map(({ authRevision, twoFactorEnabled, ...row }) => {
    expect(authRevision).toBe(0); expect(twoFactorEnabled).toBe(0); return row;
  })).toEqual(before.users);
  expect(after.sessions.map(({ authRevision, mfaVerifiedAt, ...row }) => {
    expect(authRevision).toBe(0); expect(mfaVerifiedAt).toBeNull(); return row;
  })).toEqual(before.sessions);
  expect(after.verification.map(({ authRevision, ...row }) => {
    expect(authRevision).toBeNull(); return row;
  })).toEqual(before.verification);
  expect(after.credentials).toEqual(before.credentials);
  expect(after.organizations).toEqual(before.organizations);
  expect(after.memberships).toEqual(before.memberships);
}
