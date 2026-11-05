import { env } from "cloudflare:workers";
import { createRequestContext, saveHub } from "@xpro/core/server";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, type MfaFixture } from "#test/master-mfa";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { pauseDatabaseQuery } from "#test/database-barrier.db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHubAuth } from "#auth/auth.server.ts";
import { handleMfaAction } from "#functions/mfa.server.ts";
import { isAPIError } from "better-auth/api";
import type { MfaTables } from "./phases.db";
import { createHubDatabase } from "#db/hub.db.ts";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("interrupted native MFA phases", () => {
  it.each(["totp", "backup"] as const)("when native %s consumes its challenge before session insertion fails then a retry cannot restore consumed proof", async (method) => {
    const login = await createEnrolledMaster(fixture), other = await createEnrolledMaster(fixture);
    const otherBefore = { user: await userState(other.loginId), factor: await factorState(other.loginId) };
    const pending = await beginMfaSignIn(fixture, login.email), cookie = mfaCookie(pending);
    const code = method === "totp" ? await currentMfaCode(fixture, login.loginId) : login.backupCodes[0];
    if (!code) throw new Error("Missing actual native factor code.");
    await env.DB.exec('create trigger test_refuse_factor_session before insert on session begin select raise(abort, \'test_refuse_factor_session\'); end');
    const verify = async () => {
      const input = { headers: { cookie }, body: { code }, asResponse: true as const };
      return await (method === "totp" ? fixture.auth.api.verifyTOTP(input) : fixture.auth.api.verifyBackupCode(input));
    };
    const failed = await outcome(verify());
    expect(failed.error).toBeInstanceOf(Error); expect(failed.cookies).toEqual([]);
    const db = await createHubDatabase(env.DB);
    try {
      expect(await db.withoutPlugins().withTables<MfaTables>().selectFrom("verification").select("id")
        .where("value", "=", login.loginId).where("auth_revision", "is not", null).execute()).toEqual([]);
      expect(await db.withoutPlugins().selectFrom("session").select("id").where("userId", "=", login.loginId).execute())
        .toEqual([{ id: login.hubSessionId }]);
    } finally { await db.destroy(); }
    const codes = (await fixture.auth.api.viewBackupCodes({ body: { userId: login.loginId } })).backupCodes;
    expect(codes).toEqual(method === "backup" ? login.backupCodes.filter((value) => value !== code) : login.backupCodes);
    await env.DB.exec('drop trigger test_refuse_factor_session');
    expect(await outcome(verify())).toMatchObject({ status: 409, cookies: [] });
    const fresh = await beginMfaSignIn(fixture, login.email);
    if (method === "backup") expect((await fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(fresh) }, body: { code }, asResponse: true })).status).toBe(401);
    expect((await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(fresh) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).status).toBe(200);
    expect({ user: await userState(other.loginId), factor: await factorState(other.loginId) }).toEqual(otherBefore);
    expect((await fixture.auth.api.getSession({ headers: { cookie: other.cookie } }))?.session.id).toBe(other.hubSessionId);
  });

  it("when replacement session insertion refuses then the committed pending state remains blocked and fresh enrollment can finish", async () => {
    const login = await createEnrolledMaster(fixture), other = await createEnrolledMaster(fixture);
    const otherBefore = { user: await userState(other.loginId), factor: await factorState(other.loginId) };
    await env.DB.exec('create trigger test_refuse_replacement_session before insert on session begin select raise(abort, \'test_refuse_replacement_session\'); end');
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await call({ action: "replace", cookie: login.cookie });
    expect(response.status).toBe(500); expect(response.headers.getSetCookie()).toEqual([]); expect(log).toHaveBeenCalledTimes(1);
    expect(await userState(login.loginId)).toMatchObject({ authRevision: 2, twoFactorEnabled: 0 });
    expect(await factorState(login.loginId)).toBeUndefined();
    expect(await actions(login.loginId)).toEqual(["accounts_mfa_setup_started", "accounts_mfa_enrolled", "accounts_mfa_replacement_started"]);
    expect(await fixture.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
    await env.DB.exec('drop trigger test_refuse_replacement_session');
    const credential = await beginMfaSignIn(fixture, login.email), cookie = mfaCookie(credential);
    const session = await fixture.auth.api.getSession({ headers: { cookie } });
    if (!session) throw new Error("Missing actual recovery enrollment session.");
    expect(await env.HUB_ACCESS.validateAccess({ loginId: login.loginId, hubSessionId: session.session.id,
      workspaceId: null, context: createRequestContext() })).toEqual({ status: "invalid", code: "core_unauthenticated" });
    expect((await call({ action: "setup", cookie })).status).toBe(200);
    expect((await fixture.auth.api.verifyTOTP({ headers: { cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).status).toBe(200);
    expect({ user: await userState(other.loginId), factor: await factorState(other.loginId) }).toEqual(otherBefore);
  });

  it("when a setup commit loses its reply then the pending factor and audit stay together and explicit restart works", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    const database = interruptAfterWrite(env.DB, (query) => query.startsWith('insert into "twoFactor"'));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await call({ action: "setup", cookie: login.cookie, database });
    expect(response.status).toBe(500); expect(response.headers.getSetCookie()).toEqual([]);
    expect(await userState(login.loginId)).toMatchObject({ authRevision: 0, twoFactorEnabled: 0 });
    expect(await factorState(login.loginId)).toMatchObject({ verified: 0 });
    expect(await actions(login.loginId)).toEqual(["accounts_mfa_setup_started"]);
    expect((await call({ action: "replace", cookie: login.cookie })).status).toBe(200);
    expect(await userState(login.loginId)).toMatchObject({ authRevision: 1, twoFactorEnabled: 0 });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("when activation commit loses its reply then both native flags remain verified and fresh factor sign-in works", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    expect((await call({ action: "setup", cookie: login.cookie })).status).toBe(200);
    const auth = await brokenAuth(interruptAfterWrite(env.DB, (query) => query.startsWith('update "user"') && query.includes('"twoFactorEnabled"')));
    const result = await outcome(auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }));
    expect(result.error).toBeInstanceOf(Error); expect(result.cookies).toEqual([]);
    expect(await userState(login.loginId)).toMatchObject({ authRevision: 1, twoFactorEnabled: 1 });
    expect(await factorState(login.loginId)).toMatchObject({ verified: 1 });
    expect(await actions(login.loginId)).toEqual(["accounts_mfa_setup_started", "accounts_mfa_enrolled"]);
    const pending = await beginMfaSignIn(fixture, login.email);
    expect((await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(pending) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).status).toBe(200);
  });

  it("Interrupted replacement", async () => {
    const login = await createEnrolledMaster(fixture);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const database = interruptAfterWrite(env.DB, (query) => query.startsWith('update "user"') && query.includes('"twoFactorEnabled"'));
    const response = await call({ action: "replace", cookie: login.cookie, database });
    expect(response.status).toBe(500); expect(response.headers.getSetCookie()).toEqual([]);
    expect(await userState(login.loginId)).toMatchObject({ authRevision: 2, twoFactorEnabled: 0 });
    expect(await factorState(login.loginId)).toBeUndefined();
    expect(await fixture.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
    const resumed = await beginMfaSignIn(fixture, login.email);
    expect(resumed.status).toBe(200);
    expect((await call({ action: "setup", cookie: mfaCookie(resumed) })).status).toBe(200);
    expect(await actions(login.loginId)).toEqual(["accounts_mfa_setup_started", "accounts_mfa_enrolled",
      "accounts_mfa_replacement_started", "accounts_mfa_setup_started"]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("when a backup-set commit loses its reply then the replaced set stays committed with its audit", async () => {
    const login = await createEnrolledMaster(fixture), old = await factorState(login.loginId);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const database = interruptAfterWrite(env.DB, (query) => query.startsWith('update "twoFactor"') && query.includes('"backupCodes"'));
    const response = await call({ action: "backups", cookie: login.cookie, database });
    expect(response.status).toBe(500); expect(response.headers.getSetCookie()).toEqual([]);
    expect((await factorState(login.loginId))?.backupCodes).not.toBe(old?.backupCodes);
    expect(await actions(login.loginId)).toEqual(["accounts_mfa_setup_started", "accounts_mfa_enrolled", "accounts_mfa_backup_codes_replaced"]);
    expect((await call({ action: "backups", cookie: login.cookie })).status).toBe(200);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("when an activation statement fails then its flags, revision, revocations and audit roll back together", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    expect((await call({ action: "setup", cookie: login.cookie })).status).toBe(200);
    await env.DB.exec('create trigger test_mfa_activation_refuse before update of verified on "twoFactor" begin select raise(abort, \'test_mfa_activation_refuse\'); end');
    const result = await outcome(fixture.auth.api.verifyTOTP({ headers: { cookie: login.cookie },
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }));
    expect(result.error).toBeInstanceOf(Error); expect(result.cookies).toEqual([]);
    expect(await userState(login.loginId)).toMatchObject({ authRevision: 0, twoFactorEnabled: 0 });
    expect(await factorState(login.loginId)).toMatchObject({ verified: 0 });
    expect(await actions(login.loginId)).toEqual(["accounts_mfa_setup_started"]);
    expect((await fixture.auth.api.getSession({ headers: { cookie: login.cookie } }))?.user.id).toBe(login.loginId);
  });

  it.each(["revision", "role", "inactive", "creation"] as const)("when %s changes before the final MFA-time save then no completed session or success cookie is returned", async (change) => {
    const login = await fixture.identities.signIn({ role: "admin" });
    expect((await call({ action: "setup", cookie: login.cookie })).status).toBe(200);
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('update "session" set "mfa_verified_at"'));
    const auth = await brokenAuth(barrier.database);
    const verifying = outcome(auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }));
    await barrier.entered;
    try {
      // Remove authority only; never manufacture a verified session in storage.
      if (change === "creation") {
        const id = crypto.randomUUID();
        await saveHub(env.DB, [fixture.identities.db.insertInto("loginCreations").values({ id, creatorLoginId: login.loginId,
          createdLoginId: login.loginId, organizationId: null, kind: null, details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
        fixture.identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile()]);
      } else {
        const update = change === "revision" ? { authRevision: 2 } : change === "role" ? { role: "user" } : { banned: 1 };
        await saveHub(env.DB, [fixture.identities.db.updateTable("user").set(update).where("id", "=", login.loginId).compile()]);
      }
    } finally { barrier.release(); }
    const result = await verifying;
    expect(result.status).toBe(409); expect(result.cookies).toEqual([]);
    expect(await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("session").select("id")
      .where("userId", "=", login.loginId).where("mfa_verified_at", "is not", null).execute())
      .toEqual([]);
    expect(await actions(login.loginId)).toEqual(["accounts_mfa_setup_started", "accounts_mfa_enrolled"]);
  });
});

async function call(input: { action: Parameters<typeof handleMfaAction>[0]; cookie: string; database?: D1Database }): Promise<Response> {
  return await handleMfaAction(input.action, { password: fixture.password }, { request: new Request(fixture.origin + "/_serverFn/mfa", {
    method: "POST", headers: { origin: fixture.origin, cookie: input.cookie, "content-type": "application/json" },
  }), settings: { database: input.database ?? env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: fixture.rateLimiter } });
}

async function brokenAuth(database: D1Database) {
  const auth = await createHubAuth({ database, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: fixture.rateLimiter });
  await auth.$context; return auth;
}

async function outcome(pending: Promise<Response>): Promise<{ status: number | null; cookies: string[]; error: unknown | null }> {
  try { const response = await pending; return { status: response.status, cookies: response.headers.getSetCookie(), error: null }; }
  catch (error) {
    return { status: isAPIError(error) ? error.statusCode : null,
      cookies: isAPIError(error) ? new Headers(error.headers).getSetCookie() : [], error };
  }
}
async function userState(id: string) {
  const db = await createHubDatabase(env.DB);
  try { return await db.selectFrom("user").selectAll().where("id", "=", id).executeTakeFirstOrThrow(); }
  finally { await db.destroy(); }
}
async function factorState(id: string) {
  const db = await createHubDatabase(env.DB);
  try { return await db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", id).executeTakeFirst(); }
  finally { await db.destroy(); }
}
async function actions(id: string): Promise<string[]> {
  const db = await createHubDatabase(env.DB);
  try { return (await db.selectFrom("auditEntries").select("action").where("affectedLoginId", "=", id).orderBy("createdAt").execute()).map((row) => row.action); }
  finally { await db.destroy(); }
}
