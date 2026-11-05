import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { createSignInFixture, hubRequest, prepareDestination, readCookies, readHubState, signInPassword,
  type DestinationAction, type SignInFixture } from "#test/sign-in";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSignInDestination as resolveDestination } from "./sign-in.server";

// T018 supplies this product routing action; Better Auth continues to handle credentials.
const getSignInDestination: DestinationAction = resolveDestination;
let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); });

describe("Story 2 — central sign-in", () => {
  it.each(["email", "username"] as const)("when a person signs in with their %s then a native device session and one safe audit are created", async (method) => {
    const login = await fixture.identities.createLogin();
    const user = await fixture.identities.db.selectFrom("user").selectAll().where("id", "=", login.loginId).executeTakeFirstOrThrow();
    const before = await readHubState(fixture.identities);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/" + method, {
      [method]: method === "email" ? `  ${login.email.toUpperCase()}  ` : user.username, password: signInPassword,
    }), fixture.settings);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie().some((cookie) => /; Secure/i.test(cookie) && /; HttpOnly/i.test(cookie))).toBe(true);
    const native = await fixture.identities.auth.api.getSession({ headers: { cookie: readCookies(response) } });
    if (!native) throw new Error("Native sign-in did not issue a session.");
    expect(native.user.id).toBe(login.loginId);
    // Keep Better Auth's documented response usable by its own client.
    expect(body).toEqual({ redirect: false, token: native.session.token,
      user: JSON.parse(JSON.stringify(native.user)) });
    const after = await readHubState(fixture.identities);
    expect(after).toEqual({ ...before,
      sessions: [expect.objectContaining({ id: native.session.id, userId: login.loginId })],
      audits: [signInAudit(response, { outcome: "success", actorLoginId: login.loginId, affectedLoginId: login.loginId, reason: null })],
    });
  });

  it.each([
    { method: "email", isKnown: false }, { method: "email", isKnown: true },
    { method: "username", isKnown: false }, { method: "username", isKnown: true },
  ] as const)("when a $method sign-in has wrong credentials (known identifier: $isKnown) then the public failure reveals no part that was wrong", async ({ method, isKnown }) => {
    const login = await fixture.identities.createLogin();
    const user = await fixture.identities.db.selectFrom("user").selectAll().where("id", "=", login.loginId).executeTakeFirstOrThrow();
    const identifier = isKnown ? (method === "email" ? login.email : user.username)
      : (method === "email" ? `missing-${crypto.randomUUID()}@example.test` : "zzzzzzzz");
    const before = await readHubState(fixture.identities);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/" + method, {
      [method]: identifier, password: isKnown ? "Wrong-password123!" : signInPassword,
    }), fixture.settings);
    await expectFailure(response, { code: "accounts_credentials_invalid", message: "Incorrect email, username or password" }, 401);
    await expectOnlyFailureAudit(before, response, "accounts_credentials_invalid");
  });

  it.each([
    { method: "email", status: "suspended" }, { method: "username", status: "suspended" },
    { method: "email", status: "archived" }, { method: "username", status: "archived" },
  ] as const)("when a $status person signs in with correct $method credentials then their approved status message is shown without issuing a session", async ({ method, status }) => {
    const login = await fixture.identities.createLogin();
    await saveHub(env.DB, [fixture.identities.db.updateTable("user")
      .set(status === "suspended" ? { banned: 1 } : { archivedAt: new Date().toISOString() }).where("id", "=", login.loginId).compile()]);
    const user = await fixture.identities.db.selectFrom("user").selectAll().where("id", "=", login.loginId).executeTakeFirstOrThrow();
    const before = await readHubState(fixture.identities);
    const code = status === "suspended" ? "accounts_login_suspended" : "accounts_login_archived";
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/" + method, {
      [method]: method === "email" ? login.email : user.username, password: signInPassword,
    }), fixture.settings);
    await expectFailure(response, { code, message: status === "suspended"
      ? "This account is suspended. Please contact support." : "This account is no longer active. Please contact support." }, 403);
    await expectOnlyFailureAudit(before, response, code, login.loginId);
  });

  it.each(["suspended", "archived"] as const)("when a %s login is guessed with a wrong password then its status is not disclosed", async (status) => {
    const login = await fixture.identities.createLogin();
    await saveHub(env.DB, [fixture.identities.db.updateTable("user")
      .set(status === "suspended" ? { banned: 1 } : { archivedAt: new Date().toISOString() }).where("id", "=", login.loginId).compile()]);
    const before = await readHubState(fixture.identities);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: login.email, password: "Wrong-password123!",
    }), fixture.settings);
    await expectFailure(response, { code: "accounts_credentials_invalid", message: "Incorrect email, username or password" }, 401);
    await expectOnlyFailureAudit(before, response, "accounts_credentials_invalid");
  });

  it.each(["email", "username"] as const)("when the platform's sign-in limit refuses a %s attempt then no session is issued and the approved limit message is returned", async (method) => {
    const login = await fixture.identities.createLogin();
    const user = await fixture.identities.db.selectFrom("user").selectAll().where("id", "=", login.loginId).executeTakeFirstOrThrow();
    const before = await readHubState(fixture.identities);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/" + method, {
      [method]: method === "email" ? login.email : user.username, password: signInPassword,
    }), { ...fixture.settings, rateLimiter: { async limit() { return { success: false }; } } });
    await expectFailure(response, { code: "accounts_sign_in_limited", message: "Too many attempts. Please try again shortly." }, 429);
    await expectOnlyFailureAudit(before, response, "accounts_sign_in_limited");
  });

  it("when a person signs in on two devices and signs out of one then only that native device session ends", async () => {
    const login = await fixture.identities.createLogin();
    const first = await fixture.signIn(login, handleHubAuthRequest);
    const second = await fixture.signIn(login, handleHubAuthRequest);
    expect(first.hubSessionId).not.toBe(second.hubSessionId);
    const before = await readHubState(fixture.identities);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-out", {}, first.cookie), fixture.settings);
    expect(response.status).toBe(200);
    expect(await fixture.identities.auth.api.getSession({ headers: { cookie: first.cookie } })).toBeNull();
    expect((await fixture.identities.auth.api.getSession({ headers: { cookie: second.cookie } }))?.session.id).toBe(second.hubSessionId);
    expect(await readHubState(fixture.identities)).toEqual({
      ...before, sessions: before.sessions.filter((session) => session.id !== first.hubSessionId),
    });
  });

  it("when a visitor calls native public registration through the application entry then it still creates no login, Account or workspace", async () => {
    const before = await readHubState(fixture.identities);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-up/email", {
      email: "public@example.test", name: "Public visitor", password: signInPassword, role: "admin",
    }), fixture.settings);
    expect(response.status).toBe(404);
    expect(await readHubState(fixture.identities)).toEqual(before);
  });
});

