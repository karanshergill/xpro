import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedInLogin } from "#test/hub-identities";
import { createResetFixture, readResetState, signInAfterReset, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { hubRequest, readCookies, signInPassword } from "#test/sign-in";
import { handleUpdateProfile, handleChangePassword } from "./profile.server";

type Action = { name: string; handle: typeof handleUpdateProfile; input(): Record<string, unknown> };
const profileAction: Action = { name: "profile", handle: handleUpdateProfile, input: profileInput };
const passwordAction: Action = { name: "password", handle: handleChangePassword, input: passwordInput };
let fixture: ResetFixture;
beforeEach(async () => { fixture = await createResetFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe.each([profileAction, passwordAction])("authenticated Hub own-$name action", (action) => {
  it.each(["anonymous", "tampered cookie", "ended session"] as const)(
    "when identity is only %s then submitted authority cannot change anything", async (state) => {
      if (state === "ended session") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.target.cookie } });
      const before = await readResetState(fixture);
      const response = await submit(action, {
        actor: state === "anonymous" ? null : fixture.target,
        headers: state === "tampered cookie" ? { cookie: fixture.target.cookie + "tampered" }
          : { "x-login-id": fixture.master.loginId, "x-is-master": "true", "x-request-id": "untrusted-request-id" },
      });
      await expectFailure(response, { status: 401, code: "core_unauthenticated", message: "Sign in to continue." });
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it.each(["suspended", "archived", "incomplete profile", "incomplete creation"] as const)(
    "when live access is %s then the action cannot bypass the Hub gate", async (state) => {
      const db = fixture.signIn.identities.db;
      if (state === "incomplete creation") {
        const id = crypto.randomUUID();
        await saveHub(env.DB, [db.insertInto("loginCreations").values({ id, creatorLoginId: fixture.master.loginId,
          createdLoginId: fixture.target.loginId, organizationId: null, kind: null, details: "{}",
          createdAt: new Date().toISOString(), completedAt: null }).compile(),
          db.updateTable("user").set({ loginCreationId: id }).where("id", "=", fixture.target.loginId).compile()]);
      } else await saveHub(env.DB, [db.updateTable("user").set(state === "suspended" ? { banned: 1 }
        : state === "archived" ? { archivedAt: new Date().toISOString() } : { phone: null }).where("id", "=", fixture.target.loginId).compile()]);
      const before = await readResetState(fixture);
      await expectFailure(await submit(action), state === "incomplete profile"
        ? { status: 403, code: "core_profile_incomplete", message: "Complete the required profile details.", fields: ["phone"] }
        : state === "incomplete creation"
          ? { status: 403, code: "core_creation_incomplete", message: "This login is not ready to use yet." }
          : { status: 403, code: "core_login_inactive", message: "This login is not active." });
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it.each(["GET", "foreign Origin", "missing Origin", "foreign address"] as const)(
    "when the request uses %s then it is refused before saving", async (state) => {
      const before = await readResetState(fixture);
      const response = await submit(action, {
        ...(state === "GET" ? { method: "GET" } : {}),
        ...(state === "foreign Origin" ? { headers: { origin: "https://foreign.example.test" } } : {}),
        ...(state === "missing Origin" ? { shouldOmitOrigin: true } : {}),
        ...(state === "foreign address" ? { requestOrigin: "https://foreign.example.test" } : {}),
      });
      await expectFailure(response, { status: 403, code: "core_forbidden", message: "You do not have permission to do this." });
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it("when a request submits another login and a role then only safe field errors are returned and no records change", async () => {
    const before = await readResetState(fixture);
    const response = await submit(action, { input: { ...action.input(), loginId: fixture.other.loginId, role: "admin" } });
    await expectFailure(response, { status: 400, code: "core_invalid_input", message: "Check the submitted details.", fields: [] });
    expect(await readResetState(fixture)).toEqual(before);
  });
});

describe("own-profile and password HTTP results", () => {
  it("when a person saves their profile then only their ID is returned with a fresh request ID and the normalized details persist", async () => {
    const before = await readResetState(fixture);
    const response = await submit(profileAction);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loginId: fixture.target.loginId });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("set-cookie")).toBeNull();
    const after = await readResetState(fixture);
    expect(after.hub.users.find((row) => row.id === fixture.target.loginId)).toEqual({
      ...before.hub.users.find((row) => row.id === fixture.target.loginId), name: "Updated person", nameSearch: "updated person", phone: "+442079460018", updatedAt: expect.any(String),
    });
    expect(after.hub.users.filter((row) => row.id !== fixture.target.loginId)).toEqual(before.hub.users.filter((row) => row.id !== fixture.target.loginId));
    expect({ ...after, hub: { ...after.hub, users: before.hub.users } }).toEqual(before);
  });

  it("when a master changes their own password then the actual replacement cookie authenticates and no token or user record appears in JSON", async () => {
    const before = await readResetState(fixture);
    const response = await submit(passwordAction, { actor: fixture.master, headers: { "x-request-id": "untrusted-request-id" } });
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({ loginId: fixture.master.loginId });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const cookie = readCookies(response);
    expect(cookie).not.toBe("");
    const session = await fixture.signIn.identities.auth.api.getSession({ headers: { cookie }, query: { disableCookieCache: true } });
    expect(session?.user.id).toBe(fixture.master.loginId);
    expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: fixture.master.cookie }, query: { disableCookieCache: true } })).toBeNull();
    const after = await readResetState(fixture);
    expect(after.hub.credentials.filter((row) => row.userId !== fixture.master.loginId)).toEqual(before.hub.credentials.filter((row) => row.userId !== fixture.master.loginId));
    expect(after.hub.sessions.filter((row) => row.userId !== fixture.master.loginId)).toEqual(before.hub.sessions.filter((row) => row.userId !== fixture.master.loginId));
    expect(after.hub.users).toEqual(before.hub.users.map((row) => row.id === fixture.master.loginId ? { ...row, authRevision: row.authRevision + 1 } : row));
    expect(after.hub.audits.filter((row) => row.requestId === response.headers.get("x-request-id"))).toEqual([
      expect.objectContaining({ action: "accounts_password_changed", actorLoginId: fixture.master.loginId, affectedLoginId: fixture.master.loginId, comment: null }),
    ]);
    expect(after.hub.audits).toHaveLength(before.hub.audits.length + 1);
    expect({ ...after, hub: { ...after.hub, users: before.hub.users, audits: before.hub.audits, credentials: before.hub.credentials, sessions: before.hub.sessions } }).toEqual(before);
  });

  it("when the current password is wrong then HTTP returns a named refusal with no cookie and all records remain unchanged", async () => {
    const before = await readResetState(fixture);
    await expectFailure(await submit(passwordAction, { input: { ...passwordInput(), currentPassword: "Wrong-password123!" } }), {
      status: 400, code: "accounts_current_password_invalid", message: "The current password is incorrect.",
    });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when both profile fields are invalid then the response lists their names without submitted values", async () => {
    const before = await readResetState(fixture);
    await expectFailure(await submit(profileAction, { input: { name: "", phone: { country: "GB", number: "private-invalid-number" } } }), {
      status: 400, code: "core_invalid_input", message: "Check the submitted details.", fields: ["name", "phone"],
    });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when both password fields are invalid then the response contains no submitted password", async () => {
    const before = await readResetState(fixture);
    await expectFailure(await submit(passwordAction, { input: { currentPassword: "", newPassword: "private-invalid-password" } }), {
      status: 400, code: "core_invalid_input", message: "Check the submitted details.", fields: ["currentPassword", "newPassword"],
    });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the profile write fails then both old details stay and one safe error uses the HTTP request ID", async () => {
    await sql`create trigger test_refuse_http_profile before update of name, phone on user
      begin select raise(abort, 'private_http_profile_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await readResetState(fixture);
    const response = await submit(profileAction);
    await expectFailure(response, { status: 500, code: "core_unexpected_error", message: "Something went wrong. Please try again." });
    expect(await readResetState(fixture)).toEqual(before);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_update_profile" })]]);
  });

  it.each(["session deletion", "credential update", "replacement creation"] as const)(
    "when native %s fails then no success cookie escapes and one safe error reports the native save limit", async (stage) => {
      const table = stage === "credential update" ? "account" : "session";
      const operation = stage === "session deletion" ? "delete" : stage === "credential update" ? "update of password" : "insert";
      await sql`create trigger test_refuse_http_password before ${sql.raw(operation)} on ${sql.id(table)}
        begin select raise(abort, 'private_http_password_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const before = await readResetState(fixture);
      const response = await submit(passwordAction);
      await expectFailure(response, { status: 500, code: "core_unexpected_error", message: "Something went wrong. Please try again." });
      const after = await readResetState(fixture);
      const expectedSessions = stage === "session deletion" ? before.hub.sessions : before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId);
      expect(after.hub.sessions).toEqual(expectedSessions);
      expect(after.hub.credentials.filter((row) => row.userId !== fixture.target.loginId)).toEqual(before.hub.credentials.filter((row) => row.userId !== fixture.target.loginId));
      expect(after.hub.users).toEqual(before.hub.users.map((row) => stage === "replacement creation" && row.id === fixture.target.loginId
        ? { ...row, authRevision: row.authRevision + 1 } : row));
      expect(after.hub.audits).toEqual(stage === "replacement creation" ? [...before.hub.audits, expect.objectContaining({
        action: "accounts_password_changed", actorLoginId: fixture.target.loginId, affectedLoginId: fixture.target.loginId,
        comment: null, requestId: response.headers.get("x-request-id"),
      })] : before.hub.audits);
      expect({ ...after, hub: { ...after.hub, users: before.hub.users, audits: before.hub.audits,
        credentials: before.hub.credentials, sessions: before.hub.sessions } }).toEqual(before);
      const credential = after.hub.credentials.find((row) => row.userId === fixture.target.loginId && row.providerId === "credential");
      if (!credential?.password) throw new Error("The failure must preserve a native credential.");
      expect(await (await fixture.signIn.identities.auth.$context).password.verify({ hash: credential.password,
        password: stage === "replacement creation" ? passwordInput().newPassword : signInPassword })).toBe(true);
      expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "core_hub_function_request" })]]);
    },
  );

  it("when the native credential is absent then own-password change cannot create one without proving a current password", async () => {
    await saveHub(env.DB, [fixture.signIn.identities.db.withoutPlugins().deleteFrom("account")
      .where("userId", "=", fixture.target.loginId).where("providerId", "=", "credential").compile()]);
    const before = await readResetState(fixture);
    await expectFailure(await submit(passwordAction), { status: 400, code: "accounts_current_password_invalid", message: "The current password is incorrect." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when own-password change ends sessions then the actual issued target token loses user-info access and another login's token still works", async () => {
    const target = await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
    const other = await signInWithResetToken({ fixture, workspace: fixture.otherWorkspace, login: fixture.other });
    const before = await readResetTokens(fixture);
    expect((await userInfo(target.accessToken)).status).toBe(200);
    expect((await userInfo(other.accessToken)).status).toBe(200);
    const response = await submit(passwordAction);
    expect(response.status).toBe(200);
    const after = await readResetTokens(fixture);
    expect(after.access.filter((row) => row.userId === fixture.target.loginId)).toEqual(before.access.filter((row) => row.userId === fixture.target.loginId)
      .map((row) => ({ ...row, sessionId: null, revoked: expect.any(String) })));
    expect(after.access.filter((row) => row.userId !== fixture.target.loginId)).toEqual(before.access.filter((row) => row.userId !== fixture.target.loginId));
    expect((await userInfo(target.accessToken)).status).toBe(401);
    expect((await userInfo(other.accessToken)).status).toBe(200);
    expect((await signInAfterReset({ fixture, login: fixture.target, password: passwordInput().newPassword })).response.status).toBe(200);
  });
});

