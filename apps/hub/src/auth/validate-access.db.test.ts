import { env } from "cloudflare:workers";
import { createRequestContext } from "@xpro/core/server";
import { createHubIdentities, type HubIdentities } from "#test/hub-identities";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginAccessQuery, sessionAccessQuery } from "./validate-access.db";

let identities: HubIdentities;
beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { await identities.db.destroy(); });

describe("shared access query plans", () => {
  it("when a session is checked then all joined tables use indexed lookups", async () => {
    const login = await identities.signIn();
    const query = sessionAccessQuery({ ...login, workspaceId: crypto.randomUUID(), context: createRequestContext() });
    const plan = await sql<{ detail: string }>`explain query plan ${query}`.execute(identities.db.withoutPlugins());
    expect(plan.rows.some((row) => /\bSCAN\b/.test(row.detail))).toBe(false);
    for (const table of ["s", "u", "c", "m", "f"]) expect(plan.rows.some((row) => row.detail.startsWith(`SEARCH ${table} USING`))).toBe(true);
  });

  it("when session creation checks a login then identity and completion use indexed lookups", async () => {
    const login = await identities.signIn();
    const plan = await sql<{ detail: string }>`explain query plan ${loginAccessQuery(login.loginId)}`.execute(identities.db.withoutPlugins());
    expect(plan.rows.some((row) => /\bSCAN\b/.test(row.detail))).toBe(false);
    for (const table of ["u", "c"]) expect(plan.rows.some((row) => row.detail.startsWith(`SEARCH ${table} USING`))).toBe(true);
  });
});
