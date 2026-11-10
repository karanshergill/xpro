import { createRequestContext, saveHub } from "@xpro/core/server";
import type { AccessSession } from "@xpro/core/server";
import { createAccount, type ManagementServices } from "@xpro/stms/server";
import { sql, type Kysely, type Selectable } from "kysely";
import type { HubAuthSettings } from "../../apps/hub/src/auth/auth.server.ts";
import { createEnrolledMaster, createMfaFixture, type EnrolledMaster, type MfaFixture } from "./master-mfa";
import type { SignedInLogin } from "./hub-identities";
import { readHubState } from "./sign-in";

export type EmptyAccountFixture = MfaFixture & { database: D1Database; master: EnrolledMaster; holder: SignedInLogin; settings: HubAuthSettings };
export type AccountFixture = EmptyAccountFixture & { target: SeededAccount; other: SeededAccount };

export async function createEmptyAccountFixture(database: D1Database): Promise<EmptyAccountFixture> {
  const fixture = await createMfaFixture(database);
  try {
    const master = await createEnrolledMaster(fixture), holder = await fixture.identities.signIn();
    const secret = fixture.auth.options.secret;
    if (typeof secret !== "string") throw new Error("The native account fixture requires its signing secret.");
    const settings: HubAuthSettings = { database, baseURL: fixture.origin, secret, rateLimiter: fixture.rateLimiter };
    return { ...fixture, database, master, holder, settings };
  } catch (error) { await fixture.identities.db.destroy(); throw error; }
}
export async function createAccountFixture(database: D1Database): Promise<AccountFixture> {
  const fixture = await createEmptyAccountFixture(database);
  try {
    const target = await seedAccount(fixture, { name: "Original account" });
    target.workspaceId = await seedExistingWorkspaceAllocation(fixture, { accountId: target.accountId, ownerLoginId: target.ownerLoginId, createdAt: target.createdAt });
    const other = await seedAccount(fixture, { name: "Unrelated account" });
    other.workspaceId = await seedExistingWorkspaceAllocation(fixture, { accountId: other.accountId, ownerLoginId: other.ownerLoginId, createdAt: other.createdAt });
    return { ...fixture, target, other };
  } catch (error) { await fixture.identities.db.destroy(); throw error; }
}
export type SeededAccount = { accountId: string; ownerLoginId: string; workspaceId: string | null; createdAt: string };

export async function seedAccount(fixture: EmptyAccountFixture, input: { ownerLoginId?: string; name?: string; createdAt?: string; status?: "stms_active" | "stms_suspended" } = {}): Promise<SeededAccount> {
  const database = fixture.database;
  const ownerLoginId = input.ownerLoginId ?? await createFixtureOwner(fixture);
  const result = await createAccount({ operationId: crypto.randomUUID(), holderLoginId: ownerLoginId,
    name: input.name ?? "Fixture account" }, accountServices(fixture, { database }));
  if (result.isErr || result.value.action !== "stms_account_created") throw new Error("The real account fixture save did not succeed.");
  const accountId = result.value.accountId;
  if (input.createdAt !== undefined || input.status !== undefined) {
    // Historical timestamps are fixture state; suspension has no real action until T049.
    // shortcut: replace suspension state updates with the lifecycle save when T049 exists.
    await saveHub(database, [fixture.identities.db.updateTable("accounts").set({
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt, updatedAt: input.createdAt }),
      ...(input.status === undefined ? {} : { status: input.status }),
    }).where("id", "=", accountId).compile()]);
  }
  const saved = await fixture.identities.db.selectFrom("accounts").select("createdAt").where("id", "=", accountId).executeTakeFirstOrThrow();
  return { accountId, ownerLoginId, workspaceId: null, createdAt: saved.createdAt };
}

