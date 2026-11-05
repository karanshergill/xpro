import { env } from "cloudflare:workers";
import { createSignInFixture, type SignInFixture } from "#test/sign-in";
import { CompiledQuery } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";
import { destinationQuery, requestedWorkspaceQuery } from "./sign-in.db";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); });

it("when default and requested destinations are read then every shared table uses an index", async () => {
  const login = await fixture.identities.createLogin();
  const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
  const db = fixture.identities.db;
  const queries = [destinationQuery(login.loginId).compile(db.withoutPlugins()), requestedWorkspaceQuery(db, workspace.id)];
  for (const query of queries) {
    const plan = await db.withoutPlugins().executeQuery<{ detail: string }>(CompiledQuery.raw(`explain query plan ${query.sql}`, [...query.parameters]));
    const details = plan.rows.map(({ detail }) => detail);
    expect(details.filter((detail) => /\bSCAN\b/.test(detail) && detail !== "SCAN CONSTANT ROW")).toEqual([]);
    expect(details.some((detail) => detail.includes("SEARCH") && detail.includes("INDEX"))).toBe(true);
  }
});
