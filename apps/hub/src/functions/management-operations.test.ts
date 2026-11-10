import { env } from "cloudflare:workers";
import { pageLoginIdHeader } from "@xpro/core";
import { saveHub } from "@xpro/core/server";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import type { SignedInLogin } from "#test/hub-identities";
import { createEnrolledMaster, createMfaFixture } from "#test/master-mfa";
import type { EnrolledMaster, MfaFixture } from "#test/master-mfa";
import { readHubState } from "#test/sign-in";
import { handleGetManagementOperation } from "./management-operations.server";

let fixture: MfaFixture;
let master: EnrolledMaster;
let holder: SignedInLogin;
let settings: HubAuthSettings;
let accountId: string;
let recordedId: string;
let absentId: string;

beforeEach(async () => {
  fixture = await createMfaFixture(env.DB);
  master = await createEnrolledMaster(fixture);
  holder = await fixture.identities.signIn();
  const secret = fixture.auth.options.secret;
  if (typeof secret !== "string") throw new Error("The native fixture requires its signing secret.");
  settings = { database: env.DB, baseURL: fixture.origin, secret, rateLimiter: fixture.rateLimiter };
  accountId = crypto.randomUUID(); recordedId = crypto.randomUUID(); absentId = crypto.randomUUID();
  const now = new Date().toISOString();
  await saveHub(env.DB, [fixture.identities.db.insertInto("accounts").values({
    id: accountId, ownerLoginId: holder.loginId, name: "Private submitted account label",
    nameSearch: "private submitted account label", createdAt: now, updatedAt: now,
  }).compile()]);
  await seedAudit(recordedId, auditDetails());
});
afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("management operation HTTP status", () => {
  it("returns only recorded or absent status without changing native state", async () => {
    const before = await state();
    for (const [operationId, expected] of [
      [recordedId, { status: "recorded", result: receipt() }],
      [absentId, { status: "not_recorded" }],
    ] as const) {
      const response = await submit({ operationId }, { headers: { "x-request-id": "untrusted-diagnostic" } });
      expect(response.status).toBe(200); checkHeaders(response);
      expect(response.headers.get("x-request-id")).not.toBe("untrusted-diagnostic");
      expect(await response.json()).toEqual(expected);
    }
    expect(await state()).toEqual(before);
  });

  it("requires the strict operation UUID and never treats diagnostic or authority input as proof", async () => {
    const before = await state();
    const cases: { input: unknown; fields: string[] }[] = [
      { input: null, fields: [] },
      { input: { operationId: "not-a-uuid" }, fields: ["operationId"] },
      { input: { requestId: recordedId }, fields: ["operationId"] },
      { input: { operationId: recordedId, requestId: crypto.randomUUID() }, fields: [] },
      { input: { operationId: recordedId, loginId: master.loginId, hubSessionId: master.hubSessionId,
        isMaster: true, private_unknown_field: "must-not-be-echoed" }, fields: [] },
    ];
    for (const { input, fields } of cases) await failure(await submit(input), 400, "core_invalid_input", fields);
    expect(await state()).toEqual(before);
  });

  it("allows only exact-Origin POST, including when GET targets an existing SSR login page", async () => {
    const before = await state();
    const cases: RequestOptions[] = [
      { method: "GET", path: "/stms/logins" },
      { omitOrigin: true }, { headers: { origin: "https://foreign.invalid" } },
      { base: "https://foreign.invalid" },
    ];
    for (const options of cases) await failure(await submit({ operationId: recordedId }, options), 403, "core_forbidden");
    expect(await state()).toEqual(before);
  });

  it("does not disclose present or absent status to anonymous, actual account-holder or native tenant-admin actors", async () => {
    const tenantAdmin = await fixture.identities.signIn();
    const organization = await fixture.identities.auth.api.createOrganization({ body: {
      name: "Native tenant", slug: "operation-tenant-" + crypto.randomUUID(), userId: holder.loginId,
    } });
    if (!organization) throw new Error("The native tenant fixture must exist.");
    await fixture.identities.auth.api.addMember({ body: {
      userId: tenantAdmin.loginId, organizationId: organization.id, role: "admin",
    } });
    const before = await state();
    for (const actor of [null, holder, tenantAdmin]) {
      for (const operationId of [recordedId, absentId]) {
        await failure(await submit({ operationId }, { actor, headers: {
          "x-login-id": master.loginId, "x-is-master": "true",
        } }), actor === null ? 401 : 403, actor === null ? "core_unauthenticated" : "core_forbidden");
      }
    }
    expect(await state()).toEqual(before);
  });

  it.each(["expired", "ended", "stale revision"] as const)("refuses an actual master session that is %s for either key", async (kind) => {
    if (kind === "ended") await fixture.auth.api.signOut({ headers: { cookie: master.cookie } });
    else await saveHub(env.DB, [(kind === "expired"
      ? sql`update session set "expiresAt" = '2000-01-01T00:00:00.000Z' where id = ${master.hubSessionId}`
      : sql`update user set auth_revision = auth_revision + 1 where id = ${master.loginId}`).compile(fixture.identities.db)]);
    const before = await state();
    for (const operationId of [recordedId, absentId]) {
      await failure(await submit({ operationId }, { headers: { "x-login-id": master.loginId, "x-is-master": "true" } }),
        401, "core_unauthenticated");
    }
    // Native get-session removes expired sessions; no business/audit state may change.
    expect(await state()).toEqual(kind === "expired" ? { ...before, hub: { ...before.hub,
      sessions: before.hub.sessions.filter((row) => row.id !== master.hubSessionId),
    } } : before);
  });

  it("refuses the previous page actor after a genuine switch to another current master", async () => {
    const current = await createEnrolledMaster(fixture), before = await state();
    for (const operationId of [recordedId, absentId]) {
      await failure(await submit({ operationId }, { actor: current, headers: { [pageLoginIdHeader]: master.loginId } }),
        409, "core_identity_changed");
    }
    expect(await state()).toEqual(before);
  });

  it("lets another current native master recover without rewriting the original actor or audit", async () => {
    const current = await createEnrolledMaster(fixture);
    await fixture.auth.api.signOut({ headers: { cookie: master.cookie } });
    const before = await state();
    const response = await submit({ operationId: recordedId }, { actor: current, headers: { [pageLoginIdHeader]: current.loginId } });
    expect(response.status).toBe(200); checkHeaders(response);
    expect(await response.json()).toEqual({ status: "recorded", result: receipt() });
    expect(await state()).toEqual(before);
    expect(before.hub.audits.find((row) => row.id === recordedId)?.actorLoginId).toBe(master.loginId);
  });

  it.each(["recorded", "absent"] as const)("rechecks native authority at the actual joined %s read after request authorization", async (kind) => {
    let afterSignOut: Awaited<ReturnType<typeof state>> | undefined;
    const database = beforeOperationRead(env.DB, async () => {
      await fixture.auth.api.signOut({ headers: { cookie: master.cookie } });
      afterSignOut = await state();
    });
    const response = await submit({ operationId: kind === "recorded" ? recordedId : absentId }, {}, database);
    await failure(response, 401, "core_unauthenticated");
    expect(afterSignOut).toBeDefined();
    expect(await state()).toEqual(afterSignOut);
  });

  it("reports an actual D1 read failure once and never returns false absent status or native error details", async () => {
    const before = await state(), reports = captureReports();
    const database = beforeOperationRead(env.DB, async () => {
      // A real native storage error; no session, authority or result row is substituted.
      await env.DB.prepare('select * from "private_operation_storage_failure"').all();
    });
    const response = await submit({ operationId: recordedId }, {}, database);
    const text = await failure(response, 500, "core_unexpected_error");
    expect(text).not.toContain("private_operation_storage_failure");
    expect(reports).toEqual(expectedReport(response));
    expect(await state()).toEqual(before);
  });

  it("fails safely and reports once when an actual immutable audit contains a corrupt receipt", async () => {
    const corruptId = crypto.randomUUID();
    await seedAudit(corruptId, { ...auditDetails(), result: { ...receipt(), clientSecret: "private_corrupt_receipt" } });
    const before = await state(), reports = captureReports();
    const response = await submit({ operationId: corruptId });
    const text = await failure(response, 500, "core_unexpected_error");
    expect(text).not.toContain("private_corrupt_receipt");
    expect(reports).toEqual(expectedReport(response));
    expect(await state()).toEqual(before);
  });
});

