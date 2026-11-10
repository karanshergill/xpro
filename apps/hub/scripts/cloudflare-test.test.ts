import { env } from "cloudflare:workers";
import { createRequestContext, saveHub } from "@xpro/core/server";
import { readWorkspacePlacement, resolvePlacement } from "@xpro/stms/server";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubAuth } from "#auth/auth.server.ts";
import { createHubDatabase, createHubMigrator } from "#db/hub.db.ts";
import { prepareCloudflareTest, publishCloudflareTestPlacement } from "./cloudflare-test.db";
import { CLOUDFLARE_TEST_TARGET, parseCloudflareTestInput,
  parseCloudflareTestReceipt, type CloudflareTestInput, type CloudflareTestReceipt } from "./cloudflare-test-settings";

type HubDatabase = Awaited<ReturnType<typeof createHubDatabase>>;
let db: HubDatabase;
let input: CloudflareTestInput;
const settings = (): { database: D1Database; context: ReturnType<typeof createRequestContext> } => ({ database: env.DB, context: createRequestContext() });

beforeEach(async () => {
  db = await createHubDatabase(env.DB);
  input = { ...CLOUDFLARE_TEST_TARGET, email: `hosted-${crypto.randomUUID()}@example.test`, password: " Hosted-test123! ",
    hubSecret: crypto.randomUUID(), workspaceSessionSecret: crypto.randomUUID(),
    turnstileSiteKey: "test-only-site-key", turnstileSecretKey: "test-only-turnstile-secret" };
});
afterEach(async () => { await db.destroy(); });

