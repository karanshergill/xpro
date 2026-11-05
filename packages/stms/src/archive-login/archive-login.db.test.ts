import { env } from "cloudflare:workers";
import { CompiledQuery } from "kysely";
import { err } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHubConnection } from "@xpro/core/server";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createManagementFixture, prepareManagementServices, expectManagementSaved, expectManagementRefusal,
  archiveFixtureLogin, prepareManagementRefreshTokens, expectManagementTokensEnded } from "#test/login-management";
import { readResetState, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { archiveLogin } from "./archive-login.server";
import { archiveQueries } from "./archive-login.db";
import { restoreLogin } from "#restore-login/restore-login.server.ts";
import { restoreQueries } from "#restore-login/restore-login.db.ts";
import { suspendLogin } from "#suspend-login/suspend-login.server.ts";
import type { LoginChangeTables } from "#logins/changes.db.ts";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("atomic archive storage", () => {
  it("when native banned is null then archiving remembers active and restoration preserves the native row and ended access", async () => {
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId, { banned: null });
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    expect(before.hub.users.find((row) => row.id === fixture.target.loginId)?.banned).toBeNull();
    expect((await archiveLogin(input(), services)).isOk).toBe(true);
    const archived = await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { archivedAt: expect.any(String), statusBeforeArchiving: "active" },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId), action: "stms_login_archived" });
    const restoreServices = await prepareManagementServices({ actor: fixture.master });
    expect((await restoreLogin({ loginId: fixture.target.loginId }, restoreServices)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before: archived, services: restoreServices, loginId: fixture.target.loginId,
      userChanges: { archivedAt: null, statusBeforeArchiving: null }, sessions: archived.hub.sessions, action: "stms_login_restored" });
  });

  it("when suspension commits after archive preparation then the batch remembers the new suspension instead of a stale active snapshot", async () => {
    const suspensionServices = await prepareManagementServices({ actor: fixture.master });
    let beforeArchive: Awaited<ReturnType<typeof readResetState>> | undefined;
    const database = new Proxy(env.DB, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        expect((await suspendLogin({ loginId: fixture.target.loginId, confirmed: true, reason: "stms_unpaid" }, suspensionServices)).isOk).toBe(true);
        beforeArchive = await readResetState(fixture);
        return await target.batch(statements);
      };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const services = await prepareManagementServices({ actor: fixture.master, database });
    expect((await archiveLogin(input(), services)).isOk).toBe(true);
    if (!beforeArchive) throw new Error("The real concurrent suspension must commit before the archive batch.");
    await expectManagementSaved({ fixture, before: beforeArchive, services, loginId: fixture.target.loginId,
      userChanges: { archivedAt: expect.any(String), statusBeforeArchiving: "suspended" },
      sessions: beforeArchive.hub.sessions, action: "stms_login_archived" });
  });

  it.each([
    { label: "missing history", status: null, banned: false },
    { label: "unknown history", status: "unknown", banned: false },
    { label: "active history with native suspension", status: "active", banned: true },
    { label: "suspended history with native activity", status: "suspended", banned: false },
  ])("when restoration sees $label then it refuses to guess and preserves all history", async ({ status, banned }) => {
    await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId, {
      statusBeforeArchiving: status, banned,
    });
    await expectManagementRefusal({ fixture, action: restoreLogin, submitted: { loginId: fixture.target.loginId },
      actor: fixture.master, error: { code: "stms_login_state_conflict" } });
  });

  it.each(["archive", "restore"] as const)(
    "when %s commits but its reply is lost then the complete change persists and a fresh repeat conflicts", async (action) => {
      await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
      await prepareManagementRefreshTokens(fixture);
      if (action === "restore") await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
      const database = interruptAfterWrite(env.DB, (query) => /^insert into "audit_entries"/i.test(query));
      const services = await prepareManagementServices({ actor: fixture.master, database });
      const before = await readResetState(fixture), tokens = await readResetTokens(fixture);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const run = action === "archive" ? archiveLogin : restoreLogin;
      const submitted = action === "archive" ? input() : { loginId: fixture.target.loginId };
      expect((await run(submitted, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
      expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: action === "archive" ? "stms_archive_login" : "stms_restore_login" })]]);
      const after = await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
        userChanges: action === "archive" ? { archivedAt: expect.any(String), statusBeforeArchiving: "active" } : { archivedAt: null, statusBeforeArchiving: null },
        sessions: action === "archive" ? before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId) : before.hub.sessions,
        action: action === "archive" ? "stms_login_archived" : "stms_login_restored" });
      const audit = after.hub.audits.find((row) => row.requestId === services.context.requestId);
      if (!audit) throw new Error("A committed archive transition must have its audit.");
      if (action === "archive") await expectManagementTokensEnded({ fixture, before: tokens, loginId: fixture.target.loginId, revokedAt: audit.createdAt });
      else expect(await readResetTokens(fixture)).toEqual(tokens);
      expect((await run(submitted, await prepareManagementServices({ actor: fixture.master }))).toJSON())
        .toEqual(err({ code: "stms_login_state_conflict" }).toJSON());
      expect(await readResetState(fixture)).toEqual(after);
    },
  );

  it.each(["archive", "restore"] as const)(
    "when %s queries are planned then every lookup, claim and mutation uses existing indexes", async (action) => {
      const db = await createHubConnection<LoginChangeTables>(env.DB);
      try {
        const saved = { loginId: fixture.target.loginId, auditId: crypto.randomUUID(), actorLoginId: fixture.master.loginId,
          requestId: crypto.randomUUID(), createdAt: new Date().toISOString() };
        const queries = action === "archive" ? archiveQueries(db.withoutPlugins(), { ...saved, comment: null }) : restoreQueries(db.withoutPlugins(), saved);
        const details: string[] = [];
        for (const query of queries) {
          const plan = await db.withoutPlugins().executeQuery<{ detail: string }>(
            CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
          const rows = plan.rows.map((row) => row.detail);
          expect(rows.filter((detail) => /\bSCAN\b/.test(detail) && detail !== "SCAN CONSTANT ROW")).toEqual([]);
          expect(query.parameters.length).toBeLessThanOrEqual(100);
          details.push(...rows);
        }
        const tables = action === "archive" ? ["user", "audit_entries", "oauthAccessToken", "oauthRefreshToken", "session"] : ["user", "audit_entries"];
        for (const table of tables) expect(details.some((detail) => detail.startsWith("SEARCH " + table + " ") && detail.includes("INDEX"))).toBe(true);
      } finally { await db.destroy(); }
    },
  );
});

function input(): { loginId: string; confirmed: true } { return { loginId: fixture.target.loginId, confirmed: true }; }
