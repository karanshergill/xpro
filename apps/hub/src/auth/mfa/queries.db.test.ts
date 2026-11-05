import { env } from "cloudflare:workers";
import { createKyselyAdapter } from "@better-auth/kysely-adapter";
import { CompiledQuery } from "kysely";
import { createEnrolledMaster, createMfaFixture, type MfaFixture } from "#test/master-mfa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentMfaSource, mfaAuditClaim, mfaRevocations, readMfaSnapshot, type MfaOperation, type MfaTables } from "./phases.db";
import { guardedFactorUpdate } from "./factor-query.db";
import { createHubAuth } from "#auth/auth.server.ts";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); });

describe("native MFA query plans", () => {
  it("when guarded MFA phases read, compare or revoke access then every shared table uses an index", async () => {
    const login = await createEnrolledMaster(fixture);
    const native = await createKyselyAdapter({ database: env.DB });
    if (!native.kysely) throw new Error("Missing native database.");
    const db = native.kysely.withTables<MfaTables>();
    try {
      const snapshot = await readMfaSnapshot(db, { loginId: login.loginId, sessionId: login.hubSessionId });
      if (!snapshot?.actor || !snapshot.factor || !snapshot.user.role) throw new Error("Missing real enrolled-master state.");
      const operation: MfaOperation = { kind: "backups", userId: login.loginId, role: snapshot.user.role, revision: snapshot.user.auth_revision,
        enabled: true, actor: { id: snapshot.actor.id, expiresAt: snapshot.actor.expiresAt, mfaAt: snapshot.actor.mfa_verified_at },
        challenge: null, factor: snapshot.factor, phase: "running", consumed: false, auditId: crypto.randomUUID(), requestId: crypto.randomUUID() };
      const queries = [currentMfaSource(db, operation).select("id").compile(),
        mfaAuditClaim(db, { operation, action: "accounts_mfa_backup_codes_replaced" }),
        guardedFactorUpdate(db, { value: operation, where: [{ field: "id", value: snapshot.factor.id },
          { field: "backupCodes", value: snapshot.factor.backupCodes }] }).set({ backupCodes: snapshot.factor.backupCodes }).compile(),
        ...mfaRevocations(db, operation)];
      for (const query of queries) {
        const plan = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
        expect(plan.rows.filter((row) => /\bSCAN\b/.test(row.detail))).toEqual([]);
      }
    } finally { await db.destroy(); }
  });

  it("when native password rotation reads, fences and replaces access then its actual shared queries use indexes", async () => {
    const login = await createEnrolledMaster(fixture);
    const queries: { sql: string; parameters: unknown[] }[] = [];
    const database = new Proxy(env.DB, { get(target, key) {
      if (key === "prepare") return (query: string) => {
        const statement = target.prepare(query);
        return new Proxy(statement, { get(target, key) {
          if (key === "bind") return (...parameters: unknown[]) => {
            queries.push({ sql: query, parameters }); return target.bind(...parameters);
          };
          const method: unknown = Reflect.get(target, key, target);
          return typeof method === "function" ? method.bind(target) : method;
        } });
      };
      const method: unknown = Reflect.get(target, key, target);
      return typeof method === "function" ? method.bind(target) : method;
    } });
    const auth = await createHubAuth({ database, baseURL: fixture.origin, secret: fixture.auth.options.secret,
      rateLimiter: fixture.rateLimiter });
    await auth.$context;
    queries.length = 0;
    const changed = await auth.api.changePassword({ headers: { cookie: login.cookie }, body: {
      currentPassword: fixture.password, newPassword: "Indexed-password456!", revokeOtherSessions: true,
    }, asResponse: true });
    expect(changed.status).toBe(200);
    const guarded = queries.filter((query) => query.sql.includes('"auth_revision"')
      || query.sql.startsWith('update "account"') || query.sql.startsWith('delete from "session"'));
    for (const start of ['delete from "session"', 'update "account"', 'update "user"', 'delete from "verification"', 'update "session"']) {
      expect(guarded.some((query) => query.sql.startsWith(start))).toBe(true);
    }
    for (const query of guarded) {
      const plan = await fixture.identities.db.withoutPlugins().executeQuery<{ detail: string }>(
        CompiledQuery.raw("explain query plan " + query.sql, query.parameters));
      expect(plan.rows.filter((row) => /\bSCAN\b/.test(row.detail) && row.detail !== "SCAN CONSTANT ROW")).toEqual([]);
      expect(query.parameters.length).toBeLessThanOrEqual(100);
    }
  });
});
