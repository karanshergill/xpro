import { applySetCookies } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";
import { createHubAuth } from "../../apps/hub/src/auth/auth.server.ts";
import { createHubIdentities, type HubIdentities, type SignedInLogin } from "./hub-identities";

export type MfaFixture = {
  identities: HubIdentities; auth: Awaited<ReturnType<typeof createHubAuth>>; password: string; origin: string; rateLimiter: RateLimit;
};
export type EnrolledMaster = SignedInLogin & { backupCodes: string[]; initialCookie: string };
export type MfaSetup = { totpURI: string; backupCodes: string[] };
export type MasterProfile = Omit<NonNullable<Parameters<HubIdentities["signIn"]>[0]>, "role">;
type MfaReader = { auth: MfaFixture["auth"]; identities: Pick<HubIdentities, "db"> };

export async function createMfaFixture(database: D1Database, rateLimiter: RateLimit = {
  // Only the outside rate-limit service is replaced; native auth and all saves remain real.
  async limit() { return { success: true }; },
}): Promise<MfaFixture> {
  const identities = await createHubIdentities(database);
  try {
    const origin = "https://hub.example.test", password = "Access-fixture123!";
    const auth = await createHubAuth({ database, baseURL: origin, secret: identities.auth.options.secret, rateLimiter });
    await (await auth.$context).checkSchema?.();
    return { identities, auth, password, origin, rateLimiter };
  } catch (error) { await identities.db.destroy(); throw error; }
}

export async function createEnrolledMaster(fixture: MfaFixture, input: MasterProfile = {}): Promise<EnrolledMaster> {
  return await enrollMaster(fixture, await fixture.identities.signIn({ ...input, role: "admin" }));
}

export async function createMasterWithLastBackupCode(fixture: MfaFixture): Promise<EnrolledMaster> {
  const login = await createEnrolledMaster(fixture);
  for (let index = 0; index < login.backupCodes.length - 1; index++) {
    const code = login.backupCodes[index];
    if (code === undefined) throw new Error("The native fixture has no backup code at this position.");
    const challenge = await beginMfaSignIn(fixture, login.email);
    const verified = await fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(challenge) }, body: { code }, asResponse: true });
    if (verified.status !== 200) throw new Error("Native backup-code fixture consumption did not succeed.");
  }
  return login;
}

export async function enrollMaster(fixture: MfaReader & { password: string }, login: Pick<SignedInLogin, "loginId" | "email" | "cookie">): Promise<EnrolledMaster> {
  const setup = await fixture.auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true });
  if (setup.status !== 200) throw new Error("Native fixture setup did not succeed.");
  const material: MfaSetup = await setup.json();
  const code = await currentMfaCode(fixture, login.loginId);
  const verified = await fixture.auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code }, asResponse: true });
  if (verified.status !== 200) throw new Error("Native fixture enrollment did not succeed.");
  return { ...await readMfaLogin(fixture, { login, response: verified }), backupCodes: material.backupCodes, initialCookie: login.cookie };
}

export async function currentMfaCode(fixture: MfaReader, loginId: string): Promise<string> {
  const factor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").select("secret")
    .where("userId", "=", loginId).executeTakeFirstOrThrow();
  const secret = await symmetricDecrypt({ key: (await fixture.auth.$context).secretConfig, data: factor.secret });
  return (await fixture.auth.api.generateTOTP({ body: { secret } })).code;
}

export async function beginMfaSignIn(fixture: MfaFixture, email: string): Promise<Response> {
  return await fixture.auth.api.signInEmail({ body: { email, password: fixture.password }, asResponse: true });
}

export function mfaCookie(response: Response, previous = ""): string {
  const headers = new Headers({ cookie: previous });
  applySetCookies(headers, response.headers.getSetCookie());
  return headers.get("cookie") ?? "";
}

export async function readMfaLogin(fixture: Pick<MfaFixture, "auth">, input: { login: { loginId: string; email: string }; response: Response }): Promise<SignedInLogin> {
  const cookie = mfaCookie(input.response), current = await fixture.auth.api.getSession({ headers: { cookie } });
  if (!current || current.user.id !== input.login.loginId) throw new Error("Native MFA did not issue the intended login's session.");
  return { ...input.login, cookie, hubSessionId: current.session.id };
}
