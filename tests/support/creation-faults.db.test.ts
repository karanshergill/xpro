import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubIdentities, type HubIdentities } from "./hub-identities";
import { interruptAfterWrite } from "./creation-faults.db";

let identities: HubIdentities;
beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { await identities.db.destroy(); });

describe("Committed-write interruption fixture", () => {
  it.each(["run", "all", "first"] as const)("when a prepared %s loses its reply then the real write survives and that connection cannot continue", async (method) => {
    const input = reservation();
    const query = identities.db.insertInto("reservedUsernames").values(input).returning("id").compile();
    const connection = interruptAfterWrite(env.DB, isReservationWrite);
    await expect(connection.prepare(query.sql).bind(...query.parameters)[method]()).rejects.toThrow("test_connection_interrupted");
    expect(await identities.db.selectFrom("reservedUsernames").selectAll().execute()).toEqual([input]);
    expect(() => connection.prepare("select 1")).toThrow("test_connection_interrupted");
  });

  it("when a real batch loses its reply then every statement commits before the connection stops", async () => {
    const rows = [reservation(), reservation()];
    const connection = interruptAfterWrite(env.DB, isReservationWrite);
    await expect(saveHub(connection, rows.map((row) => identities.db.insertInto("reservedUsernames").values(row).compile())))
      .rejects.toThrow("test_connection_interrupted");
    expect(await identities.db.selectFrom("reservedUsernames").selectAll().orderBy("id").execute())
      .toEqual([...rows].sort((first, second) => first.id.localeCompare(second.id)));
  });

  it("when a read does not match the selected write then it uses the real database and remains usable", async () => {
    const row = reservation();
    await saveHub(env.DB, [identities.db.insertInto("reservedUsernames").values(row).compile()]);
    const connection = interruptAfterWrite(env.DB, isReservationWrite);
    const query = identities.db.selectFrom("reservedUsernames").selectAll().compile();
    expect((await connection.prepare(query.sql).bind(...query.parameters).all()).results).toEqual([
      { id: row.id, username: row.username, added_at: row.addedAt },
    ]);
    expect((await connection.prepare(query.sql).bind(...query.parameters).all()).results).toHaveLength(1);
  });

  it("when storage refuses a write then the fixture preserves that error and interrupts only a later successful write", async () => {
    const row = reservation();
    const query = identities.db.insertInto("reservedUsernames").values(row).compile();
    await saveHub(env.DB, [query]);
    const connection = interruptAfterWrite(env.DB, isReservationWrite);
    await expect(saveHub(connection, [query])).rejects.toThrow(/UNIQUE/);
    const next = reservation();
    await expect(saveHub(connection, [identities.db.insertInto("reservedUsernames").values(next).compile()]))
      .rejects.toThrow("test_connection_interrupted");
    expect(await identities.db.selectFrom("reservedUsernames").select("id").orderBy("id").execute())
      .toEqual([row, next].sort((first, second) => first.id.localeCompare(second.id)).map(({ id }) => ({ id })));
  });
});

function reservation(): { id: string; username: string; addedAt: string } {
  return { id: crypto.randomUUID(), username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7), addedAt: new Date().toISOString() };
}

function isReservationWrite(query: string): boolean { return /^insert into "reserved_usernames"/i.test(query); }
