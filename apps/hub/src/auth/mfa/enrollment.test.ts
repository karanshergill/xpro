import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext } from "@xpro/core/server";
import { createHubIdentities, type HubIdentities } from "#test/hub-identities";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubAuth } from "#auth/auth.server.ts";
import { symmetricDecrypt } from "better-auth/crypto";

const origin = "https://hub.example.test";
const password = "Access-fixture123!";
type Setup = { totpURI: string; backupCodes: string[] };
let identities: HubIdentities;
let auth: Awaited<ReturnType<typeof createHubAuth>>;

beforeEach(async () => {
  identities = await createHubIdentities(env.DB);
  auth = await createHubAuth({ database: env.DB, baseURL: origin, secret: identities.auth.options.secret,
    rateLimiter: { async limit() { return { success: true }; } },
  });
  await auth.$context;
});
afterEach(async () => { await identities.db.destroy(); });

describe("guarded native master enrollment", () => {
  it("Master enrollment", async () => {
    const login = await identities.signIn({ role: "admin" });
    const otherDevice = await identities.signInAgain(login);
    const setup = await auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password }, asResponse: true });
    expect(setup.status).toBe(200);
    const material: Setup = await setup.json();
    expect(material.backupCodes).toHaveLength(10);
    expect(new URL(material.totpURI).protocol).toBe("otpauth:");
    expect(await identities.db.selectFrom("user").selectAll().where("id", "=", login.loginId).executeTakeFirst())
      .toMatchObject({ authRevision: 0, twoFactorEnabled: 0 });
    const factor = await identities.db.withoutPlugins().selectFrom("twoFactor").select("secret")
      .where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    const secret = await symmetricDecrypt({ key: (await auth.$context).secretConfig, data: factor.secret });
    const code = (await auth.api.generateTOTP({ body: { secret } })).code;
    const verified = await auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code }, asResponse: true });
    expect(verified.status).toBe(200);
    const cookie = verified.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const session = await auth.api.getSession({ headers: { cookie } });
    if (!session) throw new Error("Native activation did not deliver a replacement session.");
    expect(session.session.id).not.toBe(login.hubSessionId);
    expect(await identities.db.selectFrom("session").select(["authRevision", "mfaVerifiedAt"]).where("id", "=", session.session.id).executeTakeFirst())
      .toEqual({ authRevision: 1, mfaVerifiedAt: expect.any(String) });
    expect(await auth.api.getSession({ headers: { cookie: otherDevice.cookie } })).toBeNull();
    const access = await createAccessRequest({ app: "hub", session: { loginId: login.loginId, hubSessionId: session.session.id },
      workspaceId: crypto.randomUUID(), context: createRequestContext(), hub: env.HUB_ACCESS });
    expect(access.authorize({ kind: "protected", hasLocalPermission: false }).isOk).toBe(true);
    expect(await identities.db.selectFrom("auditEntries").select(["action", "outcome"]).where("affectedLoginId", "=", login.loginId).orderBy("createdAt").execute())
      .toEqual([{ action: "accounts_mfa_setup_started", outcome: "success" }, { action: "accounts_mfa_enrolled", outcome: "success" }]);
  });

  it("Invalid enrollment code", async () => {
    const login = await identities.signIn({ role: "admin" });
    expect((await auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password }, asResponse: true })).status).toBe(200);
    const before = await identities.db.selectFrom("auditEntries").selectAll().execute();
    const verified = await auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: "not-a-code" }, asResponse: true });
    expect(verified.status).toBe(401);
    expect(await identities.db.selectFrom("user").selectAll().where("id", "=", login.loginId).executeTakeFirst())
      .toMatchObject({ authRevision: 0, twoFactorEnabled: 0 });
    expect(await identities.db.selectFrom("auditEntries").selectAll().execute()).toEqual(before);
    expect(verified.headers.getSetCookie()).toEqual([]);
    expect(await env.HUB_ACCESS.validateAccess({ loginId: login.loginId, hubSessionId: login.hubSessionId, workspaceId: null, context: createRequestContext() }))
      .toEqual({ status: "invalid", code: "core_unauthenticated" });
  });
});
