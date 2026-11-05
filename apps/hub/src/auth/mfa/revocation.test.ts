import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext } from "@xpro/core/server";
import { archiveLogin, changeEmail, changeUsername, reactivateLogin, resetPassword, restoreLogin, suspendLogin } from "@xpro/stms/server";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, type EnrolledMaster, type MfaFixture } from "#test/master-mfa";
import { pauseDatabaseQuery } from "#test/database-barrier.db";
import { createHubAuth } from "#auth/auth.server.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAPIError } from "better-auth/api";
import type { MfaTables } from "./phases.db";

type Change = "reset" | "email" | "username" | "suspend" | "reactivate" | "archive" | "restore";
let fixture: MfaFixture, actor: EnrolledMaster, target: EnrolledMaster, other: EnrolledMaster;
beforeEach(async () => {
  fixture = await createMfaFixture(env.DB);
  actor = await createEnrolledMaster(fixture); target = await createEnrolledMaster(fixture); other = await createEnrolledMaster(fixture);
});
afterEach(async () => { await fixture.identities.db.destroy(); });

describe("MFA revocation producers", () => {
  it.each(["reset", "email", "username", "suspend", "reactivate", "archive", "restore"] as const)("when %s commits then revisions advance and old MFA cannot revive access", async (change) => {
    const pending = await beginMfaSignIn(fixture, target.email), unrelated = await beginMfaSignIn(fixture, other.email);
    const beforeFactor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute();
    if (change === "reactivate") expect((await apply("suspend")).isOk).toBe(true);
    if (change === "restore") expect((await apply("archive")).isOk).toBe(true);
    const before = await fixture.identities.db.selectFrom("user").selectAll().orderBy("id").execute();
    const old = before.find((row) => row.id === target.loginId);
    if (!old) throw new Error("Missing real target login.");
    expect((await apply(change)).isOk).toBe(true);
    const after = await fixture.identities.db.selectFrom("user").selectAll().orderBy("id").execute();
    expect(after.find((row) => row.id === target.loginId)?.authRevision).toBe(old.authRevision + 1);
    expect(after.filter((row) => row.id !== target.loginId)).toEqual(before.filter((row) => row.id !== target.loginId));
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute()).toEqual(beforeFactor);
    expect(await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("verification").select("id").where("value", "=", target.loginId)
      .where("auth_revision", "is not", null).execute()).toEqual([]);
    expect(await fixture.auth.api.getSession({ headers: { cookie: target.cookie } })).toBeNull();
    expect(await verify(mfaCookie(pending), await currentMfaCode(fixture, target.loginId))).not.toBe(200);
    expect((await fixture.auth.api.getSession({ headers: { cookie: other.cookie } }))?.user.id).toBe(other.loginId);
    expect(await verify(mfaCookie(unrelated), await currentMfaCode(fixture, other.loginId))).toBe(200);
  });

  it.each(["reset", "email", "username", "suspend", "archive"] as const)("when %s wins after native challenge consumption then delayed MFA cannot finish or adopt the winning revision", async (change) => {
    const challenge = await beginMfaSignIn(fixture, target.email);
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('insert into "session"'));
    const auth = await createHubAuth({ database: barrier.database, baseURL: fixture.origin,
      secret: fixture.auth.options.secret, rateLimiter: fixture.rateLimiter });
    await auth.$context;
    const pending = outcome(auth.api.verifyTOTP({ headers: { cookie: mfaCookie(challenge) },
      body: { code: await currentMfaCode(fixture, target.loginId) }, asResponse: true }));
    await Promise.race([barrier.entered, pending.then(() => { throw new Error("MFA did not reach native session insertion."); })]);
    try {
      expect(await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("verification").select("id")
        .where("value", "=", target.loginId).where("auth_revision", "is not", null).execute()).toEqual([]);
      expect((await apply(change)).isOk).toBe(true);
      if (change === "suspend") expect((await apply("reactivate")).isOk).toBe(true);
      if (change === "archive") expect((await apply("restore")).isOk).toBe(true);
    } finally { barrier.release(); }
    expect(await pending).toEqual({ status: 409, cookies: [] });
    const sessions = await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("session").selectAll()
      .where("userId", "=", target.loginId).execute();
    for (const session of sessions) {
      expect(session.mfa_verified_at).toBeNull();
      expect(await env.HUB_ACCESS.validateAccess({ loginId: target.loginId, hubSessionId: session.id,
        workspaceId: null, context: createRequestContext() })).toEqual({ status: "invalid", code: "core_unauthenticated" });
    }
    expect((await fixture.auth.api.getSession({ headers: { cookie: other.cookie } }))?.user.id).toBe(other.loginId);
  });
});

async function apply(change: Change, database = env.DB) {
  const context = createRequestContext();
  const access = await createAccessRequest({ app: "hub", session: actor, workspaceId: null, context, hub: env.HUB_ACCESS });
  const services = { database, context, access, async hashPassword(password: string) { return await (await fixture.auth.$context).password.hash(password); } };
  const loginId = target.loginId;
  switch (change) {
    case "reset": return await resetPassword({ loginId, newPassword: "Reset-revocation456!" }, services);
    case "email": return await changeEmail({ loginId, email: "changed-" + crypto.randomUUID() + "@example.test" }, services);
    case "username": return await changeUsername({ loginId, username: "n" + crypto.randomUUID().replaceAll("-", "").slice(0, 7) }, services);
    case "suspend": return await suspendLogin({ loginId, reason: "stms_security_concern", confirmed: true }, services);
    case "reactivate": return await reactivateLogin({ loginId }, services);
    case "archive": return await archiveLogin({ loginId, confirmed: true }, services);
    case "restore": return await restoreLogin({ loginId }, services);
  }
}

async function verify(cookie: string, code: string): Promise<number> {
  try { return (await fixture.auth.api.verifyTOTP({ headers: { cookie }, body: { code }, asResponse: true })).status; }
  catch (error) { if (isAPIError(error)) return error.statusCode; throw error; }
}

async function outcome(value: Promise<Response>): Promise<{ status: number; cookies: string[] }> {
  try { const response = await value; return { status: response.status, cookies: response.headers.getSetCookie() }; }
  catch (error) { if (isAPIError(error)) return { status: error.statusCode, cookies: new Headers(error.headers).getSetCookie() }; throw error; }
}
