import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext } from "@xpro/core/server";
import { resetPassword } from "@xpro/stms/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beginMfaSignIn, createEnrolledMaster, createMasterWithLastBackupCode, createMfaFixture, enrollMaster, mfaCookie, type EnrolledMaster, type MfaFixture } from "#test/master-mfa";
import { hubRequest } from "#test/sign-in";
import { createInitialMaster } from "#auth/initial-master.db.ts";
import { handleHubAuthRequest } from "#auth/oidc.server.ts";
import { handleFirstSignIn, validateFirstSignIn } from "#functions/complete-first-sign-in.server.ts";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); });

describe("private master creation and unavailable recovery", () => {
  it("when the first private master enrolls then only verified MFA permits profile completion and protected access", async () => {
    const email = "first-" + crypto.randomUUID() + "@example.test";
    const created = await createInitialMaster(settings(), { email, password: fixture.password });
    if (created.status !== "created") throw new Error("Initial setup did not create its real master.");
    const initial = await fixture.identities.signInAgain({ loginId: created.loginId, email });
    expect(await env.HUB_ACCESS.validateAccess({ loginId: initial.loginId, hubSessionId: initial.hubSessionId,
      workspaceId: null, context: createRequestContext() })).toEqual({ status: "invalid", code: "core_unauthenticated" });
    const verified = await enrollMaster(fixture, initial);
    const profile = await handleFirstSignIn(validateFirstSignIn({ name: "First master", username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7), isUsernameConfirmed: true,
      phone: { country: "US", number: "2025550123" } }), {
      request: hubRequest("/_serverFn/profile", {}, verified.cookie), settings: settings(),
    });
    expect(profile.status).toBe(200);
    expect(await env.HUB_ACCESS.validateAccess({ loginId: verified.loginId, hubSessionId: verified.hubSessionId,
      workspaceId: null, context: createRequestContext() })).toMatchObject({ status: "valid", actor: { isMaster: true }, mfa: { status: "verified" } });
  });

  describe("exhausted native backup codes", () => {
    let login: EnrolledMaster;
    beforeEach(async () => { login = await createMasterWithLastBackupCode(fixture); });

    it("Loss of all second factors", async () => {
      const operator = await createEnrolledMaster(fixture), code = login.backupCodes.at(-1);
      if (!code) throw new Error("The native fixture has no final backup code.");
      const challenge = await beginMfaSignIn(fixture, login.email);
      expect((await fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(challenge) }, body: { code }, asResponse: true })).status).toBe(200);
      expect((await fixture.auth.api.viewBackupCodes({ body: { userId: login.loginId } })).backupCodes).toEqual([]);
      const before = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().orderBy("id").execute();
      const context = createRequestContext();
      const access = await createAccessRequest({ app: "hub", session: operator, workspaceId: null, context, hub: env.HUB_ACCESS });
      const password = "Reset-without-factors456!";
      expect((await resetPassword({ loginId: login.loginId, newPassword: password }, { database: env.DB, context, access,
        async hashPassword(value) { return await (await fixture.auth.$context).password.hash(value); },
      })).isOk).toBe(true);
      const credential = await fixture.identities.db.withoutPlugins().selectFrom("account").selectAll().where("userId", "=", login.loginId)
        .where("providerId", "=", "credential").executeTakeFirstOrThrow();
      expect(await createInitialMaster(settings(), { email: login.email, password: "Unapproved-recovery789!" })).toEqual({ status: "existing_logins" });
      expect(await fixture.identities.db.withoutPlugins().selectFrom("account").selectAll().where("id", "=", credential.id).executeTakeFirst()).toEqual(credential);
      expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().orderBy("id").execute()).toEqual(before);
      expect(await fixture.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
      const pending = await fixture.auth.api.signInEmail({ body: { email: login.email, password }, asResponse: true });
      expect(pending.status).toBe(200); expect(await pending.clone().json()).toMatchObject({ twoFactorRedirect: true });
      expect(await fixture.auth.api.getSession({ headers: { cookie: mfaCookie(pending) } })).toBeNull();
      const used = login.backupCodes[0]; if (!used) throw new Error("No native used code.");
      const refused = await fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(pending) }, body: { code: used }, asResponse: true });
      expect(refused.status).toBe(401); expect(refused.headers.getSetCookie()).toEqual([]);
      for (const path of ["/two-factor/disable", "/request-password-reset", "/reset-password", "/admin/set-user-password"]) {
        expect((await handleHubAuthRequest(hubRequest("/api/auth" + path, { email: login.email, password }), {
          ...settings(), turnstileSecret: "fixture-turnstile-secret",
        })).status).toBe(404);
      }
      expect((await fixture.auth.api.getSession({ headers: { cookie: operator.cookie } }))?.user.id).toBe(operator.loginId);
    });
  });
});

function settings() { return { database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: fixture.rateLimiter }; }
