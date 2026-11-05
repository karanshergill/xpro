import { env } from "cloudflare:workers";
import { getCurrentUser, saveHub, type CoreError } from "@xpro/core/server";
import { sql } from "kysely";
import { err, ok, type Result } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedInLogin } from "#test/hub-identities";
import { createResetFixture, prepareResetServices, readResetState, signInAfterReset,
  type ResetFixture, type ResetPasswordServices } from "#test/reset-password";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { hubRequest, signInAtWorkspace, signInPassword, withWorkspace, workspaceServices } from "#test/sign-in";
import { resetPassword as reset } from "./reset-password.server";

type ResetInput = { loginId: string; newPassword: string; comment?: string };
type ResetError = CoreError | { code: "stms_login_not_found" };
// T029 supplies the real action; this contract provides no substitute implementation.
const resetPassword: (input: unknown, services: ResetPasswordServices) => Promise<Result<{ loginId: string }, ResetError>> = reset;
let fixture: ResetFixture;
beforeEach(async () => { fixture = await createResetFixture(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Story 3 — master password reset", () => {
  it("when a master resets a login without a comment then its password changes, every old device loses access and one audit identifies the master", async () => {
    const locals = [];
    for (const login of fixture.devices) locals.push(await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.workspace, login }));
    const otherLocal = await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.otherWorkspace, login: fixture.other });
    const input = resetInput();
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    const before = await readResetState(fixture);
    expect(before.hub.sessions.filter((session) => session.userId === fixture.target.loginId)).toHaveLength(2);
    const result = await resetPassword(input, services);
    expect(result.toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    await expectSaved({ input, services, before, actor: fixture.master });
    for (const login of fixture.devices) {
      expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: login.cookie }, query: { disableCookieCache: true } })).toBeNull();
    }
    // No sign-out message is registered: retained local rows must not grant access.
    expect((await readResetState(fixture)).workspace.sessions).toHaveLength(2);
    for (const local of locals) expect((await localAccess(fixture.workspace, local.cookie)).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await localAccess(fixture.otherWorkspace, otherLocal.cookie)).isOk).toBe(true);
    expect((await signInAfterReset({ fixture, login: fixture.target, password: signInPassword })).response.status).toBe(401);
    const signedIn = await signInAfterReset({ fixture, login: fixture.target, password: input.newPassword });
    expect(signedIn.response.status).toBe(200);
    if (!signedIn.login) throw new Error("A reset password must sign in its login.");
    const entered = await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.workspace, login: signedIn.login });
    expect(entered.response.headers.get("location")).toBe(fixture.workspace.origin + "/");
  });

  it("when a reset includes an optional comment then the successful audit keeps it without changing any other login or workspace", async () => {
    const input = { ...resetInput(), comment: "Requested through the support team" };
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    const before = await readResetState(fixture);
    expect((await resetPassword(input, services)).toJSON()).toEqual(ok({ loginId: input.loginId }).toJSON());
    await expectSaved({ input, services, before, actor: fixture.master });
  });

  it.each(["Abcdefghij1!", "A" + "b".repeat(60) + "1!x"])("when the new password has a valid boundary length (%s) then the ordinary password works", async (newPassword) => {
    const input = { ...resetInput(), newPassword };
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    const before = await readResetState(fixture);
    expect((await resetPassword(input, services)).toJSON()).toEqual(ok({ loginId: input.loginId }).toJSON());
    await expectSaved({ input, services, before, actor: fixture.master });
    expect((await signInAfterReset({ fixture, login: fixture.target, password: newPassword })).response.status).toBe(200);
  });

  it("when the person returns after 48 hours then the reset password still signs in and grants workspace access without another password change", async () => {
    const input = resetInput();
    expect((await resetPassword(input, await prepareResetServices({ fixture, actor: fixture.master }))).toJSON())
      .toEqual(ok({ loginId: input.loginId }).toJSON());
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 48 * 60 * 60 * 1_000);
    const signedIn = await signInAfterReset({ fixture, login: fixture.target, password: input.newPassword });
    expect(signedIn.response.status).toBe(200);
    if (!signedIn.login) throw new Error("An ordinary reset password must remain usable.");
    const entered = await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.workspace, login: signedIn.login });
    expect(entered.response.headers.get("location")).toBe(fixture.workspace.origin + "/");
  });

  it("when the target is another master then the same reset rules apply and master access is preserved", async () => {
    const target = await fixture.signIn.signInMaster();
    const input = { ...resetInput(), loginId: target.loginId };
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    const before = await readResetState(fixture);
    expect((await resetPassword(input, services)).toJSON()).toEqual(ok({ loginId: target.loginId }).toJSON());
    await expectSaved({ input, services, before, actor: fixture.master });
    expect((await signInAfterReset({ fixture, login: target, password: input.newPassword })).response.status).toBe(200);
  });

  it("when a master resets their own login then its acting session also ends while other logins keep their sessions", async () => {
    const input = { ...resetInput(), loginId: fixture.master.loginId };
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    const before = await readResetState(fixture);
    expect((await resetPassword(input, services)).toJSON()).toEqual(ok({ loginId: input.loginId }).toJSON());
    await expectSaved({ input, services, before, actor: fixture.master });
    expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: fixture.master.cookie } })).toBeNull();
    expect((await prepareResetServices({ fixture, actor: fixture.master })).access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await signInAfterReset({ fixture, login: fixture.master, password: input.newPassword })).response.status).toBe(200);
  });

  it.each(["suspended", "archived"] as const)("when the target is %s then resetting its password does not reactivate or restore it", async (status) => {
    await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user").set(status === "suspended"
      ? { banned: 1 } : { archivedAt: new Date().toISOString(), statusBeforeArchiving: "active" })
      .where("id", "=", fixture.target.loginId).compile()]);
    const input = resetInput();
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    const before = await readResetState(fixture);
    expect((await resetPassword(input, services)).toJSON()).toEqual(ok({ loginId: input.loginId }).toJSON());
    await expectSaved({ input, services, before, actor: fixture.master });
    expect((await signInAfterReset({ fixture, login: fixture.target, password: input.newPassword })).response.status).toBe(403);
  });

  it.each(["user", "owner", "admin", "member"] as const)("when a non-master %s tries a reset then no password, session or audit changes", async (role) => {
    const actor = role === "user" ? fixture.other : await fixture.signIn.identities.signIn();
    if (role !== "user") await fixture.signIn.identities.auth.api.addMember({ body: {
      userId: actor.loginId, organizationId: fixture.workspace.id, role,
    } });
    await expectRefused(resetInput(), actor, { code: "core_forbidden" });
  });

  it.each(["anonymous", "ended", "expired", "suspended", "archived", "demoted", "incomplete profile"] as const)(
    "when the acting master's authority is %s then a fresh reset request changes nothing", async (status) => {
      if (status === "ended") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
      if (status === "expired") {
        vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1_000);
      }
      if (status === "suspended" || status === "archived" || status === "demoted" || status === "incomplete profile") {
        const change = status === "suspended" ? { banned: 1 } : status === "archived" ? { archivedAt: new Date().toISOString() }
          : status === "demoted" ? { role: "user" } : { phone: null };
        await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user").set(change).where("id", "=", fixture.master.loginId).compile()]);
      }
      const error: ResetError = status === "anonymous" || status === "ended" || status === "expired" ? { code: "core_unauthenticated" }
        : status === "suspended" || status === "archived" ? { code: "core_login_inactive" }
        : status === "incomplete profile" ? { code: "core_profile_incomplete", fields: ["phone"] } : { code: "core_forbidden" };
      await expectRefused(resetInput(), status === "anonymous" ? null : fixture.master, error);
    },
  );

  it.each(["Abcdefghi1!", "A" + "b".repeat(61) + "1!x", "lowercase123!", "Uppercase-only!", "Uppercase12345", "", null, 123])(
    "when the new password breaks a required rule (%s) then the safe field error leaves every record unchanged", async (newPassword) => {
      await expectRefused({ ...resetInput(), newPassword }, fixture.master, { code: "core_invalid_input", fields: ["newPassword"] });
    },
  );

  it.each([undefined, null, "", "not-a-uuid", 123])("when the target ID is invalid (%s) then nothing changes", async (loginId) => {
    await expectRefused({ ...resetInput(), loginId }, fixture.master, { code: "core_invalid_input", fields: ["loginId"] });
  });

  it("when both required fields are missing then both field names are reported without submitted values", async () => {
    await expectRefused({}, fixture.master, { code: "core_invalid_input", fields: ["loginId", "newPassword"] });
  });

  it("when a caller submits authority or another write in the body then unknown fields cannot change the acting master or target records", async () => {
    await expectRefused({ ...resetInput(), actorLoginId: fixture.other.loginId, isMaster: true, role: "admin" }, fixture.other,
      { code: "core_forbidden" });
    await expectRefused({ ...resetInput(), actorLoginId: fixture.other.loginId }, fixture.master, { code: "core_invalid_input", fields: [] });
  });

  it("when the optional comment has the wrong type then it is refused without a partial save", async () => {
    await expectRefused({ ...resetInput(), comment: 123 }, fixture.master, { code: "core_invalid_input", fields: ["comment"] });
  });

  it("when the target login does not exist then the master receives a named refusal without an orphan audit", async () => {
    await expectRefused({ ...resetInput(), loginId: crypto.randomUUID() }, fixture.master, { code: "stms_login_not_found" });
  });

  it.each(["password", "sessions", "audit"] as const)("when saving %s fails then the old password, every old session and the audit log all stay unchanged", async (stage) => {
    const events = { password: 'update of "password" on "account"', sessions: 'delete on "session"', audit: 'insert on "audit_entries"' };
    await sql`create trigger test_refuse_reset before ${sql.raw(events[stage])}
      begin select raise(abort, 'test_reset_save_failed'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await readResetState(fixture);
    const input = resetInput();
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    expect((await resetPassword(input, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: "stms_reset_password" })]]);
    await sql`drop trigger test_refuse_reset`.execute(fixture.signIn.identities.db.withoutPlugins());
    for (const device of fixture.devices) expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: device.cookie } })).not.toBeNull();
    expect((await signInAfterReset({ fixture, login: fixture.target, password: signInPassword })).response.status).toBe(200);
    expect((await signInAfterReset({ fixture, login: fixture.target, password: input.newPassword })).response.status).toBe(401);
  });

  it("when native password hashing fails then no database state changes and only a safe request event is logged", async () => {
    const input = resetInput();
    const services = await prepareResetServices({ fixture, actor: fixture.master });
    const before = await readResetState(fixture);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hashPassword = async (): Promise<string> => { throw new Error(input.newPassword + fixture.target.cookie); };
    expect((await resetPassword(input, { ...services, hashPassword })).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: "stms_reset_password" })]]);
  });

  it.each(["/admin/set-user-password", "/admin/revoke-user-sessions", "/reset-password"])(
    "when a master posts directly to the disabled native %s route then it cannot bypass the audited reset action", async (path) => {
      const before = await readResetState(fixture);
      const response = await handleHubAuthRequest(hubRequest("/api/auth" + path, {
        userId: fixture.target.loginId, newPassword: resetInput().newPassword, token: "untrusted-reset-token",
      }, fixture.master.cookie), fixture.signIn.settings);
      expect(response.status).toBe(404);
      expect(await readResetState(fixture)).toEqual(before);
    },
  );
});

function resetInput(): ResetInput { return { loginId: fixture.target.loginId, newPassword: "Reset-password456!" }; }

async function expectRefused(input: unknown, actor: SignedInLogin | null, error: ResetError): Promise<void> {
  const services = await prepareResetServices({ fixture, actor });
  const before = await readResetState(fixture);
  expect((await resetPassword(input, services)).toJSON()).toEqual(err(error).toJSON());
  expect(await readResetState(fixture)).toEqual(before);
}

async function expectSaved(input: { input: ResetInput; services: ResetPasswordServices;
  before: Awaited<ReturnType<typeof readResetState>>; actor: SignedInLogin }): Promise<void> {
  const { before, services, actor, input: submitted } = input;
  const after = await readResetState(fixture);
  const credential = before.hub.credentials.find((row) => row.userId === submitted.loginId && row.providerId === "credential");
  if (!credential) throw new Error("Reset acceptance requires a real native credential.");
  const saved = after.hub.credentials.find((row) => row.id === credential.id);
  if (!saved?.password) throw new Error("The reset must preserve its credential with a native hash.");
  expect(saved.password).not.toBe(credential.password);
  const native = await fixture.signIn.identities.auth.$context;
  expect(await native.password.verify({ hash: saved.password, password: submitted.newPassword })).toBe(true);
  const audit = { id: expect.any(String), action: "stms_password_reset", outcome: "success",
    actorLoginId: actor.loginId, affectedLoginId: submitted.loginId, reason: null, comment: submitted.comment ?? null,
    requestId: services.context.requestId, createdAt: expect.any(String) };
  expect(after).toEqual({ ...before, hub: { ...before.hub,
    users: before.hub.users.map((row) => row.id === submitted.loginId ? { ...row, authRevision: row.authRevision + 1 } : row),
    credentials: before.hub.credentials.map((row) => row.id === credential.id ? { ...row, password: saved.password, updatedAt: expect.any(String) } : row),
    sessions: before.hub.sessions.filter((session) => session.userId !== submitted.loginId),
    audits: expect.arrayContaining([...before.hub.audits, audit]),
  } });
  expect(after.hub.audits).toHaveLength(before.hub.audits.length + 1);
  const newAudits = after.hub.audits.filter((row) => row.requestId === services.context.requestId);
  expect(newAudits).toHaveLength(1);
  const safe = JSON.stringify(newAudits);
  for (const secret of [submitted.newPassword, signInPassword, saved.password, credential.password, ...fixture.devices.map((device) => device.cookie)]) {
    if (secret) expect(safe).not.toContain(secret);
  }
}

async function localAccess(workspace: ResetFixture["workspace"], cookie: string) {
  return await withWorkspace(workspace, async ({ storage }) => await getCurrentUser(
    new Request(workspace.origin + "/private-work", { headers: { cookie } }),
    workspaceServices({ fixture: fixture.signIn, workspace, storage }, handleHubAuthRequest),
  ));
}
