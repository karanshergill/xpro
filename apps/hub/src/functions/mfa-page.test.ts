import { parseCookies, setRequestCookie } from "better-auth/cookies";
import { CompiledQuery } from "kysely";
import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, mfaCookie, type MfaFixture } from "#test/master-mfa";
import { handleMfaPage, validateMfaPage } from "./mfa-page.server";
import type { MfaTables } from "#auth/mfa/phases.db.ts";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("read-only MFA page", () => {
  it.each([0, 300_000, 300_001])("when verified MFA age is %s then replacement readiness follows the same exact management window", async (age) => {
    const login = await createEnrolledMaster(fixture);
    const session = await fixture.identities.db.selectFrom("session").select("mfaVerifiedAt").where("id", "=", login.hubSessionId).executeTakeFirstOrThrow();
    if (!session.mfaVerifiedAt) throw new Error("Missing native completed MFA.");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(session.mfaVerifiedAt) + age);
    const before = await state(), response = await load({ cookie: login.cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ loginId: login.loginId, step: "complete", management: age <= 300_000 ? "ready" : "recent_required" });
    expect(await state()).toEqual(before);
  });
  it.each(["setup", "pending", "verify", "complete", "ordinary"] as const)("when native authority is %s then GET, POST and repeated preload reveal only safe render state", async (step) => {
    const login = step === "verify" || step === "complete" ? await createEnrolledMaster(fixture)
      : await fixture.identities.signIn({ role: step === "ordinary" ? "user" : "admin" });
    let cookie = login.cookie;
    if (step === "pending") expect((await fixture.auth.api.enableTwoFactor({ headers: { cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
    if (step === "verify") cookie = mfaCookie(await beginMfaSignIn(fixture, login.email));
    const setupId = (await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("twoFactor").select("id").where("userId", "=", login.loginId).executeTakeFirst())?.id ?? null;
    const before = await state();
    for (const method of ["GET", "POST", "GET"]) {
      const response = await load({ cookie, method });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ loginId: login.loginId, step: step === "ordinary" ? "complete" : step, setupId, management: step === "complete" ? "ready" : "unavailable" });
      expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(await state()).toEqual(before);
  });

  it.each(["session", "challenge"] as const)("when a native %s expires then inspecting it leaves even expired rows untouched", async (kind) => {
    const login = await createEnrolledMaster(fixture);
    const pending = kind === "challenge" ? await beginMfaSignIn(fixture, login.email) : null;
    const row = kind === "session" ? await fixture.identities.db.selectFrom("session").select("expiresAt").where("id", "=", login.hubSessionId).executeTakeFirstOrThrow()
      : await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("verification").select("expiresAt").where("value", "=", login.loginId).where("auth_revision", "is not", null).executeTakeFirstOrThrow();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(row.expiresAt) + 1);
    const before = await state();
    const response = await load({ cookie: pending ? mfaCookie(pending) : login.cookie });
    expect(response.status).toBe(401); expect((await response.json() as { code: string }).code).toBe("core_unauthenticated");
    expect(await state()).toEqual(before);
  });

  it.each(["tampered", "revision", "both cookies"] as const)("when a challenge is %s then page state cannot lend it authority", async (fault) => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    if (fault === "revision") await saveHub(env.DB, [fixture.identities.db.updateTable("user").set({ authRevision: 2 }).where("id", "=", login.loginId).compile()]);
    const headers = new Headers({ cookie: fault === "tampered" ? mfaCookie(pending) + "changed" : mfaCookie(pending) });
    if (fault === "both cookies") for (const [name, value] of parseCookies(login.cookie)) setRequestCookie(headers, name, value);
    const cookie = headers.get("cookie") ?? "";
    const before = await state();
    const response = await load({ cookie });
    expect(response.status).toBe(401); expect(await state()).toEqual(before);
  });

  it("when the browser switches logins then an expected identity can only refuse the page", async () => {
    const first = await createEnrolledMaster(fixture), second = await createEnrolledMaster(fixture);
    const before = await state();
    const response = await load({ cookie: second.cookie, expected: first.loginId });
    expect(response.status).toBe(409); expect((await response.json() as { code: string }).code).toBe("core_identity_changed");
    expect(await state()).toEqual(before);
  });

  it("when a master loses MFA privileges then a same-login page cannot retain its private setup identity", async () => {
    const login = await createEnrolledMaster(fixture), operator = await createEnrolledMaster(fixture);
    await fixture.auth.api.setRole({ headers: { cookie: operator.cookie }, body: { userId: login.loginId, role: "user" } });
    const before = await state(), response = await load({ cookie: login.cookie, expected: login.loginId });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ loginId: login.loginId, step: "complete", setupId: null, management: "unavailable" });
    expect(await state()).toEqual(before);
  });

  it.each(["suspended", "archived", "creation incomplete", "stale session"] as const)("when the login becomes %s then live page reads refuse it without cleanup", async (fault) => {
    const login = await createEnrolledMaster(fixture);
    const creationId = crypto.randomUUID();
    const patch = fault === "suspended" ? { banned: 1 } : fault === "archived" ? { archivedAt: new Date().toISOString() }
      : fault === "creation incomplete" ? { loginCreationId: creationId } : { authRevision: 2 };
    await saveHub(env.DB, [
      ...(fault === "creation incomplete" ? [fixture.identities.db.insertInto("loginCreations").values({ id: creationId, creatorLoginId: login.loginId,
        createdLoginId: login.loginId, organizationId: null, kind: null, details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile()] : []),
      fixture.identities.db.updateTable("user").set(patch).where("id", "=", login.loginId).compile(),
    ]);
    const before = await state(), response = await load({ cookie: login.cookie });
    expect(response.status).toBe(fault === "stale session" ? 401 : 403);
    expect((await response.json() as { code: string }).code).toBe(fault === "stale session" ? "core_unauthenticated" : fault === "creation incomplete" ? "core_creation_incomplete" : "core_login_inactive");
    expect(await state()).toEqual(before);
  });

  it("when session and challenge page facts are read then the actual shared-table queries use indexes", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const queries: { sql: string; parameters: unknown[] }[] = [];
    const database = new Proxy(env.DB, { get(target, key) {
      if (key === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, { get(target, key) {
          if (key === "bind") return (...parameters: unknown[]) => { queries.push({ sql, parameters }); return target.bind(...parameters); };
          const value: unknown = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      const value: unknown = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    for (const cookie of [login.cookie, mfaCookie(pending)]) {
      const response = await handleMfaPage(validateMfaPage({}), { request: new Request(fixture.origin + "/mfa", { headers: { cookie } }),
        settings: { database, baseURL: fixture.origin, secret: fixture.auth.options.secret } });
      expect(response.status).toBe(200);
    }
    // The native adapter also reads SQLite's small schema catalog. Check the
    // application row queries, whose cost must not grow with shared tables.
    const reads = queries.filter((query) => query.sql.startsWith("select ") && !query.sql.includes('"sqlite_master"'));
    expect(reads).toHaveLength(3);
    for (const query of reads) {
      const plan = await fixture.identities.db.withoutPlugins().executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, query.parameters));
      expect(plan.rows.filter((row) => /\bSCAN\b/.test(row.detail)), query.sql).toEqual([]);
    }
  });

  it.each(["GET on another page", "foreign origin", "missing POST origin", "input authority"] as const)("when a read has %s then it is refused before any mutation", async (fault) => {
    const login = await fixture.identities.signIn({ role: "admin" }), before = await state();
    const response = await load({ cookie: login.cookie, ...(fault === "GET on another page" ? { path: "/other" } : {}),
      ...(fault === "foreign origin" ? { method: "POST", origin: "https://foreign.example.test" } : {}),
      ...(fault === "missing POST origin" ? { method: "POST", origin: null } : {}),
      ...(fault === "input authority" ? { input: { loginId: login.loginId, step: "complete" } } : {}),
    });
    expect(response.status).toBe(fault === "input authority" ? 400 : 403); expect(await state()).toEqual(before);
  });
});

async function load(input: { cookie: string; method?: string; path?: string; origin?: string | null; expected?: string; input?: unknown }): Promise<Response> {
  const method = input.method ?? "GET", headers = new Headers({ cookie: input.cookie });
  if (method === "POST" && input.origin !== null) headers.set("origin", input.origin ?? fixture.origin);
  if (input.expected) headers.set("x-page-login-id", input.expected);
  return await handleMfaPage(validateMfaPage(input.input ?? {}), { request: new Request(fixture.origin + (input.path ?? "/mfa"), { method, headers }),
    settings: { database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret } });
}
async function state() {
  const db = fixture.identities.db.withoutPlugins().withTables<MfaTables>();
  return { users: await db.selectFrom("user").selectAll().orderBy("id").execute(), sessions: await db.selectFrom("session").selectAll().orderBy("id").execute(),
    factors: await db.selectFrom("twoFactor").selectAll().orderBy("id").execute(), challenges: await db.selectFrom("verification").selectAll().orderBy("id").execute(),
    audits: await db.selectFrom("audit_entries").selectAll().orderBy("id").execute() };
}
