import { env } from "cloudflare:workers";
import { createRequestContext, saveHub } from "@xpro/core/server";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, readMfaLogin, type MfaFixture } from "#test/master-mfa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAPIError } from "better-auth/api";

let fixture: MfaFixture;
const replacement = "Changed-password456!";
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { vi.useRealTimers(); await fixture.identities.db.destroy(); });

describe("guarded native own-password rotation", () => {
  it.each(["user", "legacy null role"] as const)("when an ordinary %s changes their password then no MFA proof is required or manufactured", async (role) => {
    const login = await fixture.identities.signIn(), other = await fixture.identities.signIn();
    if (role === "legacy null role") {
      // Remove role/flag values to represent a pre-plugin login; never add MFA proof.
      await saveHub(env.DB, [fixture.identities.db.withoutPlugins().updateTable("user").set({ role: null, twoFactorEnabled: null })
        .where("id", "=", login.loginId).compile()]);
    }
    const changed = await fixture.auth.api.changePassword({ headers: { cookie: login.cookie }, body: {
      currentPassword: fixture.password, newPassword: replacement, revokeOtherSessions: true,
    }, asResponse: true });
    expect(changed.status).toBe(200);
    const rotated = await readMfaLogin(fixture, { login, response: changed });
    expect(await fixture.identities.db.selectFrom("session").select(["authRevision", "mfaVerifiedAt"])
      .where("id", "=", rotated.hubSessionId).executeTakeFirst()).toEqual({ authRevision: 1, mfaVerifiedAt: null });
    expect(await fixture.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
    expect((await fixture.auth.api.getSession({ headers: { cookie: other.cookie } }))?.user.id).toBe(other.loginId);
  });

  it.each(["update", "updateMany", "incrementOne", "transaction"] as const)("when a raw native password %s bypasses the endpoint then the credential and revision stay unchanged", async (method) => {
    const login = await fixture.identities.signIn(), native = await fixture.auth.$context;
    const account = await fixture.identities.db.withoutPlugins().selectFrom("account").selectAll()
      .where("userId", "=", login.loginId).where("providerId", "=", "credential").executeTakeFirstOrThrow();
    const where = [{ field: "id", value: account.id }];
    const operations: Record<typeof method, () => Promise<unknown>> = {
      update: async () => await native.adapter.update({ model: "account", where, update: { password: "refused" } }),
      updateMany: async () => await native.adapter.updateMany({ model: "account", where, update: { password: "refused" } }),
      incrementOne: async () => await native.adapter.incrementOne({ model: "account", where, increment: {}, set: { password: "refused" } }),
      transaction: async () => await native.adapter.transaction(async (adapter) => await adapter.update({ model: "account", where, update: { password: "refused" } })),
    };
    await expect(operations[method]()).rejects.toMatchObject({ statusCode: 409 });
    expect(await fixture.identities.db.withoutPlugins().selectFrom("account").selectAll().where("id", "=", account.id).executeTakeFirst()).toEqual(account);
    expect(await fixture.identities.db.selectFrom("user").select("authRevision").where("id", "=", login.loginId).executeTakeFirst()).toEqual({ authRevision: 0 });
    expect(await fixture.identities.db.selectFrom("auditEntries").selectAll().where("action", "=", "accounts_password_changed").execute()).toEqual([]);
    expect((await fixture.auth.api.getSession({ headers: { cookie: login.cookie } }))?.user.id).toBe(login.loginId);
  });

  it("when a master changes their own password after five minutes then only the authorized device retains its original MFA time", async () => {
    const login = await createEnrolledMaster(fixture), other = await createEnrolledMaster(fixture);
    const pending = await beginMfaSignIn(fixture, login.email);
    const response = await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(pending) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true });
    const device = await readMfaLogin(fixture, { login, response });
    const challenge = await beginMfaSignIn(fixture, login.email);
    const before = await fixture.identities.db.selectFrom("session").select(["authRevision", "mfaVerifiedAt"]).where("id", "=", login.hubSessionId).executeTakeFirstOrThrow();
    const factor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    if (!before.mfaVerifiedAt) throw new Error("The native fixture did not verify MFA.");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(before.mfaVerifiedAt) + 300_001);
    const changed = await fixture.auth.api.changePassword({ headers: { cookie: login.cookie },
      body: { currentPassword: fixture.password, newPassword: replacement, revokeOtherSessions: true }, asResponse: true });
    expect(changed.status).toBe(200);
    const rotated = await readMfaLogin(fixture, { login, response: changed });
    expect(await fixture.identities.db.selectFrom("session").select(["authRevision", "mfaVerifiedAt"]).where("id", "=", rotated.hubSessionId).executeTakeFirst())
      .toEqual({ authRevision: before.authRevision + 1, mfaVerifiedAt: before.mfaVerifiedAt });
    expect(await env.HUB_ACCESS.validateAccess({ loginId: rotated.loginId, hubSessionId: rotated.hubSessionId,
      workspaceId: null, context: createRequestContext() })).toMatchObject({ status: "valid", mfa: { status: "verified" } });
    for (const old of [login, device]) expect(await fixture.auth.api.getSession({ headers: { cookie: old.cookie } })).toBeNull();
    expect((await fixture.auth.api.getSession({ headers: { cookie: other.cookie } }))?.user.id).toBe(other.loginId);
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirst()).toEqual(factor);
    expect(await verify(mfaCookie(challenge), await currentMfaCode(fixture, login.loginId))).not.toBe(200);
    expect(await fixture.identities.db.selectFrom("auditEntries").selectAll().where("action", "=", "accounts_password_changed").execute())
      .toEqual([expect.objectContaining({ actorLoginId: login.loginId, affectedLoginId: login.loginId, comment: null })]);
    expect((await fixture.auth.api.signInEmail({ body: { email: login.email, password: replacement }, asResponse: true })).status).toBe(200);
  });

  it("when a password-only master calls native password change then it cannot turn that session into a working replacement", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    const before = await fixture.identities.db.selectFrom("account").selectAll().execute();
    let status: number;
    try { status = (await fixture.auth.api.changePassword({ headers: { cookie: login.cookie }, body: {
      currentPassword: fixture.password, newPassword: replacement, revokeOtherSessions: true,
    }, asResponse: true })).status; } catch (error) { if (!isAPIError(error)) throw error; status = error.statusCode; }
    expect(status).toBe(403);
    expect(await fixture.identities.db.selectFrom("account").selectAll().execute()).toEqual(before);
    expect((await fixture.auth.api.getSession({ headers: { cookie: login.cookie } }))?.user.id).toBe(login.loginId);
  });
});

async function verify(cookie: string, code: string): Promise<number> {
  try { return (await fixture.auth.api.verifyTOTP({ headers: { cookie }, body: { code }, asResponse: true })).status; }
  catch (error) { if (isAPIError(error)) return error.statusCode; throw error; }
}
