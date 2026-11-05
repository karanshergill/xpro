import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, type MfaFixture } from "#test/master-mfa";
import { handleMfaAction } from "#functions/mfa.server.ts";
import { handleHubAuthRequest } from "#auth/oidc.server.ts";
import { changeNativePassword } from "#functions/profile.server.ts";
import { createRequestContext } from "@xpro/core/server";
import type { MfaTables } from "./phases.db";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); });

describe("MFA page identity binding", () => {
  it.each(["setup", "replace", "backups", "password", "totp", "backup"] as const)("when the browser changes login before %s then the old form cannot change the new login", async (action) => {
    const first = await createEnrolledMaster(fixture);
    const enrolled = action === "setup" ? null : await createEnrolledMaster(fixture);
    const second = enrolled ?? await fixture.identities.signIn({ role: "admin" });
    const isVerification = action === "totp" || action === "backup";
    const pending = isVerification ? await beginMfaSignIn(fixture, second.email) : null;
    const headers = new Headers({ cookie: pending ? mfaCookie(pending) : second.cookie,
      origin: fixture.origin, "content-type": "application/json", "x-page-login-id": first.loginId });
    const before = await state();
    let response: Response;
    if (isVerification) {
      const code = action === "totp" ? await currentMfaCode(fixture, second.loginId) : enrolled?.backupCodes[0];
      if (!code) throw new Error("Missing native verification code.");
      response = await handleHubAuthRequest(new Request(fixture.origin + "/api/auth/two-factor/verify-" + (action === "totp" ? "totp" : "backup-code"), {
        method: "POST", headers, body: JSON.stringify({ code }),
      }), settings());
    } else if (action === "password") {
      response = await changeNativePassword({ currentPassword: fixture.password, newPassword: "Never-saved123!", revokeOtherSessions: true }, {
        auth: fixture.auth, headers, context: createRequestContext(),
      });
    } else {
      response = await handleMfaAction(action, { password: fixture.password }, { request: new Request(fixture.origin + "/_serverFn/mfa", { method: "POST", headers }), settings: settings() });
    }
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "core_identity_changed" });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await state()).toEqual(before);
  });
});

function settings() {
  return { database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: fixture.rateLimiter, turnstileSecret: "unused" };
}
async function state() {
  const db = fixture.identities.db.withoutPlugins().withTables<MfaTables>();
  return { users: await db.selectFrom("user").selectAll().orderBy("id").execute(), accounts: await db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await db.selectFrom("session").selectAll().orderBy("id").execute(), factors: await db.selectFrom("twoFactor").selectAll().orderBy("id").execute(),
    challenges: await db.selectFrom("verification").selectAll().orderBy("id").execute(), audits: await db.selectFrom("audit_entries").selectAll().orderBy("id").execute() };
}
