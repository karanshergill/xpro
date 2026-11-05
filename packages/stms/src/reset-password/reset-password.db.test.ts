import { env } from "cloudflare:workers";
import { createHubConnection, saveHub } from "@xpro/core/server";
import { CompiledQuery, sql } from "kysely";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResetFixture, prepareResetServices, readResetState, signInAfterReset, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { resetPassword } from "./reset-password.server";
import { resetLoginQuery, resetPasswordQueries, type PasswordResetTables } from "./reset-password.db";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createResetFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Password-reset storage", () => {
  it("when the target has no credential then reset creates one native credential with its audit and the ordinary password signs in", async () => {
    const email = `credential-${crypto.randomUUID()}@example.test`;
    const created = await fixture.signIn.identities.auth.api.createUser({ body: {
      email, name: "Credential fixture", role: "user", data: { username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7), phone: "+12025550123" },
    } });
    const input = { loginId: created.user.id, newPassword: "Reset-credential789!" };
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    const before = await readResetState(fixture);
    expect(before.hub.credentials.filter((row) => row.userId === input.loginId)).toEqual([]);
    expect((await resetPassword(input, services)).toJSON()).toEqual(ok({ loginId: input.loginId }).toJSON());
    const after = await readResetState(fixture);
    const credential = after.hub.credentials.find((row) => row.userId === input.loginId);
    expect(credential).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
      userId: input.loginId, accountId: input.loginId, providerId: "credential", password: expect.any(String) });
    expect(after.hub.credentials.filter((row) => row.userId === input.loginId)).toHaveLength(1);
    expect(after.hub.credentials.filter((row) => row.userId !== input.loginId)).toEqual(before.hub.credentials);
    expect(after.hub.audits.filter((row) => row.requestId === services.context.requestId)).toEqual([
      expect.objectContaining({ action: "stms_password_reset", actorLoginId: fixture.master.loginId, affectedLoginId: input.loginId }),
    ]);
    expect(after.hub.audits).toHaveLength(before.hub.audits.length + 1);
    expect(after.hub.users).toEqual(before.hub.users.map((row) => row.id === input.loginId ? { ...row, authRevision: row.authRevision + 1 } : row));
    expect({ ...after, hub: { ...after.hub, users: before.hub.users, credentials: before.hub.credentials, audits: before.hub.audits } }).toEqual(before);
    expect((await signInAfterReset({ fixture, login: { loginId: input.loginId, email }, password: input.newPassword })).response.status).toBe(200);
  });

  it("when an audit fails while adding the first credential then neither the new credential nor a partial reset survives", async () => {
    await saveHub(env.DB, [fixture.signIn.identities.db.withoutPlugins().deleteFrom("account")
      .where("userId", "=", fixture.target.loginId).where("providerId", "=", "credential").compile()]);
    await sql`create trigger test_refuse_new_reset before insert on audit_entries
      begin select raise(abort, 'test_reset_audit_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await readResetState(fixture);
    expect((await resetPassword(resetInput(), await prepareResetServices({ fixture, actor: fixture.master }))).toJSON())
      .toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the batch commits but its reply is lost then password, ended sessions and the audit remain committed together", async () => {
    const database = interruptAfterWrite(env.DB, (query) => /^insert into "account"/i.test(query));
    const services = await prepareResetServices({ fixture, actor: fixture.master, database });
    const before = await readResetState(fixture);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await resetPassword(resetInput(), services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    const after = await readResetState(fixture);
    expect(after.hub.sessions).toEqual(before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId));
    expect(after.hub.audits.filter((row) => row.requestId === services.context.requestId)).toEqual([
      expect.objectContaining({ action: "stms_password_reset", affectedLoginId: fixture.target.loginId, actorLoginId: fixture.master.loginId }),
    ]);
    expect((await signInAfterReset({ fixture, login: fixture.target, password: resetInput().newPassword })).response.status).toBe(200);
  });

  it("when a reset ends sessions then stored refresh tokens are revoked while prior revocations and another login stay unchanged", async () => {
    await prepareRefreshTokens();
    const before = await readResetTokens(fixture);
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    expect((await resetPassword(resetInput(), services)).isOk).toBe(true);
    const after = await readResetTokens(fixture);
    const audit = await fixture.signIn.identities.db.selectFrom("auditEntries").select("createdAt")
      .where("requestId", "=", services.context.requestId).executeTakeFirstOrThrow();
    expect(after).toEqual({ ...before, refresh: before.refresh.map((row) => row.userId === fixture.target.loginId
      ? { ...row, revoked: row.revoked ?? audit.createdAt, sessionId: null } : row) });
  });

  it.each(["oauthAccessToken", "oauthRefreshToken"] as const)("when saving %s revocation fails then every password, session, token and audit remains unchanged", async (table) => {
    const issued = await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
    await prepareRefreshTokens();
    await sql`create trigger test_refuse_token_reset before update of revoked on ${sql.id(table)}
      begin select raise(abort, 'test_reset_token_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    const before = await readResetState(fixture), tokens = await readResetTokens(fixture);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await resetPassword(resetInput(), await prepareResetServices({ fixture, actor: fixture.master }))).toJSON())
      .toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
    expect(await readResetTokens(fixture)).toEqual(tokens);
    expect((await handleHubAuthRequest(new Request("https://hub.example.test/api/auth/oauth2/userinfo", {
      headers: { authorization: "Bearer " + issued.accessToken },
    }), fixture.signIn.settings)).status).toBe(200);
  });

  it("when reset queries are planned then every target lookup and revocation uses existing indexes", async () => {
    const db = await createHubConnection<PasswordResetTables>(env.DB);
    try {
      const native = db.withoutPlugins();
      const queries = [resetLoginQuery(native, fixture.target.loginId), ...resetPasswordQueries(native, {
        loginId: fixture.target.loginId, actorLoginId: fixture.master.loginId, passwordHash: "query-plan-only",
        credentialId: crypto.randomUUID(), auditId: crypto.randomUUID(), comment: null,
        requestId: crypto.randomUUID(), createdAt: new Date().toISOString(),
      })];
      const details: string[] = [];
      for (const query of queries) {
        const plan = await native.executeQuery<{ detail: string }>(CompiledQuery.raw(`explain query plan ${query.sql}`, [...query.parameters]));
        const rows = plan.rows.map((row) => row.detail);
        expect(rows.filter((detail) => /\bSCAN\b/.test(detail) && detail !== "SCAN CONSTANT ROW")).toEqual([]);
        details.push(...rows);
      }
      for (const table of ["user", "session", "verification", "oauthAccessToken", "oauthRefreshToken"]) {
        expect(details.some((detail) => detail.startsWith("SEARCH " + table + " ") && detail.includes("INDEX"))).toBe(true);
      }
    } finally { await db.destroy(); }
  });
});

function resetInput(): { loginId: string; newPassword: string } { return { loginId: fixture.target.loginId, newPassword: "Reset-password456!" }; }

async function prepareRefreshTokens(): Promise<void> {
  const native = await fixture.signIn.identities.auth.$context;
  for (const input of [{ login: fixture.target, revoked: null }, { login: fixture.target, revoked: new Date(0) }, { login: fixture.other, revoked: null }]) {
    // Native model setup only; refresh grants remain disabled in the application.
    await native.adapter.create({ model: "oauthRefreshToken", data: {
      token: crypto.randomUUID(), clientId: fixture.workspace.clientId, userId: input.login.loginId,
      sessionId: input.login.hubSessionId, scopes: ["openid"], createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000), revoked: input.revoked,
    } });
  }
}