function receipt() { return { action: "stms_account_created" as const, accountId }; }
function auditDetails() { return { version: 1, fingerprint: "a".repeat(64), result: receipt() }; }
async function seedAudit(operationId: string, details: unknown): Promise<void> {
  await saveHub(env.DB, [fixture.identities.db.insertInto("auditEntries").values({
    id: operationId, action: "stms_account_created", outcome: "success", actorLoginId: master.loginId,
    affectedLoginId: null, reason: null, comment: null, accountId, workspaceId: null,
    requestId: crypto.randomUUID(), createdAt: new Date().toISOString(), details: JSON.stringify(details),
  }).compile()]);
}

type RequestOptions = {
  actor?: SignedInLogin | null; headers?: HeadersInit; method?: string; base?: string; path?: string; omitOrigin?: boolean;
};
function makeRequest(options: RequestOptions = {}): Request {
  const actor = options.actor === undefined ? master : options.actor;
  const headers = new Headers({ origin: fixture.origin, "content-type": "application/json", ...(actor ? { cookie: actor.cookie } : {}) });
  for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  if (options.omitOrigin) headers.delete("origin");
  const method = options.method ?? "POST";
  return new Request((options.base ?? fixture.origin) + (options.path ?? "/_serverFn/management-operation"), {
    method, headers, ...(method === "POST" ? { body: "{}" } : {}),
  });
}
async function submit(input: unknown, options: RequestOptions = {}, database = env.DB): Promise<Response> {
  return await handleGetManagementOperation(input, { request: makeRequest(options), settings: { ...settings, database } });
}
function checkHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
}
async function failure(response: Response, status: number, code: string, fields?: string[]): Promise<string> {
  expect(response.status).toBe(status); checkHeaders(response);
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({ code, message: expect.any(String), requestId: response.headers.get("x-request-id"),
    ...(fields === undefined ? {} : { fields }) });
  return text;
}
function captureReports(): unknown[][] {
  const reports: unknown[][] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { reports.push(args); });
  return reports;
}
function expectedReport(response: Response): string[][] {
  return [[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"),
    app: "hub", operation: "stms_get_management_operation" })]];
}
async function state() {
  const db = fixture.identities.db;
  return { hub: await readHubState(fixture.identities),
    managementWorkspaces: await db.selectFrom("workspaces").selectAll().orderBy("id").execute(),
    workspaceCreations: await db.selectFrom("workspaceCreations").selectAll().orderBy("id").execute(),
    placements: await db.selectFrom("workspacePlacements").selectAll().orderBy("id").execute(),
    addresses: await db.selectFrom("workspaceAddresses").selectAll().orderBy("id").execute(),
    verification: await db.selectFrom("verification").selectAll().orderBy("id").execute(),
    factors: await db.withoutPlugins().selectFrom("twoFactor").selectAll().orderBy("id").execute() };
}

// A rendezvous at the real D1 terminal read, after native request authorization.
// Table recognition selects the seam, not a SQL/source-string assertion. All returned rows remain native.
function beforeOperationRead(database: D1Database, before: () => Promise<void>): D1Database {
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
      return /\baudit_entries\b/i.test(query) ? wrap(statement) : statement;
    };
    return bound(target, key);
  } });
}
function bound(target: object, key: PropertyKey): unknown {
  const value: unknown = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
}