describe("private Cloudflare test preparation", () => {
  it("when the test Hub is empty then setup creates native credentials and one bare workspace without publishing its address", async () => {
    const prepared = await prepare();
    expect(prepared.receipt).toEqual({ ...CLOUDFLARE_TEST_TARGET, loginId: expect.any(String), workspaceId: expect.any(String), clientId: expect.any(String) });
    expect(await db.selectFrom("user").select(["id", "email", "role", "name", "username", "phone"]).execute()).toEqual([
      { id: prepared.receipt.loginId, email: input.email, role: "admin", name: "", username: null, phone: null },
    ]);
    expect(await db.selectFrom("organization").selectAll().execute()).toEqual([
      { id: prepared.receipt.workspaceId, name: "xpro test workspace", slug: "xpro-test", logo: null, metadata: null, createdAt: expect.any(String) },
    ]);
    expect(await db.selectFrom("member").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("accounts").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("loginCreations").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("session").selectAll().execute()).toEqual([]);
    expect(await resolvePlacement(env.DB, input.workspaceOrigin)).toBeNull();
    expect(await readWorkspacePlacement(env.DB, prepared.receipt.workspaceId)).toBeNull();
    const audit = await db.selectFrom("auditEntries").selectAll().orderBy("id").execute();
    expect(audit.map((entry) => entry.action)).toEqual(["stms_initial_master_created", "stms_test_workspace_prepared"]);
    expect(audit[1]).toEqual({ id: expect.any(String), action: "stms_test_workspace_prepared", outcome: "success",
      actorLoginId: prepared.receipt.loginId, affectedLoginId: null, reason: null, comment: null,
      accountId: null, workspaceId: null, details: null,
      requestId: expect.any(String), createdAt: expect.any(String) });
    for (const value of [input.email, input.password, input.hubSecret, input.workspaceSessionSecret, input.turnstileSecretKey, prepared.clientSecret]) {
      expect(JSON.stringify(audit)).not.toContain(value);
      expect(JSON.stringify(prepared.receipt)).not.toContain(value);
    }
    const auth = await createHubAuth({ database: env.DB, baseURL: input.hubOrigin, secret: input.hubSecret });
    const signIn = await auth.api.signInEmail({ body: { email: input.email, password: input.password }, asResponse: true });
    expect(signIn.status).toBe(200);
    const headers = { cookie: signIn.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ") };
    expect((await auth.api.getSession({ headers }))?.user.id).toBe(prepared.receipt.loginId);
    const client = await auth.api.getOAuthClient({ headers, query: { client_id: prepared.receipt.clientId } });
    expect(client).toMatchObject({ client_id: prepared.receipt.clientId,
      redirect_uris: [input.workspaceOrigin + "/auth/callback"], backchannel_logout_uri: input.workspaceOrigin + "/auth/back-channel-sign-out",
      backchannel_logout_session_required: true, token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code"],
      response_types: ["code"], scope: "openid profile email", require_pkce: true, skip_consent: true, enable_end_session: true });
    await auth.api.signOut({ headers });
    for (const [secret, expectedError] of [[prepared.clientSecret, "invalid_grant"], ["incorrect-client-secret", "invalid_client"]]) {
      const token = await auth.handler(new Request(input.hubOrigin + "/api/auth/oauth2/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded",
          authorization: "Basic " + btoa(prepared.receipt.clientId + ":" + secret) },
        body: new URLSearchParams({ grant_type: "authorization_code", code: "missing-authorization-code",
          redirect_uri: input.workspaceOrigin + "/auth/callback", code_verifier: "v".repeat(43) }),
      }));
      expect(await token.json()).toMatchObject({ error: expectedError });
    }
    for (const path of ["/sign-up/email", "/organization/create", "/oauth2/register", "/admin/oauth2/create-client"]) {
      const response = await auth.handler(new Request(input.hubOrigin + "/api/auth" + path, {
        method: "POST", headers: { origin: input.hubOrigin, "content-type": "application/json" }, body: "{}",
      }));
      expect(response.status).toBe(404);
    }
  });

  it("when setup is repeated with different credentials then it refuses and every prepared record remains unchanged", async () => {
    await prepare();
    const before = await readState();
    expect(await prepareCloudflareTest(settings(), { ...input, email: "different@example.test", password: "Different-test123!" }))
      .toEqual({ status: "existing_logins" });
    expect(await readState()).toEqual(before);
  });

  it("when any ordinary login already exists then it is never promoted or replaced", async () => {
    await migrate();
    const auth = await createHubAuth({ database: env.DB, baseURL: input.hubOrigin, secret: input.hubSecret });
    await auth.api.createUser({ body: { email: input.email, password: input.password, name: "Existing user" } });
    const before = await readState();
    expect(await prepareCloudflareTest(settings(), input)).toEqual({ status: "existing_logins" });
    expect(await readState()).toEqual(before);
  });

  it.each([
    { accountId: "other-account" }, { databaseId: crypto.randomUUID() },
    { hubOrigin: "https://hub.example.test" }, { workspaceOrigin: "https://workspace.example.test" },
    { hubSecret: "short" }, { workspaceSessionSecret: "short" }, { password: "too-short" },
    { email: "invalid" }, { turnstileSiteKey: "" }, { turnstileSecretKey: "" }, { role: "admin" },
  ])("when operator input contains an invalid target or credential then setup refuses before creating the schema", async (change) => {
    await expect(prepareCloudflareTest(settings(), { ...input, ...change })).rejects.toThrow("Invalid test setup input or target.");
    const tables = await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name = 'user'`.execute(db);
    expect(tables.rows).toEqual([]);
  });

  it("when workspace auditing fails then the organization is rolled back and repeating setup preserves the initial master", async () => {
    await migrate();
    await sql`create trigger test_setup_workspace_audit before insert on audit_entries
      when new.action = 'stms_test_workspace_prepared' begin select raise(abort, 'test_setup_audit_refused'); end`.execute(db);
    await expect(prepareCloudflareTest(settings(), input)).rejects.toThrow();
    expect(await db.selectFrom("organization").selectAll().execute()).toEqual([]);
    expect(await db.selectFrom("user").select("role").execute()).toEqual([{ role: "admin" }]);
    expect(await clients()).toEqual([]);
    const before = await readState();
    expect(await prepareCloudflareTest(settings(), input)).toEqual({ status: "existing_logins" });
    expect(await readState()).toEqual(before);
  });

  it("when native client registration fails then the private setup session is revoked and a repeat never repairs the partial setup", async () => {
    await migrate();
    await sql`create trigger test_setup_client before insert on "oauthClient"
      begin select raise(abort, 'test_setup_client_refused'); end`.execute(db);
    await expect(prepareCloudflareTest(settings(), input)).rejects.toThrow();
    expect(await db.selectFrom("session").selectAll().execute()).toEqual([]);
    expect(await clients()).toEqual([]);
    expect(await db.selectFrom("member").selectAll().execute()).toEqual([]);
    const before = await readState();
    expect(await prepareCloudflareTest(settings(), input)).toEqual({ status: "existing_logins" });
    expect(await readState()).toEqual(before);
  });
});

describe("separate test placement publication", () => {
  it("when deployment has been checked then publication creates one resolvable address and its audit together", async () => {
    const { receipt } = await prepare();
    const identitiesBefore = await readState();
    expect(await publishCloudflareTestPlacement(settings(), receipt)).toEqual({ status: "published" });
    expect(await resolvePlacement(env.DB, receipt.workspaceOrigin)).toEqual({
      workspaceId: receipt.workspaceId, workerName: "xpro-test", origin: receipt.workspaceOrigin,
    });
    expect(await readWorkspacePlacement(env.DB, receipt.workspaceId)).toEqual({
      workspaceId: receipt.workspaceId, workerName: "xpro-test", origin: receipt.workspaceOrigin,
    });
    const after = await readState();
    expect({ ...after, placements: [], addresses: [], audit: identitiesBefore.audit }).toEqual(identitiesBefore);
    expect(after.audit.at(-1)).toMatchObject({ action: "stms_test_workspace_published", actorLoginId: receipt.loginId, outcome: "success" });
    const beforeRepeat = await readState();
    expect(await publishCloudflareTestPlacement(settings(), receipt)).toEqual({ status: "existing_placement" });
    expect(await readState()).toEqual(beforeRepeat);
  });

  it("when publication auditing fails then neither the placement nor its address is committed", async () => {
    const { receipt } = await prepare();
    await sql`create trigger test_publish_audit before insert on audit_entries
      when new.action = 'stms_test_workspace_published' begin select raise(abort, 'test_publish_audit_refused'); end`.execute(db);
    const before = await readState();
    await expect(publishCloudflareTestPlacement(settings(), receipt)).rejects.toThrow();
    expect(await readState()).toEqual(before);
    expect(await resolvePlacement(env.DB, receipt.workspaceOrigin)).toBeNull();
  });

  it.each(["worker", "address"] as const)("when another workspace already uses the test %s then publication preserves both workspaces", async (collision) => {
    const { receipt } = await prepare();
    const auth = await createHubAuth({ database: env.DB, baseURL: input.hubOrigin, secret: input.hubSecret });
    const { user } = await auth.api.createUser({ body: { email: `other-${crypto.randomUUID()}@example.test`, name: "Other workspace owner" } });
    const other = await auth.api.createOrganization({ body: { name: "Other workspace", slug: "other-" + crypto.randomUUID(), userId: user.id } });
    const placementId = crypto.randomUUID(), createdAt = new Date().toISOString();
    await saveHub(env.DB, [
      db.insertInto("workspacePlacements").values({ id: placementId, organizationId: other.id,
        workerName: collision === "worker" ? "xpro-test" : "xpro-other-test", createdAt }).compile(),
      db.insertInto("workspaceAddresses").values({ id: crypto.randomUUID(), workspacePlacementId: placementId,
        origin: collision === "address" ? input.workspaceOrigin : "https://other.example.test", isPrimary: 1, createdAt }).compile(),
    ]);
    const before = await readState();
    expect(await publishCloudflareTestPlacement(settings(), receipt)).toEqual({ status: "existing_placement" });
    expect(await readState()).toEqual(before);
    expect(await readWorkspacePlacement(env.DB, receipt.workspaceId)).toBeNull();
  });

  it.each(["loginId", "workspaceId", "clientId"] as const)("when a receipt names an unknown %s then publication changes nothing", async (field) => {
    const { receipt } = await prepare();
    const before = await readState();
    await expect(publishCloudflareTestPlacement(settings(), { ...receipt, [field]: crypto.randomUUID() })).rejects.toThrow();
    expect(await readState()).toEqual(before);
  });

  it("when a receipt targets another origin then publication refuses before writing", async () => {
    const { receipt } = await prepare();
    const before = await readState();
    await expect(publishCloudflareTestPlacement(settings(), { ...receipt, workspaceOrigin: "https://elsewhere.test" })).rejects.toThrow();
    expect(await readState()).toEqual(before);
  });
});

describe("operator input privacy", () => {
  it("when email needs normalization then password and secrets are preserved exactly", () => {
    expect(parseCloudflareTestInput({ ...input, email: ` ${input.email.toUpperCase()} ` })).toEqual(input);
  });
  it("when a receipt includes a secret or a target override then it is rejected without echoing values", () => {
    const receipt: CloudflareTestReceipt = { ...CLOUDFLARE_TEST_TARGET, loginId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), clientId: "native-client" };
    expect(() => parseCloudflareTestReceipt({ ...receipt, password: input.password })).toThrow("Invalid test setup receipt or target.");
    expect(() => parseCloudflareTestReceipt({ ...receipt, databaseId: "other" })).toThrow("Invalid test setup receipt or target.");
  });
});

async function prepare() {
  const prepared = await prepareCloudflareTest(settings(), input);
  if (prepared.status !== "prepared") throw new Error("The empty test database did not prepare.");
  return prepared;
}

async function migrate(): Promise<void> {
  const result = await createHubMigrator(db).migrateToLatest();
  if (result.error) throw result.error;
}

async function clients() {
  return (await sql`select * from "oauthClient" order by id`.execute(db.withoutPlugins())).rows;
}

async function readState() {
  return { users: await db.selectFrom("user").selectAll().orderBy("id").execute(),
    credentials: await db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await db.selectFrom("session").selectAll().orderBy("id").execute(),
    organizations: await db.selectFrom("organization").selectAll().orderBy("id").execute(),
    members: await db.selectFrom("member").selectAll().orderBy("id").execute(),
    accounts: await db.selectFrom("accounts").selectAll().orderBy("id").execute(),
    placements: await db.selectFrom("workspacePlacements").selectAll().orderBy("id").execute(),
    addresses: await db.selectFrom("workspaceAddresses").selectAll().orderBy("id").execute(),
    audit: await db.selectFrom("auditEntries").selectAll().orderBy("id").execute(), clients: await clients() };
}
