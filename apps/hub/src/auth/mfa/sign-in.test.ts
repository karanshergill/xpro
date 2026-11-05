import { env } from "cloudflare:workers";
import { createRequestContext } from "@xpro/core/server";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, readMfaLogin, type MfaFixture } from "#test/master-mfa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { vi.useRealTimers(); await fixture.identities.db.destroy(); });

describe("native master second-factor sign-in", () => {
  it("Password accepted, MFA pending", async () => {
    const login = await createEnrolledMaster(fixture);
    const response = await beginMfaSignIn(fixture, login.email);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ twoFactorRedirect: true });
    const native = await fixture.auth.$context;
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith(native.authCookies.sessionToken.name + "=")
      && !cookie.startsWith(native.authCookies.sessionToken.name + "=;"))).toBe(false);
    const challenge = await fixture.identities.db.selectFrom("verification").selectAll().where("value", "=", login.loginId).executeTakeFirstOrThrow();
    expect(challenge.authRevision).toBe(1);
    expect(await fixture.auth.api.getSession({ headers: { cookie: mfaCookie(response) } })).toBeNull();
  });

  it("Valid master sign-in", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const response = await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(pending) },
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true });
    expect(response.status).toBe(200);
    const signedIn = await readMfaLogin(fixture, { login, response });
    const result = await env.HUB_ACCESS.validateAccess({ loginId: signedIn.loginId, hubSessionId: signedIn.hubSessionId,
      workspaceId: null, context: createRequestContext() });
    expect(result).toMatchObject({ status: "valid", actor: { loginId: login.loginId, isMaster: true }, mfa: { status: "verified", verifiedAt: expect.any(String) } });
  });

  it("Single-use backup sign-in", async () => {
    const login = await createEnrolledMaster(fixture), code = login.backupCodes[0];
    if (!code) throw new Error("Native enrollment did not return a backup code.");
    const pending = await beginMfaSignIn(fixture, login.email);
    const response = await fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(pending) }, body: { code }, asResponse: true });
    expect(response.status).toBe(200);
    const signedIn = await readMfaLogin(fixture, { login, response });
    expect(await fixture.identities.db.selectFrom("session").select(["mfaVerifiedAt", "authRevision"]).where("id", "=", signedIn.hubSessionId).executeTakeFirst())
      .toEqual({ mfaVerifiedAt: expect.any(String), authRevision: 1 });
    const another = await beginMfaSignIn(fixture, login.email);
    expect((await fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(another) }, body: { code }, asResponse: true })).status).toBe(401);
  });

  it("when one challenge is verified twice concurrently then only one native session is issued", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const cookie = mfaCookie(pending), code = await currentMfaCode(fixture, login.loginId);
    const responses = await Promise.all([1, 2].map(async () => await fixture.auth.api.verifyTOTP({ headers: { cookie }, body: { code }, asResponse: true })));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    for (const response of responses.filter((response) => response.status !== 200)) expect([401, 409]).toContain(response.status);
    expect(responses.filter((response) => response.status !== 200).every((response) => response.headers.getSetCookie()
      .every((cookie) => !cookie.includes("session_token=")))).toBe(true);
  });

  it("Ordinary logins", async () => {
    const administrator = await fixture.identities.signIn({ role: "admin" });
    const login = await createEnrolledMaster(fixture);
    await fixture.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId, role: "user" } });
    const response = await beginMfaSignIn(fixture, login.email);
    expect(response.status).toBe(200);
    expect(await response.clone().json()).not.toHaveProperty("twoFactorRedirect");
    const ordinary = await readMfaLogin(fixture, { login, response });
    expect(await env.HUB_ACCESS.validateAccess({ loginId: ordinary.loginId, hubSessionId: ordinary.hubSessionId,
      workspaceId: null, context: createRequestContext() })).toMatchObject({ status: "valid", actor: { isMaster: false }, mfa: { status: "not_required" } });
    const organization = await fixture.auth.api.createOrganization({ body: {
      name: "Ordinary owner", slug: "ordinary-" + crypto.randomUUID(), userId: ordinary.loginId,
    } });
    if (!organization) throw new Error("Missing native organization.");
    const tenantAdmin = await fixture.identities.signIn();
    await fixture.auth.api.addMember({ body: { organizationId: organization.id, userId: tenantAdmin.loginId, role: "admin" } });
    for (const person of [ordinary, tenantAdmin]) {
      expect(await env.HUB_ACCESS.validateAccess({ loginId: person.loginId, hubSessionId: person.hubSessionId,
        workspaceId: organization.id, context: createRequestContext() })).toMatchObject({ status: "valid", actor: { isMaster: false }, mfa: { status: "not_required" } });
      await expect(fixture.auth.api.enableTwoFactor({ headers: { cookie: person.cookie }, body: { password: fixture.password }, asResponse: true }))
        .rejects.toMatchObject({ statusCode: 403, body: { code: "core_forbidden" } });
    }
    expect((await fixture.auth.handler(new Request(fixture.origin + "/api/auth/sign-up/email", {
      method: "POST", headers: { origin: fixture.origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "public-" + crypto.randomUUID() + "@example.test", name: "Public", password: fixture.password }),
    }))).status).toBe(404);
  });
});