export async function seedRetainedNamelessAccount(fixture: EmptyAccountFixture, database: D1Database): Promise<SeededAccount> {
  const ownerLoginId = await createFixtureOwner(fixture), accountId = crypto.randomUUID(), createdAt = new Date().toISOString();
  const db = fixture.identities.db.withoutPlugins();
  const trigger = (await sql<{ sql: string }>`select sql from sqlite_master where type = 'trigger'
    and name = 'accounts_validate_insert'`.execute(db)).rows[0];
  if (!trigger) throw new Error("The real account validation trigger must exist before retained-row setup.");
  // Only a pre-feature retained row can have no label; no current save can create it.
  // Restore the exact native trigger in the same isolated fixture batch.
  await saveHub(database, [sql`drop trigger accounts_validate_insert`.compile(db),
    sql`insert into accounts (id, owner_login_id, name, name_search, status, revision, created_at, updated_at)
      values (${accountId}, ${ownerLoginId}, null, null, 'stms_active', 0, ${createdAt}, ${createdAt})`.compile(db),
    sql.raw(trigger.sql).compile(db)]);
  return { accountId, ownerLoginId, workspaceId: null, createdAt };
}
async function createFixtureOwner(fixture: EmptyAccountFixture): Promise<string> {
  // Directory/ownership-only native users need no credential hash or sign-in.
  return (await fixture.identities.auth.api.createUser({ body: {
    name: "Fixture account holder", email: `account-owner-${crypto.randomUUID()}@example.test`, role: "user",
    data: { username: `u${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}`, phone: "+12025550123" },
  } })).user.id;
}
async function seedExistingWorkspaceAllocation(fixture: EmptyAccountFixture, input: { accountId: string; ownerLoginId: string; createdAt: string }): Promise<string> {
  const database = fixture.database;
  const { accountId, ownerLoginId, createdAt } = input;
  const organization = await fixture.identities.auth.api.createOrganization({ body: {
    name: "Preserved native workspace", slug: "account-fixture-" + crypto.randomUUID(), userId: ownerLoginId,
  } });
  if (!organization) throw new Error("The native workspace fixture must exist.");
  const workspaceId = organization.id, placementId = crypto.randomUUID(), origin = `https://w-${workspaceId}.example.test`;
  const client = await fixture.auth.api.adminCreateOAuthClient({ headers: { cookie: fixture.master.cookie }, body: {
    client_name: "Preserved account fixture", redirect_uris: [origin + "/auth/callback"],
    token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code"], response_types: ["code"],
    scope: "openid profile email", require_pkce: true, skip_consent: true, enable_end_session: true, client_secret_expires_at: 0,
  } });
  // shortcut: account-only tests need pre-existing allocation state before T020;
  // replace these fixture-only links with the recorded-workspace save when T020 exists.
  await saveHub(database, [
    fixture.identities.db.insertInto("workspaces").values({ id: workspaceId, accountId, regionHint: "wnam",
      nameSearch: "preserved native workspace", createdAt, updatedAt: createdAt }).compile(),
    fixture.identities.db.insertInto("workspacePlacements").values({ id: placementId, organizationId: workspaceId,
      workerName: `xpro-${workspaceId}`, createdAt }).compile(),
    fixture.identities.db.insertInto("workspaceAddresses").values({ id: crypto.randomUUID(), workspacePlacementId: placementId,
      origin, isPrimary: 1, createdAt }).compile(),
    fixture.identities.db.insertInto("workspaceCreations").values({ id: crypto.randomUUID(), workspaceId,
      initiatorLoginId: fixture.master.loginId, attemptLoginId: fixture.master.loginId, attemptSessionId: fixture.master.hubSessionId,
      attemptRevision: 0, phase: "stms_complete", workerName: `xpro-${workspaceId}`, origin, releaseId: "account-native-fixture",
      clientId: client.client_id, credentialEnvelope: null, errorCode: null, completedAt: createdAt, createdAt, updatedAt: createdAt }).compile(),
  ]);
  return workspaceId;
}
export function accountServices(fixture: EmptyAccountFixture, input: { database?: D1Database; session?: AccessSession | null } = {}): ManagementServices {
  return { database: input.database ?? fixture.database, session: input.session === undefined ? fixture.master : input.session,
    context: createRequestContext() };
}
type NativeHubTables = EmptyAccountFixture["identities"]["db"] extends Kysely<infer Tables> ? Tables : never;
export type AccountSnapshot = {
  hub: Awaited<ReturnType<typeof readHubState>>;
  managementWorkspaces: Selectable<NativeHubTables["workspaces"]>[];
  workspaceCreations: Selectable<NativeHubTables["workspaceCreations"]>[];
  placements: Selectable<NativeHubTables["workspacePlacements"]>[];
  addresses: Selectable<NativeHubTables["workspaceAddresses"]>[];
  verification: Selectable<NativeHubTables["verification"]>[];
  factors: Selectable<NativeHubTables["twoFactor"]>[];
  clients: Record<string, unknown>[];
};
export async function readAccountState(fixture: EmptyAccountFixture): Promise<AccountSnapshot> {
  const db = fixture.identities.db;
  return { hub: await readHubState(fixture.identities),
    managementWorkspaces: await db.selectFrom("workspaces").selectAll().orderBy("id").execute(),
    workspaceCreations: await db.selectFrom("workspaceCreations").selectAll().orderBy("id").execute(),
    placements: await db.selectFrom("workspacePlacements").selectAll().orderBy("id").execute(),
    addresses: await db.selectFrom("workspaceAddresses").selectAll().orderBy("id").execute(),
    verification: await db.selectFrom("verification").selectAll().orderBy("id").execute(),
    factors: await db.withoutPlugins().selectFrom("twoFactor").selectAll().orderBy("id").execute(),
    clients: (await sql<Record<string, unknown>>`select * from "oauthClient" order by id`.execute(db.withoutPlugins())).rows };
}

