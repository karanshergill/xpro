import { env } from "cloudflare:workers";
import { verifyPassword } from "better-auth/crypto";
import { sql } from "kysely";
import { signInAtHub } from "#test/hub-auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubAuth } from "#auth/auth.server.ts";
import { createInitialMaster } from "#auth/initial-master.db.ts";
import { createHubDatabase, createHubMigrator } from "#db/hub.db.ts";

type HubDatabase = Awaited<ReturnType<typeof createHubDatabase>>;
const origin = "https://hub.example.test";
const password = "Setup-password123!";
let db: HubDatabase;
let settings: { database: D1Database; baseURL: string; secret: string };

beforeEach(async () => {
  db = await createHubDatabase(env.DB);
  const migrated = await createHubMigrator(db).migrateToLatest();
  expect(migrated.error).toBeUndefined();
  settings = { database: env.DB, baseURL: origin, secret: `setup-test-${crypto.randomUUID()}` };
});

afterEach(async () => { await db.destroy(); });

describe("initial master setup", () => {
  it("when the Hub is empty then only the selected login becomes a master and its supplied password signs in", async () => {
    const email = makeEmail();
    const result = await createInitialMaster(settings, { email: ` ${email.toUpperCase()} `, password });
    const users = await db.selectFrom("user").selectAll().execute();
    expect(users).toHaveLength(1);
    expect(result).toEqual({ status: "created", loginId: users[0]?.id });
    expect(users[0]).toMatchObject({ email, name: "", username: null, phone: null, role: "admin", loginCreationId: null });
    const credentials = await db.selectFrom("account").selectAll().execute();
    expect(credentials).toHaveLength(1);
    expect(credentials[0]).toMatchObject({ userId: users[0]?.id, providerId: "credential" });
    const hash = credentials[0]?.password;
    expect(typeof hash).toBe("string");
    expect(hash).not.toBe(password);
    if (typeof hash !== "string") throw new Error("The initial master has no password hash.");
    expect(await verifyPassword({ hash, password })).toBe(true);
    expect(await db.selectFrom("member").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("accounts").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("loginCreations").selectAll().execute()).toEqual([]);
    const audit = await db.selectFrom("auditEntries").selectAll().execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toEqual({
      id: expect.any(String), action: "stms_initial_master_created", outcome: "success",
      actorLoginId: null, affectedLoginId: users[0]?.id, reason: null, comment: null,
      requestId: expect.any(String), createdAt: expect.any(String),
    });
    expect(JSON.stringify(audit)).not.toContain(password);
    expect(JSON.stringify(audit)).not.toContain(email);

    const auth = await createHubAuth(settings);
    const cookie = await signInAtHub({ handle: auth.handler, origin, email, password });
    expect((await auth.api.getSession({ headers: { cookie } }))?.user).toMatchObject({ id: users[0]?.id, role: "admin" });
  });

  it("when setup repeats with a changed password or a different email then every existing login and session stays unchanged", async () => {
    const email = makeEmail();
    await createInitialMaster(settings, { email, password });
    const auth = await createHubAuth(settings);
    const cookie = await signInAtHub({ handle: auth.handler, origin, email, password });
    const before = await readIdentityState();
    for (const suppliedEmail of [email, ` ${email.toUpperCase()} `, makeEmail()]) {
      expect(await createInitialMaster(settings, { email: suppliedEmail, password: "Different-password456!" }))
        .toEqual({ status: "existing_logins" });
      expect(await readIdentityState()).toEqual(before);
    }
    expect((await auth.api.getSession({ headers: { cookie } }))?.user.role).toBe("admin");
    await signInAtHub({ handle: auth.handler, origin, email, password });
    const refused = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Different-password456!" }),
    }));
    expect(refused.status).toBe(401);
  });

  it("when an ordinary login already exists then setup neither promotes it nor creates a different master", async () => {
    const email = makeEmail();
    const auth = await createHubAuth(settings);
    await auth.api.createUser({ body: { email, name: "Existing person", password } });
    const cookie = await signInAtHub({ handle: auth.handler, origin, email, password });
    const before = await readIdentityState();
    for (const suppliedEmail of [email, makeEmail()]) {
      expect(await createInitialMaster(settings, { email: suppliedEmail, password: "Different-password456!" }))
        .toEqual({ status: "existing_logins" });
      expect(await readIdentityState()).toEqual(before);
    }
    expect((await auth.api.getSession({ headers: { cookie } }))?.user.role).toBe("user");
  });

  it.each([
    { label: "missing input", input: undefined }, { label: "null", input: null },
    { label: "array", input: [] }, { label: "empty object", input: {} },
    { label: "missing password", input: { email: makeEmail() } }, { label: "missing email", input: { password } },
    { label: "empty email", input: { email: "", password } }, { label: "invalid email", input: { email: "not-an-email", password } },
    { label: "non-string email", input: { email: 42, password } }, { label: "non-string password", input: { email: makeEmail(), password: 42 } },
    { label: "unexpected role", input: { email: makeEmail(), password, role: "admin" } },
  ])("when explicit credentials contain $label then nothing is created", async ({ input }) => {
    const before = await readIdentityState();
    const result = await createInitialMaster(settings, input);
    expect(result.status).toBe("invalid_input");
    expect(JSON.stringify(result)).not.toContain(password);
    expect(await readIdentityState()).toEqual(before);
  });

  it.each([
    "", "Ab1!short", "a".repeat(65) + "A1!", "nocapital123!", "NoDigitsHere!", "NoSymbols123", "Whitespace123 ",
    "Passwordé12345", "e\u0301Password123",
  ])("when a supplied password breaks the approved rules then it is refused before a login is created", async (invalidPassword) => {
    expect(await createInitialMaster(settings, { email: makeEmail(), password: invalidPassword }))
      .toEqual({ status: "invalid_input", fields: ["password"] });
    expect(await readIdentityState()).toEqual({ users: [], credentials: [], sessions: [], members: [], accounts: [], creations: [], audit: [] });
  });

  it.each([12, 64])("when the password has exactly %i characters and satisfies the other rules then setup accepts it unchanged", async (length) => {
    const suppliedPassword = `A1!${"a".repeat(length - 4)} `;
    const email = makeEmail();
    expect((await createInitialMaster(settings, { email, password: suppliedPassword })).status).toBe("created");
    const auth = await createHubAuth(settings);
    await signInAtHub({ handle: auth.handler, origin, email, password: suppliedPassword });
  });

  it.each(["Äbcdefghij1!", "Passwordabc٢!", "PasswordA1😀"])("when a password uses Unicode capitals, digits or symbols then the supplied value signs in unchanged", async (suppliedPassword) => {
    const email = makeEmail();
    expect((await createInitialMaster(settings, { email, password: suppliedPassword })).status).toBe("created");
    const auth = await createHubAuth(settings);
    await signInAtHub({ handle: auth.handler, origin, email, password: suppliedPassword });
  });

  it("when native credential creation fails then setup reports failure and repeating it does not alter the partial login", async () => {
    const email = makeEmail();
    await sql`create trigger initial_master_test_refuse_password before insert on account
      begin select raise(abort, 'initial_master_test_password_refused'); end`.execute(db);
    await expect(createInitialMaster(settings, { email, password })).rejects.toThrow();
    const before = await readIdentityState();
    expect(before.users).toHaveLength(1);
    expect(before.credentials).toEqual([]);
    expect(before.audit).toEqual([]);
    await sql`drop trigger initial_master_test_refuse_password`.execute(db);
    expect(await createInitialMaster(settings, { email, password: "Different-password456!" }))
      .toEqual({ status: "existing_logins" });
    expect(await readIdentityState()).toEqual(before);
    const auth = await createHubAuth(settings);
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    }));
    expect(response.status).toBe(401);
  });

  it("when creation auditing fails then setup reports failure and a repeat preserves the native login and password", async () => {
    const email = makeEmail();
    await sql`create trigger initial_master_test_refuse_audit before insert on audit_entries
      begin select raise(abort, 'initial_master_test_audit_refused'); end`.execute(db);
    await expect(createInitialMaster(settings, { email, password })).rejects.toThrow();
    const before = await readIdentityState();
    expect(before.users).toHaveLength(1);
    expect(before.credentials).toHaveLength(1);
    expect(before.audit).toEqual([]);
    await sql`drop trigger initial_master_test_refuse_audit`.execute(db);
    expect(await createInitialMaster(settings, { email, password: "Different-password456!" }))
      .toEqual({ status: "existing_logins" });
    expect(await readIdentityState()).toEqual(before);
    const auth = await createHubAuth(settings);
    await signInAtHub({ handle: auth.handler, origin, email, password });
  });

  it("when public sign-up or the native admin HTTP route requests master access then the setup path remains private", async () => {
    const before = await readIdentityState();
    const auth = await createHubAuth(settings);
    const input = { email: makeEmail(), password, name: "Untrusted", role: "admin" };
    for (const path of ["/sign-up/email", "/admin/create-user"]) {
      const response = await auth.handler(new Request(`${origin}/api/auth${path}`, {
        method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input),
      }));
      expect(response.status).toBe(404);
    }
    await expect(auth.api.signUpEmail({ body: input })).rejects.toMatchObject({
      statusCode: 400, body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" },
    });
    expect(await readIdentityState()).toEqual(before);
  });
});

function makeEmail(): string { return `setup-${crypto.randomUUID()}@example.test`; }

async function readIdentityState() {
  return {
    users: await db.selectFrom("user").selectAll().orderBy("id").execute(),
    credentials: await db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await db.selectFrom("session").selectAll().orderBy("id").execute(),
    members: await db.selectFrom("member").selectAll().orderBy("id").execute(),
    accounts: await db.selectFrom("accounts").selectAll().orderBy("id").execute(),
    creations: await db.selectFrom("loginCreations").selectAll().orderBy("id").execute(),
    audit: await db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}
