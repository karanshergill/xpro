import { env } from "cloudflare:workers";
import { runWithRequestState } from "@better-auth/core/context";
import { saveHub } from "@xpro/core/server";
import { isAPIError } from "better-auth/api";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubIdentities, type HubIdentities } from "#test/hub-identities";
import { createHubAuth } from "#auth/auth.server.ts";
import { pauseDatabaseQuery } from "#test/database-barrier.db";

const origin = "https://hub.example.test";
const password = "Access-fixture123!";
let fixture: HubIdentities;

beforeEach(async () => { fixture = await createHubIdentities(env.DB); });
afterEach(async () => { await fixture.db.destroy(); });

describe("Native MFA foundation", () => {
  it.each(["user", "admin"] as const)("when a real %s signs in then only unverified server-owned metadata is stored", async (role) => {
    const login = await fixture.signIn({ role });
    const user = await fixture.db.selectFrom("user").selectAll().where("id", "=", login.loginId).executeTakeFirstOrThrow();
    const session = await fixture.db.selectFrom("session").selectAll().where("id", "=", login.hubSessionId).executeTakeFirstOrThrow();
    expect(user).toMatchObject({ authRevision: 0, twoFactorEnabled: 0 });
    expect(session).toMatchObject({ authRevision: 0, mfaVerifiedAt: null });
    const native = await fixture.auth.$context;
    const stored = await native.adapter.findOne<{ authRevision: number; mfaVerifiedAt: string | null; expiresAt: Date }>({
      model: "session", where: [{ field: "id", value: login.hubSessionId }],
    });
    expect(stored).toMatchObject({ authRevision: 0, mfaVerifiedAt: null });
    expect(stored?.expiresAt).toBeInstanceOf(Date);
    const reply = await fixture.auth.api.getSession({ headers: { cookie: login.cookie } });
    expect(reply?.user).not.toHaveProperty("authRevision");
    expect(reply?.session).not.toHaveProperty("authRevision");
    expect(reply?.session).not.toHaveProperty("mfaVerifiedAt");
  });

  it.each([
    "/two-factor/enable", "/two-factor/disable", "/two-factor/get-totp-uri",
    "/two-factor/send-otp", "/two-factor/verify-otp", "/two-factor/generate-backup-codes",
  ])("when an unused native MFA HTTP path %s is called then it stays closed", async (path) => {
    const login = await fixture.signIn({ role: "admin" });
    const before = await state();
    const response = await fixture.auth.handler(new Request(origin + "/api/auth" + path, {
      method: "POST", headers: { origin, cookie: login.cookie, "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(404);
    expect(await state()).toEqual(before);
  });

  it.each(["create", "update", "updateMany", "incrementOne", "delete", "deleteMany", "consumeOne", "transaction"] as const)(
    "when a raw factor %s is attempted then its record stays unchanged",
    async (method) => {
      const login = await fixture.signIn();
      // An unverified storage fixture tests mutation fencing; it grants no MFA authority.
      const id = crypto.randomUUID();
      await saveHub(env.DB, [sql`insert into "twoFactor" (id, "userId", secret, "backupCodes", verified, "failedVerificationCount")
        values (${id}, ${login.loginId}, 'schema-only-secret', 'schema-only-backups', 0, 0)`.compile(fixture.db)]);
      const before = await state(), native = await fixture.auth.$context;
      const where = [{ field: "id", value: id }];
      const actions: Record<typeof method, () => Promise<unknown>> = {
        create: async () => await native.adapter.create({ model: "twoFactor", data: {
          userId: login.loginId, secret: "replacement", backupCodes: "replacement", verified: false,
        } }),
        update: async () => await native.adapter.update({ model: "twoFactor", where, update: { secret: "replacement" } }),
        updateMany: async () => await native.adapter.updateMany({ model: "twoFactor", where, update: { verified: true } }),
        incrementOne: async () => await native.adapter.incrementOne({ model: "twoFactor", where, increment: { failedVerificationCount: 1 } }),
        delete: async () => await native.adapter.delete({ model: "twoFactor", where }),
        deleteMany: async () => await native.adapter.deleteMany({ model: "twoFactor", where }),
        consumeOne: async () => await native.adapter.consumeOne({ model: "twoFactor", where }),
        transaction: async () => await native.adapter.transaction(async (adapter) =>
          await adapter.update({ model: "twoFactor", where, update: { verified: true } })),
      };
      await expect(actions[method]()).rejects.toMatchObject({ statusCode: 409, body: { code: "core_unauthenticated" } });
      expect(await state()).toEqual(before);
    },
  );

  it.each([
    { model: "user", update: { twoFactorEnabled: true } },
    { model: "user", update: { authRevision: 2 } },
    { model: "user", update: { auth_revision: 2 } },
    { model: "session", update: { mfaVerifiedAt: "2026-10-31T00:00:00.000Z" } },
    { model: "session", update: { mfa_verified_at: "2026-10-31T00:00:00.000Z" } },
    { model: "verification", update: { authRevision: 2 } },
  ])("when native storage tries to overwrite $model private authority then it is refused", async ({ model, update }) => {
    const login = await fixture.signIn();
    const before = await state(), native = await fixture.auth.$context;
    for (const apply of [
      async () => await native.adapter.update({ model, where: [{ field: "id", value: login.loginId }], update }),
      async () => await native.adapter.updateMany({ model, where: [{ field: "id", value: login.loginId }], update }),
    ]) await expect(apply()).rejects.toMatchObject({ statusCode: 409 });
    expect(await state()).toEqual(before);
  });

  it("when a raw create or counter tries to introduce private authority then native defaults cannot authorize it", async () => {
    const login = await fixture.signIn(), native = await fixture.auth.$context, before = await state();
    for (const apply of [
      async () => await native.adapter.create({ model: "user", data: { authRevision: 2 } }),
      async () => await native.adapter.create({ model: "user", data: { twoFactorEnabled: true } }),
      async () => await native.adapter.create({ model: "session", data: { userId: login.loginId, authRevision: 0 } }),
      async () => await native.adapter.create({ model: "verification", data: { identifier: "2fa-" + crypto.randomUUID(), value: login.loginId } }),
      async () => await native.adapter.create({ model: "verification", data: { identifier: "other", authRevision: 2 } }),
      async () => await native.adapter.incrementOne({ model: "user", where: [{ field: "id", value: login.loginId }], increment: { authRevision: 1 } }),
      async () => await native.adapter.incrementOne({ model: "session", where: [{ field: "id", value: login.hubSessionId }],
        increment: {}, set: { mfaVerifiedAt: "2026-10-31T00:00:00.000Z" } }),
    ]) await expect(apply()).rejects.toMatchObject({ statusCode: 409 });
    expect(await state()).toEqual(before);
  });

  it("when native calls reuse request state then a previous credential proof cannot mint another session", async () => {
    const login = await fixture.createLogin();
    await runWithRequestState(new WeakMap(), async () => {
      await fixture.signInAgain(login);
      const before = await state(), native = await fixture.auth.$context;
      await expect(native.internalAdapter.createSession(login.loginId)).rejects.toMatchObject({ statusCode: 409 });
      expect(await state()).toEqual(before);
    });
  });

  it("when concurrent native calls share request state then each login keeps its own original revision", async () => {
    const first = await fixture.createLogin(), second = await fixture.createLogin();
    // Different revisions make accidentally shared source state observable without supplying MFA proof.
    await saveHub(env.DB, [
      fixture.db.updateTable("user").set({ authRevision: 2 }).where("id", "=", first.loginId).compile(),
      fixture.db.updateTable("user").set({ authRevision: 5 }).where("id", "=", second.loginId).compile(),
    ]);
    const replies = await runWithRequestState(new WeakMap(), async () =>
      await Promise.all([first, second].map(async (login) =>
        await fixture.auth.api.signInEmail({ body: { email: login.email, password }, asResponse: true }))));
    for (const [reply, revision] of [[replies[0], 2], [replies[1], 5]] as const) {
      expect(reply.status).toBe(200);
      const cookie = reply.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
      const current = await fixture.auth.api.getSession({ headers: { cookie } });
      if (!current) throw new Error("Missing native concurrent session.");
      expect(await fixture.db.selectFrom("session").select(["authRevision", "mfaVerifiedAt"])
        .where("id", "=", current.session.id).executeTakeFirst()).toEqual({ authRevision: revision, mfaVerifiedAt: null });
    }
  });

  it("when a required MFA column disappears then the native registered schema check still refuses it", async () => {
    await sql`alter table "session" drop column "mfa_verified_at"`.execute(fixture.db);
    const auth = await createHubAuth({ database: env.DB, baseURL: origin, secret: crypto.randomUUID() + crypto.randomUUID() });
    await expect((await auth.$context).checkSchema?.()).rejects.toMatchObject({ code: "SCHEMA_MISMATCH", source: "database" });
  });

  it("when the login revision changes before native password verification then stale credentials cannot adopt it", async () => {
    const login = await fixture.signIn();
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith("select ") && query.includes('from "account"'));
    const auth = await createHubAuth({
      database: barrier.database, baseURL: origin, secret: fixture.auth.options.secret,
    });
    const signingIn = outcome(auth.api.signInEmail({ body: { email: login.email, password }, asResponse: true }));
    await barrier.entered;
    try {
      // Advancing the revision removes authority; this fixture never supplies MFA proof.
      await saveHub(env.DB, [fixture.db.updateTable("user").set({ authRevision: 1 }).where("id", "=", login.loginId).compile()]);
    } finally { barrier.release(); }
    const result = await signingIn;
    if (result.kind === "response") {
      expect(result.response.status).toBe(409);
      expect(result.response.headers.getSetCookie()).toEqual([]);
    } else {
      expect(isAPIError(result.error)).toBe(true);
      expect(result.error).toMatchObject({ statusCode: 409, body: { code: "core_unauthenticated" } });
    }
    const sessions = await sql<{ auth_revision: number; mfa_verified_at: string | null }>`
      select auth_revision, mfa_verified_at from session where "userId" = ${login.loginId}
    `.execute(fixture.db.withoutPlugins());
    expect(sessions.rows).toEqual([{ auth_revision: 0, mfa_verified_at: null }]);
    const fresh = await fixture.signInAgain(login);
    expect(await fixture.db.selectFrom("session").select(["authRevision", "mfaVerifiedAt"])
      .where("id", "=", fresh.hubSessionId).executeTakeFirst()).toEqual({ authRevision: 1, mfaVerifiedAt: null });
  });
});

async function outcome(pending: Promise<Response>): Promise<
  { kind: "response"; response: Response } | { kind: "error"; error: unknown }
> {
  try { return { kind: "response", response: await pending }; }
  catch (error) { return { kind: "error", error }; }
}

async function state() {
  return {
    users: await fixture.db.selectFrom("user").selectAll().orderBy("id").execute(),
    sessions: await fixture.db.selectFrom("session").selectAll().orderBy("id").execute(),
    factors: (await sql`select * from "twoFactor" order by id`.execute(fixture.db)).rows,
    verification: await fixture.db.selectFrom("verification").selectAll().orderBy("id").execute(),
  };
}
