import { env } from "cloudflare:workers";
import { createHubIdentities, type HubIdentities } from "#test/hub-identities";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let identities: HubIdentities;
const origin = "https://hub.example.test";
beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { await identities.db.destroy(); });

describe("native username rules", () => {
  it.each(["a-b.c_12", "A-B.C_12"])("when a valid prepared username is entered as %s then real HTTP sign-in succeeds", async (username) => {
    const created = await identities.createLogin({ username: "a-b.c_12" });
    const response = await identities.auth.handler(new Request(`${origin}/api/auth/sign-in/username`, { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username, password: "Access-fixture123!" }) }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const session = await identities.auth.api.getSession({ headers: { cookie } });
    expect(session?.user).toMatchObject({ id: created.loginId, username: "a-b.c_12" });
  });
});
