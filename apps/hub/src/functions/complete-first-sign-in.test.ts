import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import type { HubIdentities, SignedInLogin } from "#test/hub-identities";
import { createEnrolledMaster, createMfaFixture, type MfaFixture } from "#test/master-mfa";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFirstSignIn, validateFirstSignIn } from "./complete-first-sign-in.server";

let identities: HubIdentities;
let mfa: MfaFixture;
const origin = "https://hub.example.test";
beforeEach(async () => { mfa = await createMfaFixture(env.DB); identities = mfa.identities; });
afterEach(async () => { await identities.db.destroy(); vi.restoreAllMocks(); });

describe("authenticated Hub profile completion", () => {
  it.each(["user", "admin"] as const)("when a signed-in %s completes a profile then only that login is saved and the response exposes its ID", async (role) => {
    const other = await identities.signIn();
    await identities.auth.api.createOrganization({ body: { name: "Unrelated workspace", slug: `other-${crypto.randomUUID()}`, userId: other.loginId } });
    const profile = { username: null, name: "", phone: null };
    const login = role === "admin" ? await createEnrolledMaster(mfa, profile) : await identities.signIn(profile);
    const input = { username: "a-b.c_12", name: "  Completed person  ", phone: { country: "US", number: "(202) 555-0123" }, isUsernameConfirmed: true };
    const before = await readState();
    const response = await submit(input, login);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loginId: login.loginId });
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await readState()).toEqual({ ...before,
      users: before.users.map((user) => user.id === login.loginId ? {
        ...user, username: input.username, displayUsername: input.username, name: "Completed person", nameSearch: "completed person", phone: "+12025550123", updatedAt: expect.any(String),
      } : user),
      audits: [...before.audits, { id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        action: "accounts_username_set", outcome: "success", actorLoginId: login.loginId, affectedLoginId: login.loginId,
        accountId: null, workspaceId: null, details: null,
        reason: null, comment: null, requestId, createdAt: expect.any(String) }],
    });
  });

  it("when identity claims are supplied as headers without a signed cookie then they confer no access", async () => {
    const login = await identities.signIn({ username: null });
    const before = await readState();
    const response = await submit({ username: "abcd", isUsernameConfirmed: true }, null, { "x-login-id": login.loginId, "x-is-master": "true" });
    await expectError(response, { code: "core_unauthenticated", message: "Sign in to continue." }, 401);
    expect(await readState()).toEqual(before);
  });

  it("when a native cookie's signature is changed then completion refuses it", async () => {
    const login = await identities.signIn({ username: null });
    const before = await readState();
    const response = await submit({ username: "abcd", isUsernameConfirmed: true }, login, { cookie: login.cookie + "tampered" });
    await expectError(response, { code: "core_unauthenticated", message: "Sign in to continue." }, 401);
    expect(await readState()).toEqual(before);
  });

  it("when a session is revoked between requests then its previous cookie cannot complete the profile", async () => {
    const login = await identities.signIn({ username: null });
    await identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    const before = await readState();
    const response = await submit({ username: "abcd", isUsernameConfirmed: true }, login);
    await expectError(response, { code: "core_unauthenticated", message: "Sign in to continue." }, 401);
    expect(await readState()).toEqual(before);
  });

  it("when a native session has expired then its signed cookie cannot complete the profile", async () => {
    const login = await identities.signIn({ username: null });
    await saveHub(env.DB, [identities.db.withoutPlugins().updateTable("session")
      .set({ expiresAt: new Date(0).toISOString() }).where("id", "=", login.hubSessionId).compile()]);
    const before = await readState();
    await expectError(await submit({ username: "abcd", isUsernameConfirmed: true }, login),
      { code: "core_unauthenticated", message: "Sign in to continue." }, 401);
    expect(await readState()).toEqual({ ...before, sessions: before.sessions.filter((session) => session.id !== login.hubSessionId) });
  });

  it.each(["banned", "archivedAt"] as const)("when a signed-in login becomes %s then the Hub checks its current state before saving", async (field) => {
    const login = await identities.signIn({ username: null });
    await saveHub(env.DB, [identities.db.updateTable("user").set(field, field === "banned" ? 1 : new Date().toISOString()).where("id", "=", login.loginId).compile()]);
    const before = await readState();
    const response = await submit({ username: "abcd", isUsernameConfirmed: true }, login);
    await expectError(response, { code: "core_login_inactive", message: "This login is not active." }, 403);
    expect(await readState()).toEqual(before);
  });

  it("when native login creation is unfinished then the authenticated Hub function cannot finish the profile", async () => {
    const login = await identities.signIn({ username: null });
    const id = crypto.randomUUID();
    await saveHub(env.DB, [
      identities.db.insertInto("loginCreations").values({ id, creatorLoginId: login.loginId, createdLoginId: login.loginId,
        organizationId: null, kind: null, details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
      identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile(),
    ]);
    const before = await readState();
    await expectError(await submit({ username: "abcd", isUsernameConfirmed: true }, login),
      { code: "core_creation_incomplete", message: "This login is not ready to use yet." }, 403);
    expect(await readState()).toEqual(before);
  });

  it("when the submission contains another login ID or private claims then validation returns no submitted values", async () => {
    const login = await identities.signIn({ username: null });
    const before = await readState();
    const response = await submit({ username: "abcd", isUsernameConfirmed: true, loginId: "private-id", role: "admin", "private-field": "private-value" }, login);
    await expectError(response, { code: "core_invalid_input", message: "Check the submitted details.", fields: [] }, 400);
    expect(await readState()).toEqual(before);
  });

  it("when two submitted fields are invalid then the boundary returns both safe field names", async () => {
    const login = await identities.signIn({ name: "", phone: null });
    const before = await readState();
    await expectError(await submit({ name: " ", phone: { country: "ZZ", number: "private-number" } }, login),
      { code: "core_invalid_input", message: "Check the submitted details.", fields: ["name", "phone"] }, 400);
    expect(await readState()).toEqual(before);
  });

  it("when a username lacks confirmation then the Hub returns the named refusal with its request ID", async () => {
    const login = await identities.signIn({ username: null });
    const before = await readState();
    await expectError(await submit({ username: "abcd" }, login), {
      code: "accounts_username_confirmation_required", message: "Confirm your username before continuing.",
    }, 400);
    expect(await readState()).toEqual(before);
  });

  it("when the caller sends an arbitrary request ID then the audit uses the server's new ID", async () => {
    const login = await identities.signIn({ username: null });
    const suppliedId = crypto.randomUUID();
    const response = await submit({ username: "abcd", isUsernameConfirmed: true }, login, { "x-request-id": suppliedId });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).not.toBe(suppliedId);
    const audits = await identities.db.selectFrom("auditEntries").selectAll().execute();
    expect(audits).toEqual([expect.objectContaining({ requestId: response.headers.get("x-request-id"), actorLoginId: login.loginId })]);
  });

  it("when the audit fails through the authenticated boundary then the safe response, log and unchanged state agree", async () => {
    const login = await identities.signIn({ username: null });
    const before = await readState();
    await sql`create trigger test_refuse_username_audit before insert on audit_entries
      when new.action = 'accounts_username_set' begin select raise(abort, 'private-database-details'); end`.execute(identities.db.withoutPlugins());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await submit({ username: "abcd", isUsernameConfirmed: true }, login);
    await expectError(response, { code: "core_unexpected_error", message: "Something went wrong. Please try again." }, 500);
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_complete_first_sign_in" }));
    expect(await readState()).toEqual(before);
  });

  it("when native session storage fails then each request reports one safe failure without exposing the native exception", async () => {
    const login = await identities.signIn({ username: null });
    await identities.db.schema.dropTable("session").execute();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await submit({ username: "abcd", isUsernameConfirmed: true }, login);
    await expectError(response, { code: "core_unexpected_error", message: "Something went wrong. Please try again." }, 500);
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_first_sign_in_request" }));
    const repeated = await submit({ username: "abcd", isUsernameConfirmed: true }, login);
    await expectError(repeated, { code: "core_unexpected_error", message: "Something went wrong. Please try again." }, 500);
    expect(repeated.headers.get("x-request-id")).not.toBe(response.headers.get("x-request-id"));
    expect(log.mock.calls).toEqual([
      [JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_first_sign_in_request" })],
      [JSON.stringify({ event: "core_unexpected_error", requestId: repeated.headers.get("x-request-id"), app: "hub", operation: "accounts_first_sign_in_request" })],
    ]);
    expect(await identities.db.selectFrom("user").select("username").where("id", "=", login.loginId).executeTakeFirst()).toEqual({ username: null });
    expect(await identities.db.selectFrom("auditEntries").selectAll().execute()).toEqual([]);
  });
});