// Fault/rendezvous seams preserve native auth, queries, rows and atomic batches.
export function holdAccountBatch(database: D1Database): { database: D1Database; entered: Promise<void>; release(): void } {
  let signalEntered: () => void = () => {}, signalRelease: () => void = () => {};
  const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
  const released = new Promise<void>((resolve) => { signalRelease = resolve; });
  return { database: interceptAccountBatch(database, async (commit) => {
    signalEntered(); await released; return await commit();
  }), entered, release: () => signalRelease() };
}
export function loseAccountBatchReply(database: D1Database, afterCommit: () => Promise<void>): D1Database {
  let hasInterrupted = false;
  return interceptAccountBatch(database, async (commit) => {
    const result = await commit();
    if (!hasInterrupted) { hasInterrupted = true; await afterCommit(); throw new Error("test_account_batch_reply_lost"); }
    return result;
  });
}
const accountBatchStart = /^\s*pragma\s+defer_foreign_keys\s*=\s*on\s*;?\s*$/i;
function interceptAccountBatch(database: D1Database, intercept: (commit: () => Promise<D1Result[]>) => Promise<D1Result[]>): D1Database {
  let isAccountSavePrepared = false;
  return new Proxy(database, { get(target, key) {
    if (key === "prepare") return (query: string) => {
      // Native auth may batch schema introspection before any account write.
      // Only the guarded save's deferral marker selects its following atomic batch.
      if (accountBatchStart.test(query)) isAccountSavePrepared = true;
      return target.prepare(query);
    };
    if (key === "batch") return async (statements: D1PreparedStatement[]) => {
      const isAccountSave = isAccountSavePrepared;
      isAccountSavePrepared = false;
      return isAccountSave ? await intercept(() => target.batch(statements)) : await target.batch(statements);
    };
    return bound(target, key);
  } });
}
export function beforeAccountRead(database: D1Database, before: () => Promise<void>): D1Database {
  return beforeAccountQuery({ database, matches: (query) => /\baccounts\b/i.test(query) && /\bcurrent_access\b/i.test(query), before });
}
export function beforeAccountPreparation(database: D1Database, before: () => Promise<void>): D1Database {
  return beforeAccountQuery({ database, matches: (query) => /^select\b/i.test(query) && /\baccounts\b/i.test(query) && !/\bcurrent_access\b/i.test(query), before });
}
function beforeAccountQuery({ database, matches, before }: { database: D1Database; matches(query: string): boolean; before(): Promise<void> }): D1Database {
  let entered = false;
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
      if (key === "all") return async (...args: unknown[]) => {
        if (!entered) { entered = true; await before(); }
        return await Reflect.apply(target.all, target, args);
      };
      return bound(target, key);
    } });
  }
  return new Proxy(database, { get(target, key) {
    if (key === "prepare") return (query: string) => {
      const statement = target.prepare(query);
      return matches(query) ? wrap(statement) : statement;
    };
    return bound(target, key);
  } });
}
function bound(target: object, key: PropertyKey): unknown {
  const value: unknown = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
}