function profileInput() { return { name: " Updated person ", phone: { country: "GB", number: "020 7946 0018" } }; }
function passwordInput() { return { currentPassword: signInPassword, newPassword: "Changed-password789!" }; }

async function submit(action: Action, options: {
  input?: unknown; actor?: SignedInLogin | null; headers?: HeadersInit; method?: string; shouldOmitOrigin?: boolean; requestOrigin?: string;
} = {}): Promise<Response> {
  const actor = options.actor === undefined ? fixture.target : options.actor;
  const value = options.input ?? action.input();
  const request = hubRequest("/_serverFn/own-" + action.name, value, actor?.cookie);
  const headers = new Headers(request.headers);
  for (const [name, content] of new Headers(options.headers)) headers.set(name, content);
  if (options.shouldOmitOrigin) headers.delete("origin");
  return await action.handle(value, { request: new Request((options.requestOrigin ?? "https://hub.example.test") + "/_serverFn/own-" + action.name,
    { method: options.method ?? "POST", headers }), settings: fixture.signIn.settings });
}

async function expectFailure(response: Response, expected: { status: number; code: string; message: string; fields?: string[] }): Promise<void> {
  const { status, ...body } = expected;
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(await response.json()).toEqual({ ...body, requestId: response.headers.get("x-request-id") });
}

async function userInfo(accessToken: string): Promise<Response> {
  return await handleHubAuthRequest(new Request("https://hub.example.test/api/auth/oauth2/userinfo", {
    headers: { authorization: "Bearer " + accessToken },
  }), fixture.signIn.settings);
}
