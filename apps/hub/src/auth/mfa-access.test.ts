import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext, type HubAccessInput, type HubAccessResult } from "@xpro/core/server";
import { createHubIdentities, type HubIdentities, type SignedInLogin } from "#test/hub-identities";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveHub } from "#db/hub-save.db.ts";
import { validateHubAccess, validateHubLocalAccess } from "@xpro/accounts/server";

let identities: HubIdentities;
beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { vi.restoreAllMocks(); await identities.db.destroy(); });

describe("live Hub-local MFA access", () => {
  it("when a real master has not enrolled then the Hub permits only enrollment, session checking and sign-out with one read", async () => {
    const login = await identities.signIn({ role: "admin" });
    await identities.signIn();
    const before = await identities.db.selectFrom("session").selectAll().orderBy("id").execute();
    const { access, calls } = await localRequest(login);
    const actor = { loginId: login.loginId, isMaster: true, membershipRole: null };
    for (const kind of ["check_session", "sign_out", "enroll_mfa"] as const) expect(access.authorize({ kind }).toJSON()).toEqual(ok(actor).toJSON());
    for (const action of [{ kind: "complete_profile" }, { kind: "manage_mfa" }, { kind: "protected", hasLocalPermission: true }] as const) {
      expect(access.authorize(action).toJSON()).toEqual(err({ code: "core_mfa_required" }).toJSON());
    }
    expect(calls).toHaveLength(1);
    expect(await validateHubLocalAccess(env.DB, calls[0])).toEqual({ status: "valid", actor, sessionExpiresAt: expect.any(String),
      isCreationComplete: true, missingProfileFields: [], mfa: { status: "enrollment_required" } });
    expect(await identities.db.selectFrom("session").selectAll().orderBy("id").execute()).toEqual(before);
  });

  it("when master creation is incomplete then enrollment cannot bypass it while sign-out stays available", async () => {
    const login = await identities.signIn({ role: "admin" });
    const id = crypto.randomUUID();
    await saveHub(env.DB, [
      identities.db.insertInto("loginCreations").values({ id, creatorLoginId: login.loginId, createdLoginId: login.loginId,
        organizationId: null, kind: null, details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
      identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile(),
    ]);
    const { access } = await localRequest(login);
    expect(access.authorize({ kind: "enroll_mfa" }).toJSON()).toEqual(err({ code: "core_creation_incomplete" }).toJSON());
    for (const kind of ["check_session", "sign_out"] as const) expect(access.authorize({ kind }).isOk).toBe(true);
  });

  it.each(["user", "admin"] as const)("when a %s login's revision advances then its retained session fails locally and through RPC", async (role) => {
    const login = await identities.signIn({ role });
    await saveHub(env.DB, [identities.db.updateTable("user").set({ authRevision: 1 }).where("id", "=", login.loginId).compile()]);
    const input = accessInput(login);
    expect(await validateHubLocalAccess(env.DB, input)).toEqual({ status: "invalid", code: "core_unauthenticated" });
    expect(await env.HUB_ACCESS.validateAccess(input)).toEqual({ status: "invalid", code: "core_unauthenticated" });
    expect(await identities.db.selectFrom("session").select(["authRevision", "mfaVerifiedAt"]).where("id", "=", login.hubSessionId).executeTakeFirst())
      .toEqual({ authRevision: 0, mfaVerifiedAt: null });
  });

  it.each([null, 1, 2])("when a master has enabled flag %s without a verified factor then no limited or external authority is returned", async (twoFactorEnabled) => {
    const login = await identities.signIn({ role: "admin" });
    // Negative corruption only; never manufacture a verified enrollment or session.
    await saveHub(env.DB, [identities.db.withoutPlugins().updateTable("user").set({ twoFactorEnabled }).where("id", "=", login.loginId).compile()]);
    const input = accessInput(login);
    expect(await validateHubLocalAccess(env.DB, input)).toEqual({ status: "invalid", code: "core_unauthenticated" });
    expect(await validateHubAccess(env.DB, input)).toEqual({ status: "invalid", code: "core_unauthenticated" });
  });

  it("when an ordinary login is promoted then the next request uses its current role and requires MFA", async () => {
    const administrator = await identities.signIn({ role: "admin" });
    const login = await identities.signIn();
    expect((await localRequest(login)).access.authorize({ kind: "protected", hasLocalPermission: true }).isOk).toBe(true);
    await identities.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId, role: "admin" } });
    expect((await localRequest(login)).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_mfa_required" }).toJSON());
    expect(await env.HUB_ACCESS.validateAccess(accessInput(login))).toEqual({ status: "invalid", code: "core_unauthenticated" });
  });

  it.each([
    undefined, null, {}, { status: "unknown" }, { status: "not_required" },
    { status: "verified" }, { status: "verified", verifiedAt: "not a time" },
    { status: "verified", verifiedAt: "9999-10-31T10:00:00.000Z" },
    { status: "enrollment_required", verifiedAt: "2026-10-31T10:00:00.000Z" },
  ])("when an actual Hub reply loses or corrupts its MFA contract (%j) then Core refuses and reports only a safe failure", async (mfa) => {
    const login = await identities.signIn({ role: "admin" });
    const context = createRequestContext();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const access = await createAccessRequest({ app: "hub", session: login, workspaceId: null, context, hub: {
      async validateAccess(input) {
        const result = await validateHubLocalAccess(env.DB, input);
        if (result.status !== "valid") throw new Error("The native session should have limited Hub access.");
        // Damage a real reply to model an old/incompatible transport; supply no positive authentication.
        return { ...result, mfa } as unknown as HubAccessResult;
      },
    } });
    for (const action of [{ kind: "check_session" }, { kind: "enroll_mfa" }, { kind: "protected", hasLocalPermission: true }] as const) {
      expect(access.authorize(action).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    }
    expect(access.sessionExpiresAt).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "core_unexpected_error", requestId: context.requestId, app: "hub", operation: "core_validate_access" }));
  });
});

async function localRequest(login: SignedInLogin) {
  const calls: HubAccessInput[] = [];
  const access = await createAccessRequest({ app: "hub", session: login, workspaceId: null, context: createRequestContext(), hub: {
    async validateAccess(input) { calls.push(input); return await validateHubLocalAccess(env.DB, input); },
  } });
  return { access, calls };
}

function accessInput(login: SignedInLogin): HubAccessInput {
  return { loginId: login.loginId, hubSessionId: login.hubSessionId, workspaceId: null, context: createRequestContext() };
}
