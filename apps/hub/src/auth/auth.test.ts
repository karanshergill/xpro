import { env } from "cloudflare:workers";
import { verifyPassword } from "better-auth/crypto";
import { signInAtHub } from "#test/hub-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHubDatabase, createHubMigrator } from "#db/hub.db.ts";
import { createHubAuth } from "./auth.server";

type HubAuth = Awaited<ReturnType<typeof createHubAuth>>;
type HubDatabase = Awaited<ReturnType<typeof createHubDatabase>>;
type Login = { id: string; email: string; username: string; name: string };
const hubOrigin = "https://hub.example.test";
const authBaseUrl = `${hubOrigin}/api/auth`;
const testPassword = "Test-password123!";
const maxSessionLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
let auth: HubAuth;
let db: HubDatabase;

// These tests use the application migrations from T008, never a substitute schema.
beforeEach(async () => {
  db = await createHubDatabase(env.DB);
  const migrated = await createHubMigrator(db).migrateToLatest();
  expect(migrated.error).toBeUndefined();
  auth = await createHubAuth({
    database: env.DB,
    baseURL: hubOrigin,
    secret: `xpro-auth-test-${crypto.randomUUID()}`,
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await db.destroy();
});

describe("Hub authentication", () => {
  it("when public sign-up requests a privileged role then HTTP and direct sign-up are refused without changing existing records", async () => {
    await createLogin();
    const before = await readIdentityState();
    const body = {
      ...makeIdentity(),
      password: testPassword,
      role: "admin",
    };
    const response = await requestAuth("/sign-up/email", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(404);
    await expect(auth.api.signUpEmail({ body })).rejects.toMatchObject({
      statusCode: 400,
      body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" },
    });
    expect(await readIdentityState()).toEqual(before);
  });

  it.each(["anonymous", "master", "workspace owner"] as const)("when %s calls unused native HTTP routes then every request is refused without changing records", async (actor) => {
    await createLogin();
    let cookie = "";
    if (actor !== "anonymous") {
      // Better Auth's global admin is an xpro master; organization roles are separate.
      const login = await createLogin({ role: actor === "master" ? "admin" : undefined });
      if (actor === "workspace owner") await createOrganization(login);
      cookie = await signIn(login);
    }
    const before = await readIdentityState();
    for (const path of blockedPostPaths) {
      const response = await requestAuth(path, {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({}),
      });
      expect(response.status, `${actor}: POST ${path}`).toBe(404);
    }
    for (const path of blockedGetPaths) {
      const response = await requestAuth(path, { headers: { cookie } });
      expect(response.status, `${actor}: GET ${path}`).toBe(404);
    }
    expect(await readIdentityState()).toEqual(before);
  });

  it.each([
    { identifier: "email", path: "/sign-in/email" },
    { identifier: "username", path: "/sign-in/username" },
  ] as const)("when a prepared login signs in with $identifier then HTTP creates a secure non-master session", async ({ identifier, path }) => {
    const login = await createLogin();
    const response = await requestAuth(path, {
      method: "POST",
      body: JSON.stringify({ [identifier]: login[identifier], password: testPassword }),
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/;\s*Secure(?:;|$)/i);
      expect(cookie).toMatch(/;\s*HttpOnly(?:;|$)/i);
    }
    const session = await auth.api.getSession({ headers: { cookie: readCookie(response) } });
    expect(session?.user).toMatchObject({ id: login.id, email: login.email, role: "user" });
  });

  it.each([
    { identifier: "email", path: "/sign-in/email" },
    { identifier: "username", path: "/sign-in/username" },
  ] as const)("when a $identifier password is wrong then HTTP refuses sign-in and creates no session", async ({ identifier, path }) => {
    const login = await createLogin();
    const before = await readIdentityState();
    const response = await requestAuth(path, {
      method: "POST",
      body: JSON.stringify({ [identifier]: login[identifier], password: "Wrong-password123!" }),
    });
    expect(response.status).toBe(401);
    expect(await readIdentityState()).toEqual(before);
  });

  it("when trusted creation saves equal passwords then their distinct hashes verify with Better Auth's default hasher", async () => {
    await createLogin();
    await createLogin();
    const credentials = await db.selectFrom("account").select("password").execute();
    expect(credentials).toHaveLength(2);
    expect(new Set(credentials.map((credential) => credential.password)).size).toBe(2);
    for (const credential of credentials) {
      if (typeof credential.password !== "string") throw new Error("The credential must contain its password hash.");
      expect(await verifyPassword({ hash: credential.password, password: testPassword })).toBe(true);
      expect(await verifyPassword({ hash: credential.password, password: "Wrong-password123!" })).toBe(false);
    }
  });

  it.each([
    { role: "owner", canCreate: true },
    { role: "admin", canCreate: true },
    { role: "member", canCreate: false },
  ] as const)("when a workspace $role is checked then member creation follows its fixed role and the login stays non-master", async ({ role, canCreate }) => {
    const owner = await createLogin();
    const organizationId = await createOrganization(owner);
    const login = await createLogin();
    await auth.api.addMember({ body: { userId: login.id, organizationId, role } });
    const headers = { cookie: await signIn(login) };
    expect(await auth.api.hasPermission({
      headers,
      body: { organizationId, permissions: { member: ["create"] } },
    })).toEqual({ error: null, success: canCreate });
    expect((await auth.api.getSession({ headers }))?.user.role).toBe("user");
  });

  it("when a master uses the trusted creation API then it creates a non-master login without workspace membership", async () => {
    const master = await createLogin({ role: "admin" });
    const headers = { cookie: await signIn(master) };
    const login = await createLogin({ headers });
    expect(await db.selectFrom("member").selectAll().execute()).toEqual([]);
    const session = await auth.api.getSession({ headers: { cookie: await signIn(login) } });
    expect(session?.user).toMatchObject({ id: login.id, role: "user" });
  });

  it("when a workspace admin calls the global creation API then it is refused and existing records stay unchanged", async () => {
    const owner = await createLogin();
    const organizationId = await createOrganization(owner);
    const admin = await createLogin();
    await auth.api.addMember({ body: { userId: admin.id, organizationId, role: "admin" } });
    const headers = { cookie: await signIn(admin) };
    const before = await readIdentityState();
    await expect(createLogin({ headers })).rejects.toMatchObject({ statusCode: 403 });
    expect(await readIdentityState()).toEqual(before);
  });

  it("when a session reaches its original expiry then it ends within 30 days even after earlier use", async () => {
    const login = await createLogin();
    const signedInAt = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(signedInAt);
    const cookie = await signIn(login);
    const headers = { cookie };
    const initial = await auth.api.getSession({ headers });
    if (!initial) throw new Error("A successful sign-in must return its active session.");
    const deadline = initial.session.expiresAt.getTime();
    expect(deadline).toBeGreaterThan(signedInAt);
    expect(deadline).toBeLessThanOrEqual(signedInAt + maxSessionLifetimeMs);
    vi.setSystemTime(deadline - 1);
    const active = await auth.api.getSession({ headers });
    expect(active?.user.id).toBe(login.id);
    expect(active?.session.expiresAt.getTime()).toBe(deadline);
    // Better Auth refuses a session once the current time is past its stored expiry.
    vi.setSystemTime(deadline + 1);
    const expired = await requestAuth("/get-session", { headers });
    expect(expired.status).toBe(200);
    expect(await expired.json()).toBeNull();
  });

  it("when one device signs out then its old cookie is refused immediately while another device stays signed in", async () => {
    const login = await createLogin();
    const firstCookie = await signIn(login);
    const secondCookie = await signIn(login);
    expect(firstCookie).not.toBe(secondCookie);
    expect((await auth.api.getSession({ headers: { cookie: secondCookie } }))?.user.id).toBe(login.id);
    const signedOut = await requestAuth("/sign-out", { method: "POST", headers: { cookie: secondCookie } });
    expect(signedOut.status).toBe(200);
    const refused = await requestAuth("/get-session", { headers: { cookie: secondCookie } });
    expect(refused.status).toBe(200);
    expect(await refused.json()).toBeNull();
    expect((await auth.api.getSession({ headers: { cookie: firstCookie } }))?.user.id).toBe(login.id);
  });

  it("when an untrusted origin attempts sign-out then the request is refused and the session remains valid", async () => {
    const login = await createLogin();
    const cookie = await signIn(login);
    const response = await requestAuth("/sign-out", {
      method: "POST",
      headers: { cookie, origin: "https://outside.example.test" },
    });
    expect(response.status).toBe(403);
    expect((await auth.api.getSession({ headers: { cookie } }))?.user.id).toBe(login.id);
  });

  it("when workspace clients discover the provider then only authorization-code login is advertised and public signing keys are available", async () => {
    const response = await requestAuth("/.well-known/openid-configuration");
    expect(response.status).toBe(200);
    const metadata = await response.json();
    expect(metadata).toMatchObject({
      issuer: authBaseUrl,
      authorization_endpoint: `${authBaseUrl}/oauth2/authorize`,
      token_endpoint: `${authBaseUrl}/oauth2/token`,
      userinfo_endpoint: `${authBaseUrl}/oauth2/userinfo`,
      jwks_uri: `${authBaseUrl}/jwks`,
      grant_types_supported: ["authorization_code"],
      response_types_supported: ["code"],
    });
    expect(metadata).not.toHaveProperty("registration_endpoint");
    const keys = await requestAuth("/jwks");
    expect(keys.status).toBe(200);
    expect(await keys.json()).toMatchObject({
      keys: expect.arrayContaining([expect.objectContaining({ kid: expect.any(String), kty: expect.any(String) })]),
    });
  });
});

async function requestAuth(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("origin", headers.get("origin") ?? hubOrigin);
  headers.set("content-type", "application/json");
  return await auth.handler(new Request(`${authBaseUrl}${path}`, { ...init, headers }));
}

async function createLogin(options: { role?: "admin"; headers?: HeadersInit } = {}): Promise<Login> {
  const identity = makeIdentity();
  const created = await auth.api.createUser({
    headers: options.headers,
    body: {
      email: identity.email,
      name: identity.name,
      password: testPassword,
      data: { username: identity.username },
      role: options.role,
    },
  });
  return { ...identity, id: created.user.id };
}

async function createOrganization(owner: Login): Promise<string> {
  const organization = await auth.api.createOrganization({
    body: { name: "Test workspace", slug: `workspace-${crypto.randomUUID()}`, userId: owner.id },
  });
  if (!organization) throw new Error("Trusted workspace setup must return its organization.");
  return organization.id;
}

async function signIn(login: Login): Promise<string> {
  return await signInAtHub({ handle: auth.handler, origin: hubOrigin, email: login.email, password: testPassword });
}

function readCookie(response: Response): string {
  const cookies = response.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function makeIdentity() {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  return { email: `login-${suffix}@example.test`, username: `u${suffix.slice(0, 7)}`, name: "Test User" };
}

async function readIdentityState() {
  return {
    users: await db.selectFrom("user").selectAll().orderBy("id").execute(),
    credentials: await db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await db.selectFrom("session").selectAll().orderBy("id").execute(),
    organizations: await db.selectFrom("organization").selectAll().orderBy("id").execute(),
    members: await db.selectFrom("member").selectAll().orderBy("id").execute(),
    invitations: await db.selectFrom("invitation").selectAll().orderBy("id").execute(),
    verifications: await db.selectFrom("verification").selectAll().orderBy("id").execute(),
    auditEntries: await db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}

const blockedPostPaths = [
  "/sign-up/email", "/sign-in/social", "/update-user", "/update-session",
  "/change-email", "/change-password", "/set-password", "/delete-user",
  "/request-password-reset", "/reset-password", "/send-verification-email",
  "/link-social", "/unlink-account", "/get-access-token", "/refresh-token",
  "/admin/create-user", "/admin/update-user", "/admin/set-role", "/admin/set-user-password",
  "/admin/ban-user", "/admin/unban-user", "/admin/remove-user",
  "/admin/impersonate-user", "/admin/stop-impersonating",
  "/admin/revoke-user-session", "/admin/revoke-user-sessions",
  "/admin/list-user-sessions",
  "/organization/create", "/organization/update", "/organization/delete", "/organization/set-active",
  "/organization/add-member", "/organization/remove-member", "/organization/update-member-role", "/organization/leave",
  "/organization/invite-member", "/organization/accept-invitation", "/organization/reject-invitation", "/organization/cancel-invitation",
  "/organization/create-team", "/organization/update-team", "/organization/remove-team",
  "/organization/set-active-team", "/organization/add-team-member", "/organization/remove-team-member",
  "/organization/create-role", "/organization/update-role", "/organization/delete-role",
  "/oauth2/register", "/oauth2/create-client", "/oauth2/update-client", "/oauth2/delete-client",
  "/oauth2/client/rotate-secret", "/oauth2/client/rotate-keys",
  "/admin/oauth2/create-client", "/admin/oauth2/update-client",
];
const blockedGetPaths = [
  "/delete-user/callback", "/verify-email", "/token",
  "/admin/list-users", "/admin/get-user",
  "/organization/get-invitation", "/organization/list-invitations", "/organization/list-user-invitations",
];
