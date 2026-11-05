import { env } from "cloudflare:workers";
import { createHubConnection } from "@xpro/core/server";
import { CompiledQuery } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOwnProfileFixture, readOwnProfileState, type OwnProfileFixture } from "#test/own-profile";
import { saveProfile, updateProfileQuery, type ProfileTables } from "./update-profile.db";

let fixture: OwnProfileFixture;
beforeEach(async () => { fixture = await createOwnProfileFixture(); });
afterEach(async () => { await fixture.signIn.identities.db.destroy(); });

describe("Own-profile storage", () => {
  it("when the profile update is planned then its login lookup uses an existing index without a table scan", async () => {
    const db = await createHubConnection<ProfileTables>(env.DB);
    try {
      const query = updateProfileQuery(db, { id: fixture.person.loginId, name: "Updated person", phone: "+442079460018", updatedAt: new Date().toISOString() });
      const plan = await db.withoutPlugins().executeQuery<{ detail: string }>(
        CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]),
      );
      expect(plan.rows.some((row) => row.detail.startsWith("SEARCH user ") && row.detail.includes("INDEX"))).toBe(true);
      expect(plan.rows.filter((row) => /\bSCAN\b/.test(row.detail))).toEqual([]);
    } finally { await db.destroy(); }
  });

  it("when the requested login is absent then profile storage reports no save and every existing record stays unchanged", async () => {
    const before = await readOwnProfileState(fixture);
    expect(await saveProfile(env.DB, { id: crypto.randomUUID(), name: "Other person", phone: "+442079460018", updatedAt: new Date().toISOString() })).toBe(false);
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });
});
