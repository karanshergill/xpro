import { env } from "cloudflare:workers";
import { getCurrentUser, saveHub, type CoreError } from "@xpro/core/server";
import { sql } from "kysely";
import { err, type Result } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnProfileFixture, preparePasswordServices, readOwnProfileState,
  type OwnProfileFixture, type PasswordServices } from "#test/own-profile";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { hubRequest, readCookies, signInAtWorkspace, signInPassword, withWorkspace, workspaceServices } from "#test/sign-in";
import { changePassword as change } from "./change-password.server";

type PasswordError = CoreError | { code: "accounts_current_password_invalid" };
type PasswordChange = { loginId: string; headers: Headers };
const changePassword: (input: unknown, services: PasswordServices) => Promise<Result<PasswordChange, PasswordError>> = change;
let fixture: OwnProfileFixture;
beforeEach(async () => { fixture = await createOwnProfileFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Story 4 — own password", () => {
  it("when native password rotation observes a changed page identity then the action returns that safe refusal without altering either login or workspace", async () => {
    const services = await preparePasswordServices({ fixture, actor: fixture.person, pageLoginId: fixture.other.loginId });
    const before = await readOwnProfileState(fixture), log = vi.spyOn(console, "error");
    expect((await changePassword(validInput(), services)).toJSON()).toEqual(err({ code: "core_identity_changed" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before); expect(log).not.toHaveBeenCalled();
  });
  it("when a person enters their current password and a valid new one then other devices end and the returned cookie keeps this device signed in", async () => {
    const currentLocal = await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.workspace, login: fixture.person });
    const otherDeviceLocal = await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.workspace, login: fixture.secondDevice });
    const unrelatedLocal = await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.otherWorkspace, login: fixture.other });
    const before = await readOwnProfileState(fixture);
    const result = await changePassword(validInput(), await preparePasswordServices({ fixture, actor: fixture.person }));
    if (result.isErr) throw new Error("A valid own-password change was refused: " + result.error.code);
    expect({ ...result.value, headers: "headers only" }).toEqual({ loginId: fixture.person.loginId, headers: "headers only" });
    const response = new Response(null, { headers: result.value.headers });
    const cookie = readCookies(response);
    expect(cookie).not.toBe("");
    expect(cookie).not.toBe(fixture.person.cookie);
    expect(result.value.headers.getSetCookie().some((value) => /;\s*HttpOnly/i.test(value) && /;\s*Secure/i.test(value))).toBe(true);
    const current = await fixture.signIn.identities.auth.api.getSession({ headers: { cookie }, query: { disableCookieCache: true } });
    expect(current?.user.id).toBe(fixture.person.loginId);
    if (!current) throw new Error("The returned current-device cookie must authenticate.");
    for (const old of [fixture.person, fixture.secondDevice]) {
      expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: old.cookie }, query: { disableCookieCache: true } })).toBeNull();
    }
    expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: fixture.other.cookie }, query: { disableCookieCache: true } })).not.toBeNull();
    const after = await readOwnProfileState(fixture);
    const beforeCredential = before.hub.credentials.find((row) => row.userId === fixture.person.loginId && row.providerId === "credential");
    const afterCredential = after.hub.credentials.find((row) => row.userId === fixture.person.loginId && row.providerId === "credential");
    if (!beforeCredential || !afterCredential || !afterCredential.password) throw new Error("Own-password change must keep its native credential.");
    expect(afterCredential).toEqual({ ...beforeCredential, password: expect.any(String), updatedAt: expect.any(String) });
    expect(afterCredential.password).not.toBe(beforeCredential.password);
    const native = await fixture.signIn.identities.auth.$context;
    expect(await native.password.verify({ hash: afterCredential.password, password: validInput().newPassword })).toBe(true);
    expect(after.hub.credentials.filter((row) => row.id !== beforeCredential.id)).toEqual(before.hub.credentials.filter((row) => row.id !== beforeCredential.id));
    expect(after.hub.sessions.filter((row) => row.userId === fixture.person.loginId).map((row) => row.id)).toEqual([current.session.id]);
    expect(after.hub.sessions.filter((row) => row.userId !== fixture.person.loginId)).toEqual(before.hub.sessions.filter((row) => row.userId !== fixture.person.loginId));
    expect(after.hub.users).toEqual(before.hub.users.map((row) => row.id === fixture.person.loginId ? { ...row, authRevision: row.authRevision + 1 } : row));
    expect(after.hub.audits).toEqual(expect.arrayContaining([...before.hub.audits, expect.objectContaining({ action: "accounts_password_changed",
      actorLoginId: fixture.person.loginId, affectedLoginId: fixture.person.loginId, comment: null })]));
    expect(after.hub.audits).toHaveLength(before.hub.audits.length + 1);
    expect({ ...after, hub: { ...after.hub, users: before.hub.users, audits: before.hub.audits, credentials: before.hub.credentials, sessions: before.hub.sessions } }).toEqual(before);
    // Retained workspace rows never override the now-ended Hub sessions.
    for (const local of [currentLocal, otherDeviceLocal]) {
      expect((await localAccess(fixture.workspace, local.cookie)).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    }
    expect((await localAccess(fixture.otherWorkspace, unrelatedLocal.cookie)).isOk).toBe(true);
    const newLogin = { ...fixture.person, cookie, hubSessionId: current.session.id };
    expect((await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.workspace, login: newLogin })).response.headers.get("location"))
      .toBe(fixture.workspace.origin + "/");
    expect((await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: fixture.person.email, password: signInPassword,
    }), fixture.signIn.settings)).status).toBe(401);
    expect((await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: fixture.person.email, password: validInput().newPassword,
    }), fixture.signIn.settings)).status).toBe(200);
  });

  it.each(["Wrong-password123!", " " + signInPassword + " "])(
    "when the current password is wrong or altered (%s) then no password, session or other data changes", async (currentPassword) => {
      const before = await readOwnProfileState(fixture);
      expect((await changePassword({ ...validInput(), currentPassword },
        await preparePasswordServices({ fixture, actor: fixture.person }))).toJSON())
        .toEqual(err({ code: "accounts_current_password_invalid" }).toJSON());
      expect(await readOwnProfileState(fixture)).toEqual(before);
    },
  );

  it.each([
    { input: { newPassword: "New-pass123!" }, fields: ["currentPassword"] },
    { input: { currentPassword: "", newPassword: "New-pass123!" }, fields: ["currentPassword"] },
    { input: { currentPassword: signInPassword }, fields: ["newPassword"] },
    { input: { currentPassword: signInPassword, newPassword: "New-pass12!" }, fields: ["newPassword"] },
    { input: { currentPassword: signInPassword, newPassword: "Ab1!" + "x".repeat(61) }, fields: ["newPassword"] },
    { input: { currentPassword: signInPassword, newPassword: "lowercase123!" }, fields: ["newPassword"] },
    { input: { currentPassword: signInPassword, newPassword: "No-number-here!" }, fields: ["newPassword"] },
    { input: { currentPassword: signInPassword, newPassword: "MissingSymbol123" }, fields: ["newPassword"] },
    { input: { currentPassword: null, newPassword: "" }, fields: ["currentPassword", "newPassword"] },
  ])("when password input breaks the rules ($fields) then nothing changes", async ({ input, fields }) => {
    const before = await readOwnProfileState(fixture);
    expect((await changePassword(input, await preparePasswordServices({ fixture, actor: fixture.person }))).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it.each(["New-pass123!", "Ab1!" + "x".repeat(60)])(
    "when a valid new password is exactly 12 or 64 characters (%s) then the native hash accepts that exact password", async (newPassword) => {
      const result = await changePassword({ ...validInput(), newPassword }, await preparePasswordServices({ fixture, actor: fixture.person }));
      expect(result.isOk).toBe(true);
      const credential = (await readOwnProfileState(fixture)).hub.credentials
        .find((row) => row.userId === fixture.person.loginId && row.providerId === "credential");
      if (!credential?.password) throw new Error("The native credential must keep its password.");
      expect(await (await fixture.signIn.identities.auth.$context).password.verify({ hash: credential.password, password: newPassword })).toBe(true);
    },
  );

  it.each(["loginId", "revokeOtherSessions", "token", "isMaster"])(
    "when someone supplies the server-owned password field %s then the submission is refused", async (field) => {
      const before = await readOwnProfileState(fixture);
      expect((await changePassword({ ...validInput(), [field]: field === "revokeOtherSessions" ? false : fixture.other.loginId },
        await preparePasswordServices({ fixture, actor: fixture.person }))).toJSON()).toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
      expect(await readOwnProfileState(fixture)).toEqual(before);
    },
  );

  it("when there is no signed-in person then own-password change is refused", async () => {
    const before = await readOwnProfileState(fixture);
    expect((await changePassword(validInput(), await preparePasswordServices({ fixture, actor: null }))).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it("when the Hub session has ended then its retained cookie cannot change a password", async () => {
    await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.person.cookie } });
    const before = await readOwnProfileState(fixture);
    expect((await changePassword(validInput(), await preparePasswordServices({ fixture, actor: fixture.person }))).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it("when the session ends after the shared access check then native authentication still refuses the password change", async () => {
    const services = await preparePasswordServices({ fixture, actor: fixture.person });
    await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.person.cookie } });
    const before = await readOwnProfileState(fixture);
    expect((await changePassword(validInput(), services)).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it("when the native credential write fails then the safe error reflects ended sessions without claiming a password change", async () => {
    await sql`create trigger test_refuse_own_password before update of password on account
      begin select raise(abort, 'private_password_database_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const services = await preparePasswordServices({ fixture, actor: fixture.person });
    const before = await readOwnProfileState(fixture);
    expect((await changePassword(validInput(), services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    // Native D1 calls delete sessions before updating the credential; they are not one batch.
    const after = await readOwnProfileState(fixture);
    expect(after).toEqual({ ...before, hub: { ...before.hub,
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.person.loginId) } });
    expect(log.mock.calls.length).toBeGreaterThan(0);
    for (const call of log.mock.calls) {
      expect(call).toHaveLength(1);
      expect(JSON.parse(String(call[0]))).toEqual({ event: "core_unexpected_error", requestId: expect.any(String), app: "hub", operation: expect.stringMatching(/^(accounts_native_auth|accounts_change_password)$/) });
    }
  });

  it("when the login is suspended then even the correct current password grants no access", async () => {
    await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user").set({ banned: 1 }).where("id", "=", fixture.person.loginId).compile()]);
    const before = await readOwnProfileState(fixture);
    expect((await changePassword(validInput(), await preparePasswordServices({ fixture, actor: fixture.person }))).toJSON())
      .toEqual(err({ code: "core_login_inactive" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });
});

function validInput() { return { currentPassword: signInPassword, newPassword: "Changed-password789!" }; }

async function localAccess(workspace: OwnProfileFixture["workspace"], cookie: string) {
  return await withWorkspace(workspace, async ({ storage }) => await getCurrentUser(
    new Request(workspace.origin + "/protected", { headers: { cookie } }),
    workspaceServices({ fixture: fixture.signIn, workspace, storage }, handleHubAuthRequest),
  ));
}
