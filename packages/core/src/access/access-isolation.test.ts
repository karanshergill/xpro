import { env } from "cloudflare:workers";
import { createHubIdentities, type HubIdentities } from "#test/hub-identities";
import { saveHub, validateHubAccess } from "#test/hub-access";
import { createRequestContext } from "#server/request.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { err } from "true-myth/result";
import { createAccessRequest } from "./access.server";

let identities: HubIdentities;
beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { await identities.db.destroy(); });

describe("request authorization isolation", () => {
  it("when creation is unfinished then only session checking and sign-out remain available", async () => {
    const login = await identities.signIn();
    const id = crypto.randomUUID();
    await saveHub(env.DB, [
      identities.db.insertInto("loginCreations").values({ id, creatorLoginId: login.loginId, createdLoginId: login.loginId,
        organizationId: null, kind: null, details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
      identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile(),
    ]);
    const access = await createAccessRequest({ app: "hub", session: login, workspaceId: null, context: createRequestContext(),
      hub: { async validateAccess(input) { return await validateHubAccess(env.DB, input); } } });
    expect(access.authorize({ kind: "check_session" }).isOk).toBe(true);
    expect(access.authorize({ kind: "sign_out" }).isOk).toBe(true);
    expect(access.authorize({ kind: "complete_profile" }).toJSON()).toEqual(err({ code: "core_creation_incomplete" }).toJSON());
  });

  it("when a caller changes a returned actor then it cannot change later permission decisions", async () => {
    const login = await identities.signIn();
    const access = await createAccessRequest({ app: "hub", session: login, workspaceId: null, context: createRequestContext(),
      hub: { async validateAccess(input) { return await validateHubAccess(env.DB, input); } } });
    const result = access.authorize({ kind: "protected", hasLocalPermission: true });
    if (result.isErr) throw new Error("The complete login should be authorized.");
    result.value.isMaster = true;
    expect(access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
  });

  it("when a caller clears returned missing fields then protected access still requires completion", async () => {
    const login = await identities.signIn({ username: null, name: "", phone: null });
    const access = await createAccessRequest({ app: "hub", session: login, workspaceId: null, context: createRequestContext(),
      hub: { async validateAccess(input) { return await validateHubAccess(env.DB, input); } } });
    const result = access.authorize({ kind: "protected", hasLocalPermission: true });
    if (result.isOk || result.error.code !== "core_profile_incomplete") throw new Error("The profile should require completion.");
    result.error.fields.length = 0;
    expect(access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_profile_incomplete", fields: ["username", "name", "phone"] }).toJSON());
  });
});
