import { env } from "cloudflare:workers";
import { runWithRequestState } from "@better-auth/core/context";
import { createAccessRequest, createRequestContext } from "@xpro/core/server";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, readMfaLogin, type MfaFixture } from "#test/master-mfa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHubAuth } from "#auth/auth.server.ts";
import { parseCookies, setRequestCookie } from "better-auth/cookies";
import type { MfaTables } from "./phases.db";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { vi.useRealTimers(); await fixture.identities.db.destroy(); });

describe("native MFA proof and attempt protection", () => {
  it.each(["enrollment", "sign-in"] as const)("when an authentic TOTP is outside the accepted window during %s then current-code verification still succeeds", async (step) => {
    const login = step === "enrollment" ? await fixture.identities.signIn({ role: "admin" }) : await createEnrolledMaster(fixture);
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    if (step === "enrollment") expect((await fixture.auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
    const cookie = step === "enrollment" ? login.cookie : mfaCookie(await beginMfaSignIn(fixture, login.email));
    const factor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").select(["secret", "backupCodes", "verified"])
      .where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    const accepted = new Set<string>();
    for (const offset of [-30_000, 0, 30_000]) {
      vi.setSystemTime(now + offset); accepted.add(await currentMfaCode(fixture, login.loginId));
    }
    let expired: string | undefined;
    // A six-digit collision with an accepted period is valid; choose a different old period.
    for (const age of [90_000, 120_000, 150_000]) {
      vi.setSystemTime(now - age);
      const code = await currentMfaCode(fixture, login.loginId);
      if (!accepted.has(code)) { expired = code; break; }
    }
    if (!expired) throw new Error("Could not obtain an expired native test code.");
    vi.setSystemTime(now);
    const refused = await fixture.auth.api.verifyTOTP({ headers: { cookie }, body: { code: expired }, asResponse: true });
    expect(refused.status).toBe(401); expect(refused.headers.getSetCookie()).toEqual([]);
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").select(["secret", "backupCodes", "verified"])
      .where("userId", "=", login.loginId).executeTakeFirst()).toEqual(factor);
    const verified = await fixture.auth.api.verifyTOTP({ headers: { cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true });
    expect(verified.status).toBe(200);
    const current = await readMfaLogin(fixture, { login, response: verified });
    expect(await env.HUB_ACCESS.validateAccess({ loginId: current.loginId, hubSessionId: current.hubSessionId,
      workspaceId: null, context: createRequestContext() })).toMatchObject({ status: "valid", mfa: { status: "verified" } });
  });

  it("Limited verification attempts", async () => {
    const login = await createEnrolledMaster(fixture);
    for (let round = 0; round < 2; round += 1) {
      const pending = await beginMfaSignIn(fixture, login.email), cookie = mfaCookie(pending);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await fixture.auth.api.verifyTOTP({ headers: { cookie }, body: { code: "not-a-code" }, asResponse: true })).status).toBe(401);
      }
      if (round === 0) {
        const exhausted = await fixture.auth.api.verifyTOTP({ headers: { cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true });
        expect(exhausted.status).toBe(400);
        expect(exhausted.headers.getSetCookie().every((cookie) => !cookie.includes("session_token="))).toBe(true);
      }
    }
    const native = await fixture.auth.$context;
    const factor = await native.adapter.findOne<{ lockedUntil: Date; failedVerificationCount: number }>({ model: "twoFactor", where: [{ field: "userId", value: login.loginId }] });
    expect(factor?.failedVerificationCount).toBe(10); expect(factor?.lockedUntil).toBeInstanceOf(Date);
    const pending = await beginMfaSignIn(fixture, login.email);
    const locked = await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(pending) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true });
    expect(locked.status).toBe(429);
    if (!factor) throw new Error("The native factor disappeared.");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(factor.lockedUntil.getTime() + 1);
    const fresh = await beginMfaSignIn(fixture, login.email);
    expect((await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(fresh) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).status).toBe(200);
    expect(await native.adapter.findOne({ model: "twoFactor", where: [{ field: "userId", value: login.loginId }] }))
      .toMatchObject({ failedVerificationCount: 0, lockedUntil: null });
  });

  it("Invalid or expired verification", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const record = await fixture.identities.db.selectFrom("verification").selectAll().where("value", "=", login.loginId).where("authRevision", "is not", null).executeTakeFirstOrThrow();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(record.expiresAt));
    await expect(fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(pending) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }))
      .rejects.toMatchObject({ statusCode: 409, body: { code: "core_unauthenticated" } });
  });

  it.each(["trustDevice", "disableSession"] as const)("when %s is supplied then no native code is consumed or trusted device created", async (field) => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const before = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    const code = login.backupCodes[0]; if (!code) throw new Error("Missing native backup code.");
    await expect(fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(pending) }, body: { code, [field]: true }, asResponse: true }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow()).toEqual(before);
    expect(await fixture.identities.db.selectFrom("verification").select("id").where("identifier", "like", "trust-device-%").execute()).toEqual([]);
  });

  it("when a request has both a working session and a signed challenge then verification refuses the ambiguity", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const headers = new Headers({ cookie: mfaCookie(pending) });
    for (const [name, value] of parseCookies(login.cookie)) setRequestCookie(headers, name, value);
    await expect(fixture.auth.api.verifyTOTP({ headers,
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("Existing password-only session", async () => {
    const administrator = await createEnrolledMaster(fixture), login = await createEnrolledMaster(fixture);
    await fixture.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId, role: "user" } });
    const passwordOnly = await readMfaLogin(fixture, { login, response: await beginMfaSignIn(fixture, login.email) });
    await fixture.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId, role: "admin" } });
    for (const workspaceId of [null, crypto.randomUUID()]) {
      const context = createRequestContext();
      // The old invalid-result shape remains sufficient for consumers unaware of MFA.
      expect(await env.HUB_ACCESS.validateAccess({ loginId: login.loginId, hubSessionId: passwordOnly.hubSessionId,
        workspaceId, context })).toEqual({ status: "invalid", code: "core_unauthenticated" });
      const access = await createAccessRequest({ app: "hub", session: passwordOnly, workspaceId, context, hub: env.HUB_ACCESS });
      const permission = access.authorize({ kind: "protected", hasLocalPermission: false });
      expect(permission.isErr).toBe(true);
      if (permission.isErr) expect(permission.error).toEqual({ code: "core_unauthenticated" });
    }
    await expect(fixture.auth.api.verifyTOTP({ headers: { cookie: passwordOnly.cookie },
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("when a later native call shares request state then it cannot borrow another endpoint's completed MFA", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    await runWithRequestState(new WeakMap(), async () => {
      expect((await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(pending) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).status).toBe(200);
      await expect(fixture.auth.api.generateBackupCodes({ headers: { cookie: login.initialCookie }, body: { password: fixture.password }, asResponse: true }))
        .rejects.toMatchObject({ statusCode: 409 });
    });
  });

  it("when the configured Cloudflare binding is used then real enrollment succeeds without a custom limiter", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    const auth = await createHubAuth({ database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: env.SIGN_IN_RATE_LIMITER });
    await auth.$context;
    expect((await auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
    expect((await auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).status).toBe(200);
  });

  it("when authenticated enrollment exhausts the real Cloudflare budget then even a correct code cannot activate MFA", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    const auth = await createHubAuth({ database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: env.SIGN_IN_RATE_LIMITER });
    await auth.$context;
    expect((await auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
    for (let attempt = 0; attempt < 9; attempt += 1) expect((await auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: "not-a-code" }, asResponse: true })).status).toBe(401);
    const before = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    await expect(auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }))
      .rejects.toMatchObject({ statusCode: 429, body: { code: "accounts_mfa_limited" } });
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirst()).toEqual(before);
    expect(await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("user").select(["auth_revision", "twoFactorEnabled"]).where("id", "=", login.loginId).executeTakeFirst())
      .toEqual({ auth_revision: 0, twoFactorEnabled: 0 });
    expect(await env.HUB_ACCESS.validateAccess({ loginId: login.loginId, hubSessionId: login.hubSessionId,
      workspaceId: null, context: createRequestContext() })).toEqual({ status: "invalid", code: "core_unauthenticated" });
  });

  it("when TOTP, backup and management submissions share the real login budget then their combined limit cannot be reset by changing methods", async () => {
    const login = await createEnrolledMaster(fixture), other = await createEnrolledMaster(fixture);
    const auth = await createHubAuth({ database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: env.SIGN_IN_RATE_LIMITER });
    await auth.$context;
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await auth.api.generateBackupCodes({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
    for (const method of ["totp", "backup"] as const) {
      const cookie = mfaCookie(await beginMfaSignIn(fixture, login.email));
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const request = { headers: { cookie }, body: { code: "not-a-code" }, asResponse: true as const };
        expect((await (method === "totp" ? auth.api.verifyTOTP(request) : auth.api.verifyBackupCode(request))).status).toBe(401);
      }
    }
    const pending = await beginMfaSignIn(fixture, login.email);
    const verified = await auth.api.verifyTOTP({ headers: { cookie: mfaCookie(pending) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true });
    expect(verified.status).toBe(200);
    const before = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    await expect(auth.api.generateBackupCodes({ headers: { cookie: mfaCookie(verified) }, body: { password: fixture.password }, asResponse: true }))
      .rejects.toMatchObject({ statusCode: 429, body: { code: "accounts_mfa_limited" } });
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirst()).toEqual(before);
    expect((await auth.api.generateBackupCodes({ headers: { cookie: other.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
  });
});
