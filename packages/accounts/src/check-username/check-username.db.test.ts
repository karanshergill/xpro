import { env } from "cloudflare:workers";
import { createHubIdentities, type HubIdentities } from "#test/hub-identities";
import { saveHub } from "#test/hub-access";
import { CompiledQuery } from "kysely";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkUsername, usernameAvailabilityQuery } from "./check-username.db";

let identities: HubIdentities;
beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { await identities.db.destroy(); });

describe("username availability", () => {
  it.each(["abcd", "a-b.c_12"])("when %s is valid and unused then the check permits it without changing shared records", async (username) => {
    const owner = await identities.signIn();
    await identities.auth.api.createOrganization({ body: { name: "Unrelated workspace", slug: `username-${crypto.randomUUID()}`, userId: owner.loginId } });
    const before = await readState();
    expect((await checkUsername(env.DB, username)).toJSON()).toEqual(ok({ username }).toJSON());
    expect(await readState()).toEqual(before);
  });

  it.each([null, undefined, [], "abc", "abcdefghi", "1abc", "Abcd", "abcd\n"])("when the username is invalid (%j) then it is refused without needing a database query", async (username) => {
    await identities.db.schema.dropTable("reservedUsernames").execute();
    expect((await checkUsername(env.DB, username)).toJSON()).toEqual(err({ code: "accounts_username_invalid" }).toJSON());
  });

  it.each(["active", "suspended", "archived"] as const)("when another %s login owns the username then it remains taken", async (status) => {
    const username = makeUsername();
    const login = await identities.signIn({ username });
    if (status !== "active") await saveHub(env.DB, [identities.db.updateTable("user")
      .set(status === "suspended" ? { banned: 1 } : { archivedAt: new Date().toISOString() }).where("id", "=", login.loginId).compile()]);
    const before = await readState();
    expect((await checkUsername(env.DB, username)).toJSON()).toEqual(err({ code: "accounts_username_taken" }).toJSON());
    expect(await readState()).toEqual(before);
  });

  it("when a legacy username differs by case or surrounding spaces then the normalized name is still taken", async () => {
    const login = await identities.signIn();
    await saveHub(env.DB, [identities.db.updateTable("user").set({ username: " TeSt " }).where("id", "=", login.loginId).compile()]);
    expect((await checkUsername(env.DB, "test")).toJSON()).toEqual(err({ code: "accounts_username_taken" }).toJSON());
  });

  it("when a name is reserved then the check reports the reservation without changing it", async () => {
    const username = makeUsername();
    await reserveUsername(username);
    const before = await readState();
    expect((await checkUsername(env.DB, username)).toJSON()).toEqual(err({ code: "accounts_username_reserved" }).toJSON());
    expect(await readState()).toEqual(before);
  });

  it("when a name is both reserved and still assigned then the reservation prevents reuse", async () => {
    const username = makeUsername();
    await identities.signIn({ username });
    await reserveUsername(username);
    expect((await checkUsername(env.DB, username)).toJSON()).toEqual(err({ code: "accounts_username_reserved" }).toJSON());
  });

  it("when a later request follows a successful availability check then it reads the new owner", async () => {
    const username = makeUsername();
    expect((await checkUsername(env.DB, username)).toJSON()).toEqual(ok({ username }).toJSON());
    await identities.signIn({ username });
    expect((await checkUsername(env.DB, username)).toJSON()).toEqual(err({ code: "accounts_username_taken" }).toJSON());
  });

  it("when the required database read fails then availability is never reported as successful", async () => {
    await identities.db.schema.dropTable("reservedUsernames").execute();
    await expect(checkUsername(env.DB, makeUsername())).rejects.toThrow();
  });

  it("when the shared query runs then both lookups use their existing indexes", async () => {
    const query = usernameAvailabilityQuery(identities.db, "abcd");
    expect(query.parameters).toEqual(["abcd", "abcd"]);
    const plan = await identities.db.withoutPlugins().executeQuery<{ detail: string }>(CompiledQuery.raw(`explain query plan ${query.sql}`, [...query.parameters]));
    const details = plan.rows.map((row) => row.detail);
    // SELECT without FROM has one constant row; it does not scan shared storage.
    expect(details.filter((detail) => /\bSCAN\b/.test(detail) && detail !== "SCAN CONSTANT ROW")).toEqual([]);
    expect(details.some((detail) => detail.startsWith("SEARCH user ") && detail.includes("user_username_normalized_unique"))).toBe(true);
    expect(details.some((detail) => detail.startsWith("SEARCH reserved_usernames ") && detail.includes("INDEX"))).toBe(true);
  });
});

function makeUsername(): string { return `u${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}`; }

async function reserveUsername(username: string): Promise<void> {
  await saveHub(env.DB, [identities.db.insertInto("reservedUsernames")
    .values({ id: crypto.randomUUID(), username, addedAt: new Date().toISOString() }).compile()]);
}

async function readState() {
  return {
    users: await identities.db.selectFrom("user").selectAll().orderBy("id").execute(),
    credentials: await identities.db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await identities.db.selectFrom("session").selectAll().orderBy("id").execute(),
    reservations: await identities.db.selectFrom("reservedUsernames").selectAll().orderBy("id").execute(),
    workspaces: await identities.db.selectFrom("organization").selectAll().orderBy("id").execute(),
    members: await identities.db.selectFrom("member").selectAll().orderBy("id").execute(),
    audits: await identities.db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}
