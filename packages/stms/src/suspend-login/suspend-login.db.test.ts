import { env } from "cloudflare:workers";
import { CompiledQuery } from "kysely";
import { err } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHubConnection } from "@xpro/core/server";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createManagementFixture, prepareManagementServices, expectManagementSaved, suspendFixtureLogin,
  prepareManagementRefreshTokens, expectManagementTokensEnded } from "#test/login-management";
import { readResetState, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { suspendLogin } from "./suspend-login.server";
import { reactivateLogin } from "#reactivate-login/reactivate-login.server.ts";
import { suspensionQueries } from "./suspend-login.db";
import { reactivationQueries } from "#reactivate-login/reactivate-login.db.ts";
import type { LoginChangeTables } from "#logins/changes.db.ts";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("atomic login status storage", () => {
  it("when an existing native row has a null banned value then it can be suspended as active", async () => {
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId, { banned: null });
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    expect(before.hub.users.find((row) => row.id === fixture.target.loginId)?.banned).toBeNull();
    expect((await suspendLogin(input(), services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { banned: 1, banReason: "stms_unpaid", banExpires: null },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId), action: "stms_login_suspended", reason: "stms_unpaid" });
  });

  it("when an active row retains an old native expiry then suspension clears it without changing credentials or membership", async () => {
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId, { banExpires: new Date(0) });
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    expect(before.hub.users.find((row) => row.id === fixture.target.loginId)?.banExpires).not.toBeNull();
    expect((await suspendLogin(input(), services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { banned: 1, banReason: "stms_unpaid", banExpires: null },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId), action: "stms_login_suspended", reason: "stms_unpaid" });
  });

  it.each(["suspend", "reactivate"] as const)(
    "when %s commits but its reply is lost then the complete audited change remains and a fresh repeat conflicts", async (action) => {
      await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
      await prepareManagementRefreshTokens(fixture);
      if (action === "reactivate") await suspendFixtureLogin(fixture);
      const database = interruptAfterWrite(env.DB, (query) => /^insert into "audit_entries"/i.test(query));
      const services = await prepareManagementServices({ actor: fixture.master, database });
      const before = await readResetState(fixture), tokens = await readResetTokens(fixture);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const run = action === "suspend" ? suspendLogin : reactivateLogin;
      const submitted = action === "suspend" ? input() : { loginId: fixture.target.loginId };
      expect((await run(submitted, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
      expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: action === "suspend" ? "stms_suspend_login" : "stms_reactivate_login" })]]);
      const after = await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
        userChanges: action === "suspend" ? { banned: 1, banReason: "stms_unpaid", banExpires: null } : { banned: 0, banReason: null, banExpires: null },
        sessions: action === "suspend" ? before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId) : before.hub.sessions,
        action: action === "suspend" ? "stms_login_suspended" : "stms_login_reactivated",
        ...(action === "suspend" ? { reason: "stms_unpaid" } : {}) });
      const audit = after.hub.audits.find((row) => row.requestId === services.context.requestId);
      if (!audit) throw new Error("A committed status change must have its audit.");
      if (action === "suspend") await expectManagementTokensEnded({ fixture, before: tokens, loginId: fixture.target.loginId, revokedAt: audit.createdAt });
      else expect(await readResetTokens(fixture)).toEqual(tokens);
      expect((await run(submitted, await prepareManagementServices({ actor: fixture.master }))).toJSON())
        .toEqual(err({ code: "stms_login_state_conflict" }).toJSON());
      expect(await readResetState(fixture)).toEqual(after);
    },
  );

  it.each(["suspend", "reactivate"] as const)(
    "when %s statements are planned then the target, audit claim, user and every revocation use existing indexes", async (action) => {
      const db = await createHubConnection<LoginChangeTables>(env.DB);
      try {
        const saved = { loginId: fixture.target.loginId, auditId: crypto.randomUUID(), actorLoginId: fixture.master.loginId,
          requestId: crypto.randomUUID(), createdAt: new Date().toISOString() };
        const queries = action === "suspend" ? suspensionQueries(db.withoutPlugins(), { ...saved, reason: "stms_unpaid", comment: null })
          : reactivationQueries(db.withoutPlugins(), saved);
        const details: string[] = [];
        for (const query of queries) {
          const plan = await db.withoutPlugins().executeQuery<{ detail: string }>(
            CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
          const rows = plan.rows.map((row) => row.detail);
          expect(rows.filter((detail) => /\bSCAN\b/.test(detail) && detail !== "SCAN CONSTANT ROW")).toEqual([]);
          expect(query.parameters.length).toBeLessThanOrEqual(100);
          details.push(...rows);
        }
        const tables = action === "suspend" ? ["user", "audit_entries", "oauthAccessToken", "oauthRefreshToken", "session"] : ["user", "audit_entries"];
        for (const table of tables) {
          expect(details.some((detail) => detail.startsWith("SEARCH " + table + " ") && detail.includes("INDEX"))).toBe(true);
        }
      } finally { await db.destroy(); }
    },
  );
});

function input(): { loginId: string; reason: "stms_unpaid"; confirmed: true } {
  return { loginId: fixture.target.loginId, reason: "stms_unpaid", confirmed: true };
}
