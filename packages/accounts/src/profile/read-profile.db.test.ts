import { env } from "cloudflare:workers";
import { createHubConnection } from "@xpro/core/server";
import { CompiledQuery } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createOwnProfileFixture, readOwnProfileState, type OwnProfileFixture } from "#test/own-profile";
import { ownProfileQuery, readOwnProfile, type OwnProfileTables } from "./read-profile.db";

let fixture: OwnProfileFixture;
beforeEach(async () => { fixture = await createOwnProfileFixture(); });
afterEach(async () => { await fixture.signIn.identities.db.destroy(); });

it("when a login's private profile is read then only its explicit fields are returned through an indexed lookup", async () => {
  const before = await readOwnProfileState(fixture), own = before.hub.users.find((user) => user.id === fixture.person.loginId);
  expect(await readOwnProfile(env.DB, fixture.person.loginId)).toEqual({ loginId: fixture.person.loginId, email: own?.email,
    username: own?.username, name: own?.name, phone: own?.phone, pictureKey: null });
  const db = await createHubConnection<OwnProfileTables>(env.DB);
  try {
    const query = ownProfileQuery(db, fixture.person.loginId);
    const plan = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
    expect(plan.rows.some((row) => row.detail.startsWith("SEARCH user ") && row.detail.includes("INDEX"))).toBe(true);
    expect(plan.rows.filter((row) => /\bSCAN\b/.test(row.detail))).toEqual([]);
  } finally { await db.destroy(); }
  expect(await readOwnProfileState(fixture)).toEqual(before);
});

it("when a login does not exist then no profile or other login is returned", async () => {
  expect(await readOwnProfile(env.DB, crypto.randomUUID())).toBeNull();
});
