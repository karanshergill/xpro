import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext } from "@xpro/core/server";
import { createHubIdentities, type HubIdentities } from "#test/hub-identities";
import { err } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let identities: HubIdentities;
beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { await identities.db.destroy(); vi.restoreAllMocks(); });

describe("Hub access through the real Service Binding", () => {
  it.each([null, crypto.randomUUID()])("when a master has not completed MFA then RPC refuses it for workspace %s", async (workspaceId) => {
    const login = await identities.signIn({ role: "admin" });
    const input = { loginId: login.loginId, hubSessionId: login.hubSessionId, workspaceId, context: createRequestContext() };
    // An older consumer can ignore new MFA fields; the binding itself must refuse.
    expect(await env.HUB_ACCESS.validateAccess(input)).toEqual({ status: "invalid", code: "core_unauthenticated" });
    const request = await createAccessRequest({ app: "hub", session: login, workspaceId, hub: env.HUB_ACCESS, context: input.context });
    expect(request.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it("when the real Hub session ends then the next RPC check denies it", async () => {
    const login = await identities.signIn();
    const input = { loginId: login.loginId, hubSessionId: login.hubSessionId, workspaceId: null, context: createRequestContext() };
    expect(await env.HUB_ACCESS.validateAccess(input)).toEqual({ status: "valid",
      actor: { loginId: login.loginId, isMaster: false, membershipRole: null }, sessionExpiresAt: expect.any(String),
      isCreationComplete: true, missingProfileFields: [], mfa: { status: "not_required" } });
    await identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    expect(await env.HUB_ACCESS.validateAccess(input)).toEqual({ status: "invalid", code: "core_unauthenticated" });
  });

  it.each([null, {}, { loginId: "not-an-id" }, { loginId: crypto.randomUUID(), hubSessionId: crypto.randomUUID(),
    workspaceId: null, context: createRequestContext(), isMaster: true }])("when RPC input is malformed or adds authority claims then it is refused (%j)", async (input) => {
    expect(await env.HUB_ACCESS.validateAccess(input)).toEqual({ status: "invalid", code: "core_unauthenticated" });
  });

  it.each(["hub", "workspace"] as const)("when %s runs a failing shared access check then it reports the executing app and no exception details", async (app) => {
    const login = await identities.signIn();
    await identities.db.withoutPlugins().schema.dropTable("session").execute();
    const context = createRequestContext();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = await createAccessRequest({ app, session: login, workspaceId: null, hub: env.HUB_ACCESS, context });
    expect(request.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "core_unexpected_error", requestId: context.requestId, app, operation: "core_validate_access" }));
  });
});