async function submit(input: unknown, login: SignedInLogin | null, headers: Record<string, string> = {}): Promise<Response> {
  const secret = identities.auth.options.secret;
  if (typeof secret !== "string") throw new Error("The native fixture's secret is required.");
  return await handleFirstSignIn(validateFirstSignIn(input), {
    request: new Request(origin + "/_serverFn/profile-completion", { method: "POST", headers: {
      origin, ...(login ? { cookie: login.cookie } : {}), ...headers,
    } }),
    settings: { database: env.DB, baseURL: origin, secret },
  });
}

async function expectError(response: Response, error: { code: string; message: string; fields?: string[] }, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(await response.json()).toEqual({ ...error, requestId: response.headers.get("x-request-id") });
}

async function readState() {
  return {
    users: await identities.db.selectFrom("user").selectAll().orderBy("id").execute(),
    sessions: await identities.db.selectFrom("session").selectAll().orderBy("id").execute(),
    credentials: await identities.db.selectFrom("account").selectAll().orderBy("id").execute(),
    accounts: await identities.db.selectFrom("accounts").selectAll().orderBy("id").execute(),
    workspaces: await identities.db.selectFrom("organization").selectAll().orderBy("id").execute(),
    members: await identities.db.selectFrom("member").selectAll().orderBy("id").execute(),
    reservations: await identities.db.selectFrom("reservedUsernames").selectAll().orderBy("id").execute(),
    creations: await identities.db.selectFrom("loginCreations").selectAll().orderBy("id").execute(),
    audits: await identities.db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}