describe("Story 2 — destination rules", () => {
  it.each(["internal", "external"] as const)("when a %s workspace user signs in then the Hub chooses their workspace and leaves app-versus-Portal routing to that workspace", async (kind) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId, kind });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    await expectDestination({}, login, { kind: "workspace", workspaceId: workspace.id });
  });

  it("when an account holder without a workspace signs in then their default is the Hub account page", async () => {
    const created = await fixture.identities.createLogin();
    await prepareAccount(created.loginId);
    await expectDestination({}, await fixture.signIn(created, handleHubAuthRequest), { kind: "account" });
  });

  it("when an account holder already has a workspace then their workspace takes precedence over the account page", async () => {
    const created = await fixture.identities.createLogin();
    await prepareAccount(created.loginId);
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    await expectDestination({}, await fixture.signIn(created, handleHubAuthRequest), { kind: "workspace", workspaceId: workspace.id });
  });

  it("when a person has no workspace, Account or master role then their default is the unassigned-workspace message", async () => {
    const created = await fixture.identities.createLogin();
    await expectDestination({}, await fixture.signIn(created, handleHubAuthRequest), { kind: "unassigned" });
  });

  it.each([false, true])("when a master signs in (membership present: %s) then their default is STMS", async (hasMembership) => {
    const created = await fixture.identities.createLogin({ role: "admin" });
    if (hasMembership) await fixture.prepareWorkspace({ loginId: created.loginId, kind: "external" });
    await expectDestination({}, await fixture.signIn(created, handleHubAuthRequest), { kind: "stms" });
  });

  it.each([
    { fallback: "workspace", requested: "unknown" }, { fallback: "workspace", requested: "forbidden" },
    { fallback: "account", requested: "unknown" }, { fallback: "account", requested: "forbidden" },
    { fallback: "stms", requested: "unknown" },
    { fallback: "unassigned", requested: "unknown" }, { fallback: "unassigned", requested: "forbidden" },
  ] as const)("when the requested workspace is $requested then the person returns to their $fallback default", async ({ fallback, requested }) => {
    const created = await fixture.identities.createLogin(fallback === "stms" ? { role: "admin" } : {});
    const ownWorkspace = fallback === "workspace" ? await fixture.prepareWorkspace({ loginId: created.loginId }) : null;
    if (fallback === "account") await prepareAccount(created.loginId);
    const other = requested === "forbidden" ? await fixture.prepareWorkspace() : null;
    const requestedWorkspaceId = other?.id ?? crypto.randomUUID();
    const destination = ownWorkspace ? { kind: "workspace" as const, workspaceId: ownWorkspace.id } : { kind: fallback };
    await expectDestination({ requestedWorkspaceId }, await fixture.signIn(created, handleHubAuthRequest), destination);
  });

  it.each(["user", "admin"] as const)("when a %s requests an allowed workspace then that request takes precedence over the default", async (role) => {
    const created = await fixture.identities.createLogin({ role });
    const workspace = await fixture.prepareWorkspace(role === "user" ? { loginId: created.loginId } : {});
    await expectDestination({ requestedWorkspaceId: workspace.id }, await fixture.signIn(created, handleHubAuthRequest), {
      kind: "workspace", workspaceId: workspace.id,
    });
  });

  it.each(["user", "admin"] as const)("when a %s has an unfinished profile then routing cannot bypass completion", async (role) => {
    const created = await fixture.identities.createLogin({ role, username: null, name: "", phone: null });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const before = await readHubState(fixture.identities);
    expect((await getSignInDestination({}, await prepareDestination(login))).toJSON()).toEqual(
      err({ code: "core_profile_incomplete", fields: ["username", "name", "phone"] }).toJSON());
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it.each(["anonymous", "ended"] as const)("when the session is %s then destination lookup grants no access", async (state) => {
    const created = await fixture.identities.createLogin();
    const login = state === "ended" ? await fixture.signIn(created, handleHubAuthRequest) : null;
    if (login) await fixture.identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    const before = await readHubState(fixture.identities);
    expect((await getSignInDestination({}, await prepareDestination(login))).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when the caller submits a master flag or another login ID then destination lookup refuses those claims", async () => {
    const created = await fixture.identities.createLogin();
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const before = await readHubState(fixture.identities);
    expect((await getSignInDestination({ loginId: crypto.randomUUID(), isMaster: true }, await prepareDestination(login))).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
    expect(await readHubState(fixture.identities)).toEqual(before);
  });
});

async function prepareAccount(loginId: string): Promise<void> {
  await saveHub(env.DB, [fixture.identities.db.insertInto("accounts")
    .values({ id: crypto.randomUUID(), ownerLoginId: loginId, createdAt: new Date().toISOString() }).compile()]);
}

async function expectDestination(input: unknown, login: Awaited<ReturnType<SignInFixture["signIn"]>>, destination: unknown): Promise<void> {
  const before = await readHubState(fixture.identities);
  expect((await getSignInDestination(input, await prepareDestination(login))).toJSON()).toEqual(ok(destination).toJSON());
  expect(await readHubState(fixture.identities)).toEqual(before);
}

function signInAudit(response: Response, values: { outcome: string; actorLoginId: string | null; affectedLoginId: string | null; reason: string | null }) {
  return { id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    action: "accounts_sign_in", ...values, comment: null, requestId: response.headers.get("x-request-id"), createdAt: expect.any(String) };
}

async function expectFailure(response: Response, error: { code: string; message: string }, status: number): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await response.json()).toEqual({ ...error, requestId: response.headers.get("x-request-id") });
}

async function expectOnlyFailureAudit(
  before: Awaited<ReturnType<typeof readHubState>>, response: Response, reason: string, affectedLoginId: string | null = null,
): Promise<void> {
  expect(await readHubState(fixture.identities)).toEqual({ ...before, audits: [
    ...before.audits, signInAudit(response, { outcome: "refused", actorLoginId: null, affectedLoginId, reason }),
  ] });
}
