import { env } from "cloudflare:workers";
import { createEnrolledMaster, currentMfaCode, type MfaFixture } from "#test/master-mfa";
import { createSignInFixture, signInPassword, hubOrigin, type SignInFixture } from "#test/sign-in";
import { signInWithResetToken as issueWorkspaceTokens } from "#test/reset-password";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubAuth } from "#auth/auth.server.ts";
import { handleMfaAction } from "#functions/mfa.server.ts";

type TokenRow = { id: string; userId: string | null; revoked: string | null };
let signIn: SignInFixture, fixture: MfaFixture;
beforeEach(async () => {
  signIn = await createSignInFixture(env.DB);
  const auth = await createHubAuth(signIn.settings); await auth.$context;
  fixture = { identities: signIn.identities, auth, password: signInPassword, origin: hubOrigin, rateLimiter: signIn.settings.rateLimiter };
});
afterEach(async () => { await signIn.identities.db.destroy(); });

describe("MFA phase token revocation", () => {
  it.each(["activation", "replacement"] as const)("when %s commits then real provider tokens are revoked only for that login", async (phase) => {
    const administrator = await createEnrolledMaster(fixture);
    const login = phase === "activation" ? await signIn.identities.signIn() : await createEnrolledMaster(fixture);
    const other = await signIn.identities.signIn();
    const workspace = await signIn.prepareWorkspace({ loginId: login.loginId });
    const otherWorkspace = await signIn.prepareWorkspace({ loginId: other.loginId });
    await issueWorkspaceTokens({ fixture: { signIn }, workspace, login });
    await issueWorkspaceTokens({ fixture: { signIn }, workspace: otherWorkspace, login: other });
    const before = await tokens();
    expect(before.access.filter((token) => token.userId === login.loginId)).not.toHaveLength(0);
    // The configured authorization grant issues no refresh token; its guarded statement is also covered by the query-plan case.
    if (phase === "activation") {
      await fixture.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId, role: "admin" } });
      expect((await fixture.auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
      expect((await fixture.auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).status).toBe(200);
    } else {
      const response = await handleMfaAction("replace", { password: fixture.password }, {
        request: new Request(hubOrigin + "/_serverFn/mfa", { method: "POST", headers: { origin: hubOrigin, cookie: login.cookie } }), settings: signIn.settings,
      });
      expect(response.status).toBe(200);
    }
    const after = await tokens();
    for (const kind of ["access", "refresh"] as const) {
      expect(after[kind].filter((token) => token.userId === login.loginId).every((token) => token.revoked !== null)).toBe(true);
      expect(after[kind].filter((token) => token.userId !== login.loginId)).toEqual(before[kind].filter((token) => token.userId !== login.loginId));
    }
    expect((await fixture.auth.api.getSession({ headers: { cookie: other.cookie } }))?.user.id).toBe(other.loginId);
  });
});

async function tokens(): Promise<{ access: TokenRow[]; refresh: TokenRow[] }> {
  const db = fixture.identities.db.withoutPlugins().withTables<{ oauthAccessToken: TokenRow; oauthRefreshToken: TokenRow }>();
  return { access: await db.selectFrom("oauthAccessToken").select(["id", "userId", "revoked"]).orderBy("id").execute(),
    refresh: await db.selectFrom("oauthRefreshToken").select(["id", "userId", "revoked"]).orderBy("id").execute() };
}
