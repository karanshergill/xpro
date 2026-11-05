import { env } from "cloudflare:workers";
import { createHubConnection, saveHub } from "@xpro/core/server";
import { checkUsername } from "@xpro/accounts/server";
import { CompiledQuery } from "kysely";
import { err } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createManagementFixture, prepareManagementServices, expectManagementSaved, findManagementUser,
  prepareManagementRefreshTokens, expectManagementTokensEnded } from "#test/login-management";
import { readResetState, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { signInPassword } from "#test/sign-in";
import { changeEmail } from "#change-email/change-email.server.ts";
import { changeUsername } from "#change-username/change-username.server.ts";
import { emailChangeQueries } from "#change-email/change-email.db.ts";
import { usernameChangeQueries } from "#change-username/change-username.db.ts";
import type { LoginChangeTables } from "#logins/changes.db.ts";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });
const changes = [
  { field: "email" as const, action: changeEmail, next: "storage-change@example.test", audit: "stms_email_changed" },
  { field: "username" as const, action: changeUsername, next: "newname", audit: "stms_username_changed" },
];
type Change = typeof changes[number];

describe("identifier storage invariants", () => {
  it("when a verified email is replaced then the new address is unverified while passwords and other records stay intact", async () => {
    await nativeUpdate({ emailVerified: true });
    const before = await readResetState(fixture), services = await prepareManagementServices({ actor: fixture.master });
    expect(findManagementUser(before, fixture.target.loginId).emailVerified).toBe(1);
    expect((await changeEmail({ loginId: fixture.target.loginId, email: "replacement@example.test" }, services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { email: "replacement@example.test", emailVerified: 0 },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId), action: "stms_email_changed" });
  });

  it("when a verified email is unchanged after normalization then verification, timestamps and access stay unchanged", async () => {
    await nativeUpdate({ emailVerified: true });
    const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
    expect((await changeEmail({ loginId: row.id, email: " " + row.email.toUpperCase() + " " },
      await prepareManagementServices({ actor: fixture.master }))).isOk).toBe(true);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when a username changes then verification of the unchanged email is retained", async () => {
    await nativeUpdate({ emailVerified: true });
    const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
    const services = await prepareManagementServices({ actor: fixture.master });
    expect((await changeUsername({ loginId: row.id, username: "newname" }, services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: row.id,
      userChanges: { username: "newname", displayUsername: "newname" },
      sessions: before.hub.sessions.filter((item) => item.userId !== row.id), action: "stms_username_changed",
      reservations: expectedReservations(before, row.username) });
  });

  it("when an incomplete login has no username then assigning its first username creates no empty reservation", async () => {
    await nativeUpdate({ username: null, displayUsername: null });
    const before = await readResetState(fixture), services = await prepareManagementServices({ actor: fixture.master });
    expect((await changeUsername({ loginId: fixture.target.loginId, username: "newname" }, services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { username: "newname", displayUsername: "newname" },
      sessions: before.hub.sessions.filter((item) => item.userId !== fixture.target.loginId),
      action: "stms_username_changed", reservations: before.hub.reservations });
  });

  it("when the displaced username is already reserved then its original reservation and history remain", async () => {
    const row = findManagementUser(await readResetState(fixture), fixture.target.loginId);
    if (!row.username) throw new Error("The full fixture needs a username.");
    await reserve(row.username);
    const before = await readResetState(fixture), services = await prepareManagementServices({ actor: fixture.master });
    expect((await changeUsername({ loginId: row.id, username: "newname" }, services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: row.id,
      userChanges: { username: "newname", displayUsername: "newname" },
      sessions: before.hub.sessions.filter((item) => item.userId !== row.id),
      action: "stms_username_changed", reservations: before.hub.reservations });
  });

  it("when the current username is itself reserved then an unchanged submission remains a complete no-op", async () => {
    const row = findManagementUser(await readResetState(fixture), fixture.target.loginId);
    if (!row.username) throw new Error("The full fixture needs a username.");
    await reserve(row.username);
    const before = await readResetState(fixture);
    expect((await changeUsername({ loginId: row.id, username: row.username },
      await prepareManagementServices({ actor: fixture.master }))).isOk).toBe(true);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each([
    { field: "email" as const, raw: "  Legacy@Example.test  ", value: "legacy@example.test", action: changeEmail },
    { field: "username" as const, raw: "  LEGACYX  ", value: "legacyx", action: changeUsername },
  ])("when legacy $field spacing/case matches the indexed normalized value then the raw row is left untouched", async ({ field, raw, value, action }) => {
    await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user").set({ [field]: raw })
      .where("id", "=", fixture.target.loginId).compile()]);
    const before = await readResetState(fixture);
    expect(findManagementUser(before, fixture.target.loginId)[field]).toBe(raw);
    expect((await action({ loginId: fixture.target.loginId, [field]: value },
      await prepareManagementServices({ actor: fixture.master }))).isOk).toBe(true);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(changes)("when identical $field changes race on one target then both succeed with one audit and one actual change", async (change) => {
    const services = [await prepareManagementServices({ actor: fixture.master }), await prepareManagementServices({ actor: fixture.master })];
    const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
    const results = await Promise.all(services.map((context) => change.action(submitted(change), context)));
    expect(results.every((result) => result.isOk)).toBe(true);
    const after = await readResetState(fixture), audit = after.hub.audits.find((item) => item.action === change.audit);
    const winner = services.find((context) => context.context.requestId === audit?.requestId);
    if (!winner) throw new Error("The single committed change needs its actual request context.");
    await expectManagementSaved({ fixture, before, services: winner, loginId: row.id,
      userChanges: change.field === "email" ? { email: change.next } : { username: change.next, displayUsername: change.next },
      sessions: before.hub.sessions.filter((item) => item.userId !== row.id), action: change.audit,
      reservations: change.field === "email" ? before.hub.reservations : expectedReservations(before, row.username) });
  });

  it("when two different usernames are saved in sequence then each displaced value is reserved exactly once", async () => {
    let before = await readResetState(fixture);
    for (const username of ["newfirst", "newlast"]) {
      const row = findManagementUser(before, fixture.target.loginId), services = await prepareManagementServices({ actor: fixture.master });
      expect((await changeUsername({ loginId: row.id, username }, services)).isOk).toBe(true);
      before = await expectManagementSaved({ fixture, before, services, loginId: row.id,
        userChanges: { username, displayUsername: username }, sessions: before.hub.sessions.filter((item) => item.userId !== row.id),
        action: "stms_username_changed", reservations: expectedReservations(before, row.username) });
    }
    expect((await checkUsername(env.DB, "newfirst")).toJSON()).toEqual(err({ code: "accounts_username_reserved" }).toJSON());
  });

  it.each(changes)("when native creation claims $field immediately before the batch then a named conflict preserves every committed record", async (change) => {
    const captured: { before?: Awaited<ReturnType<typeof readResetState>> } = {};
    const database = new Proxy(env.DB, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        await fixture.signIn.identities.auth.api.createUser({ body: {
          email: change.field === "email" ? change.next : "native-claim-" + crypto.randomUUID() + "@example.test",
          password: signInPassword, name: "Native concurrent claim", role: "user",
          ...(change.field === "username" ? { data: { username: change.next } } : {}),
        } });
        captured.before = await readResetState(fixture);
        return await target.batch(statements);
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    expect((await change.action(submitted(change), await prepareManagementServices({ actor: fixture.master, database }))).toJSON())
      .toEqual(err({ code: change.field === "email" ? "accounts_email_taken" : "accounts_username_taken" }).toJSON());
    if (!captured.before) throw new Error("The real native claim must commit before checking the change.");
    expect(await readResetState(fixture)).toEqual(captured.before);
  });

  it.each(changes)("when the $field batch commits but its reply is lost then one audited change remains and a fresh same-value submission does nothing", async (change) => {
    await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
    await prepareManagementRefreshTokens(fixture);
    const database = interruptAfterWrite(env.DB, (query) => /^insert into "audit_entries"/i.test(query));
    const services = await prepareManagementServices({ actor: fixture.master, database });
    const before = await readResetState(fixture), tokens = await readResetTokens(fixture), row = findManagementUser(before, fixture.target.loginId);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await change.action(submitted(change), services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: change.field === "email" ? "stms_change_email" : "stms_change_username" })]]);
    const after = await expectManagementSaved({ fixture, before, services, loginId: row.id,
      userChanges: change.field === "email" ? { email: change.next } : { username: change.next, displayUsername: change.next },
      sessions: before.hub.sessions.filter((item) => item.userId !== row.id), action: change.audit,
      reservations: change.field === "email" ? before.hub.reservations : expectedReservations(before, row.username) });
    const audit = after.hub.audits.find((item) => item.requestId === services.context.requestId);
    if (!audit) throw new Error("The committed identifier change must have its audit.");
    await expectManagementTokensEnded({ fixture, before: tokens, loginId: row.id, revokedAt: audit.createdAt });
    const savedTokens = await readResetTokens(fixture);
    expect((await change.action(submitted(change), await prepareManagementServices({ actor: fixture.master }))).isOk).toBe(true);
    expect(await readResetState(fixture)).toEqual(after);
    expect(await readResetTokens(fixture)).toEqual(savedTokens);
  });

  it.each(changes)("when $field statements are planned then every namespace probe, claim, reservation and revocation uses indexes", async (change) => {
    const db = await createHubConnection<LoginChangeTables>(env.DB);
    try {
      const base = { loginId: fixture.target.loginId, auditId: crypto.randomUUID(), actorLoginId: fixture.master.loginId,
        requestId: crypto.randomUUID(), createdAt: new Date().toISOString(), comment: null };
      const queries = change.field === "email" ? emailChangeQueries(db.withoutPlugins(), { ...base, email: change.next })
        : usernameChangeQueries(db.withoutPlugins(), { ...base, username: change.next, reservationId: crypto.randomUUID() });
      const details: string[] = [];
      for (const query of queries) {
        const plan = await db.withoutPlugins().executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
        const rows = plan.rows.map((row) => row.detail);
        expect(rows.filter((detail) => /\bSCAN\b/.test(detail) && detail !== "SCAN CONSTANT ROW")).toEqual([]);
        expect(query.parameters.length).toBeLessThanOrEqual(100); details.push(...rows);
      }
      expect(details.some((detail) => detail.includes("user_" + change.field + "_normalized_unique"))).toBe(true);
      for (const table of ["user", "audit_entries", "session", "oauthAccessToken", "oauthRefreshToken",
        ...(change.field === "username" ? ["reserved_usernames"] : [])]) {
        expect(details.some((detail) => detail.startsWith("SEARCH " + table + " ") && detail.includes("INDEX"))).toBe(true);
      }
    } finally { await db.destroy(); }
  });
});

function submitted(change: Change): { loginId: string; email?: string; username?: string } {
  return { loginId: fixture.target.loginId, [change.field]: change.next };
}
async function nativeUpdate(data: Record<string, unknown>): Promise<void> {
  await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId, data);
}
async function reserve(username: string): Promise<void> {
  await saveHub(env.DB, [fixture.signIn.identities.db.insertInto("reservedUsernames")
    .values({ id: crypto.randomUUID(), username, addedAt: new Date(0).toISOString() }).compile()]);
}
function expectedReservations(before: Awaited<ReturnType<typeof readResetState>>, username: string | null): ReturnType<typeof expect.arrayContaining> {
  return expect.arrayContaining([...before.hub.reservations, { id: expect.any(String), username, addedAt: expect.any(String) }]);
}
