import { nameSchema, normalizeSearchText } from "@xpro/accounts";
import { env } from "cloudflare:workers";
import { createHubConnection, createRequestContext, parseInput, saveHub } from "@xpro/core/server";
import type { AccessSession, CoreError } from "@xpro/core/server";
import { CompiledQuery, sql } from "kysely";
import type { Kysely, SqlBool } from "kysely";
import { err, ok } from "true-myth/result";
import type { Result } from "true-myth/result";
import { parse, safeParse } from "valibot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createEnrolledMaster, createMfaFixture } from "#test/master-mfa";
import type { EnrolledMaster, MfaFixture } from "#test/master-mfa";
import { readHubState } from "#test/sign-in";
import { managementOperationEntries, managementRevisionSchema } from "./input";
import { managementAuditDetailsSchema, managementOperationStatusSchema, managementReceiptSchema } from "./operations";
import type { ManagementReceipt, ManagementServices } from "./operations";
import { saveManagementChange } from "./changes.db";
import type { ManagementChangeTables, PreparedManagementChange } from "./changes.db";
import { fingerprintManagementCommand, getManagementOperation } from "./operations.db";

const operationId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000002";
const workspaceId = "00000000-0000-4000-8000-000000000003";
const creationId = "00000000-0000-4000-8000-000000000004";

describe("management operation contracts", () => {
  it("when an operation key is submitted then a diagnostic request ID cannot replace or accompany it", () => {
    expect(parseInput({ operationId }, managementOperationEntries).toJSON()).toEqual(ok({ operationId }).toJSON());
    expect(parseInput({ requestId: operationId }, managementOperationEntries).isErr).toBe(true);
    expect(parseInput({ operationId, requestId: operationId }, managementOperationEntries).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
    expect(parseInput({ operationId: "not-a-uuid" }, managementOperationEntries).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: ["operationId"] }).toJSON());
  });

  it("when revisions cross the safe integer boundary then invalid revisions are refused", () => {
    for (const revision of [0, Number.MAX_SAFE_INTEGER]) {
      expect(safeParse(managementRevisionSchema, revision).success).toBe(true);
    }
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "0", null]) {
      expect(safeParse(managementRevisionSchema, revision).success).toBe(false);
    }
  });

  it("when a receipt carries the wrong target or extra private data then it cannot become a public result", () => {
    const valid = { action: "stms_workspace_creation_requested", workspaceId, creationId };
    expect(safeParse(managementReceiptSchema, valid).success).toBe(true);
    for (const receipt of [
      { ...valid, clientSecret: "must-not-be-returned" },
      { ...valid, accountId },
      { action: "stms_account_created", workspaceId },
      { action: "unknown_action", accountId },
      { ...valid, workspaceId: "wrong" },
    ]) expect(safeParse(managementReceiptSchema, receipt).success).toBe(false);
  });

  it("when a stored audit record is decoded then only the declared version and fingerprint format are accepted", () => {
    const details = { version: 1, fingerprint: "a".repeat(64), result: { action: "stms_account_created", accountId } };
    expect(safeParse(managementAuditDetailsSchema, details).success).toBe(true);
    for (const invalid of [
      { ...details, version: 2 }, { ...details, fingerprint: "A".repeat(64) },
      { ...details, fingerprint: "a".repeat(63) }, { ...details, submittedName: "must-not-be-retained" },
      { ...details, result: { ...details.result, credentialEnvelope: "private" } },
    ]) expect(safeParse(managementAuditDetailsSchema, invalid).success).toBe(false);
  });

  it("when operation status is not recorded then it cannot carry a fabricated receipt", () => {
    expect(safeParse(managementOperationStatusSchema, { status: "not_recorded" }).success).toBe(true);
    expect(safeParse(managementOperationStatusSchema, { status: "recorded", result: { action: "stms_tenant_ownership_transferred", accountId, workspaceId } }).success).toBe(true);
    expect(safeParse(managementOperationStatusSchema, { status: "not_recorded", result: { action: "stms_account_created", accountId } }).success).toBe(false);
    expect(safeParse(managementOperationStatusSchema, { status: "recorded" }).success).toBe(false);
  });
});

describe("guarded management operation storage", () => {
  let fixture: MfaFixture;
  let master: EnrolledMaster;
  let targetId: string;
  let otherId: string;
  let holderId: string;
  let unrelatedWorkspaceId: string;

  beforeEach(async () => {
    fixture = await createMfaFixture(env.DB);
    master = await createEnrolledMaster(fixture);
    const holder = await fixture.identities.createLogin();
    const unrelated = await fixture.identities.createLogin();
    holderId = holder.loginId;
    targetId = crypto.randomUUID(); otherId = crypto.randomUUID();
    const organization = await fixture.identities.auth.api.createOrganization({ body: {
      name: "Unrelated native workspace", slug: `unrelated-${crypto.randomUUID()}`, userId: unrelated.loginId,
    } });
    if (!organization) throw new Error("Native directory workspace setup was refused.");
    unrelatedWorkspaceId = organization.id;
    const now = new Date().toISOString();
    await saveHub(env.DB, [
      fixture.identities.db.insertInto("accounts").values({ id: targetId, ownerLoginId: holderId,
        name: "Original account", nameSearch: "original account", createdAt: now, updatedAt: now }).compile(),
      fixture.identities.db.insertInto("accounts").values({ id: otherId, ownerLoginId: unrelated.loginId,
        name: "Unrelated account", nameSearch: "unrelated account", createdAt: now, updatedAt: now }).compile(),
      fixture.identities.db.insertInto("workspaces").values({ id: unrelatedWorkspaceId, accountId: otherId,
        regionHint: "wnam", nameSearch: "unrelated native workspace", createdAt: now, updatedAt: now }).compile(),
    ]);
  });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

  it.each(["same intent", "changed intent", "revoked authority"] as const)(
    "when a competing key commits before native preparation refuses with %s then recovery reads once without another write", async (kind) => {
      const input = command(), competing = kind === "changed intent" ? { ...input, name: "Different competing name" } : input;
      const winnerServices = request(), before = await state();
      let signalPrepared: () => void = () => {}, releasePreparation: () => void = () => {}, preparations = 0;
      const entered = new Promise<void>((resolve) => { signalPrepared = resolve; });
      const released = new Promise<void>((resolve) => { releasePreparation = resolve; });
      const pending = saveManagementChange({ ...change(input), async prepare(db) {
        preparations++; signalPrepared(); await released;
        // The refusal comes from the actual version changed by the competing
        // native commit, not a fabricated authority or storage/business result.
        const current = (await sql<{ revision: number }>`select revision from accounts where id = ${input.accountId}`.execute(db)).rows[0];
        if (current?.revision !== input.revision) return err({ code: "stms_operation_conflict" as const });
        return ok(renamePlan(db, input));
      } }, request());
      await entered;
      let committed: Snapshot;
      try {
        expect((await rename(competing, winnerServices)).toJSON()).toEqual(ok(receipt(competing)).toJSON());
        await expectRenamed({ input: competing, services: winnerServices, before });
        if (kind === "revoked authority") await fixture.auth.api.signOut({ headers: { cookie: master.cookie } });
        committed = await state();
      } finally { releasePreparation(); }
      const result = await pending;
      expect(result.toJSON()).toEqual(kind === "same intent" ? ok(receipt(input)).toJSON()
        : err({ code: kind === "revoked authority" ? "core_unauthenticated" : "stms_operation_conflict" }).toJSON());
      expect(preparations).toBe(1); expect(await state()).toEqual(committed);
      expect(committed.hub.audits.filter((row) => row.id === input.operationId)).toHaveLength(1);
      expect(committed.hub.audits.find((row) => row.id === input.operationId)?.requestId).toBe(winnerServices.context.requestId);
    },
  );

  it("when a direct status lookup has a malformed operation key then it refuses input without changing storage", async () => {
    const before = await state();
    expect((await getManagementOperation("not-a-uuid", request())).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: ["operationId"] }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when a fresh command commits then exactly its business change and minimal attributable audit are recorded", async () => {
    const input = command(), services = request(), before = await state();
    expect((await rename(input, services)).toJSON()).toEqual(ok(receipt(input)).toJSON());
    await expectRenamed({ input, services, before });
    const committed = await state();
    expect((await getManagementOperation(input.operationId, request())).toJSON())
      .toEqual(ok({ status: "recorded", result: receipt(input) }).toJSON());
    expect(await state()).toEqual(committed);
  });

  it("when a later domain statement fails then the earlier business write and audit both roll back", async () => {
    const input = command(), services = request(), before = await state();
    await sql`create trigger test_refuse_later_management before update of name on accounts
      when old.id = ${sql.lit(otherId)} begin select raise(abort, 'private_later_management_failure'); end`
      .execute(fixture.identities.db.withoutPlugins());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await saveManagementChange({ ...change(input), async prepare(db) {
      const plan = renamePlan(db, input);
      return ok({ ...plan, queries: [...plan.queries, sql`update accounts set name = 'Must roll back'
        where id = ${otherId}`.compile(db)] });
    } }, services);
    expect(result.toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expectUnexpected(log.mock.calls, services, "stms_save_management_change");
    expect(await state()).toEqual(before);
    expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(ok({ status: "not_recorded" }).toJSON());
  });

  it("when the business guard is false then even unconditional following writes cannot commit", async () => {
    const input = command(), before = await state();
    expect((await saveManagementChange({ ...change(input), async prepare(db) {
      return ok({ ...renamePlan(db, input), canApply: sql<SqlBool>`0` });
    } }, request())).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect(await state()).toEqual(before);
    expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(ok({ status: "not_recorded" }).toJSON());
  });

  it("when a committed command is replayed after another edit then its original receipt cannot overwrite later state", async () => {
    const input = command();
    expect((await rename(input, request())).toJSON()).toEqual(ok(receipt(input)).toJSON());
    const next = command({ name: "Later legitimate name", revision: 1 });
    expect((await rename(next, request())).toJSON()).toEqual(ok(receipt(next)).toJSON());
    const before = await state();
    const result = await saveManagementChange({ ...change(input), async prepare() {
      throw new Error("A committed replay must not prepare a new write.");
    } }, request());
    expect(result.toJSON()).toEqual(ok(receipt(input)).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when concurrent duplicates share one RequestContext then they still produce one effect and one receipt", async () => {
      const input = command(), first = holdBatch(env.DB), second = holdBatch(env.DB);
      const firstServices = request({ database: first.database });
      const secondServices = { ...request({ database: second.database }), context: firstServices.context };
      const before = await state();
      const firstRun = rename(input, firstServices), secondRun = rename(input, secondServices);
      await Promise.all([first.entered, second.entered]);
      first.release(); second.release();
      const results = await Promise.all([firstRun, secondRun]);
      expect(results.map((result) => result.toJSON())).toEqual([ok(receipt(input)).toJSON(), ok(receipt(input)).toJSON()]);
      const saved = (await state()).hub.audits.find((row) => row.id === input.operationId);
      const winningServices = [firstServices, secondServices].find((services) => services.context.requestId === saved?.requestId);
      if (!winningServices) throw new Error("One actual invocation must own the immutable audit diagnostics.");
      await expectRenamed({ input, services: winningServices, before });
  });

  it("when the same key races with different normalized commands then the losing intent conflicts", async () => {
    const firstInput = command(), secondInput = { ...firstInput, name: "Different intended name" };
    const first = holdBatch(env.DB), second = holdBatch(env.DB);
    const firstServices = request({ database: first.database }), secondServices = request({ database: second.database });
    const before = await state();
    const firstRun = rename(firstInput, firstServices), secondRun = rename(secondInput, secondServices);
    await Promise.all([first.entered, second.entered]); first.release(); second.release();
    const results = await Promise.all([firstRun, secondRun]);
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.filter((result) => result.isErr).map((result) => result.toJSON()))
      .toEqual([err({ code: "stms_operation_conflict" }).toJSON()]);
    const winner = results[0]?.isOk ? { input: firstInput, services: firstServices } : { input: secondInput, services: secondServices };
    await expectRenamed({ ...winner, before });
  });

  it("when normalized field order and diagnostic context change then replay still returns the first result", async () => {
    const input = command(), normalized = fields(input);
    expect(await fingerprintManagementCommand("stms_account_renamed", normalized))
      .toBe(await fingerprintManagementCommand("stms_account_renamed", {
        revision: normalized.revision, name: normalized.name, accountId: normalized.accountId,
      }));
    expect((await rename(input, request())).toJSON()).toEqual(ok(receipt(input)).toJSON());
    const before = await state();
    expect((await rename({ ...input, name: `  ${input.name}  ` }, request())).toJSON()).toEqual(ok(receipt(input)).toJSON());
    for (const altered of [
      { ...normalized, name: "Different name" }, { ...normalized, accountId: otherId }, { ...normalized, revision: 1 },
    ]) {
      expect((await saveManagementChange({ ...change(input), command: altered }, request())).toJSON())
        .toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    }
    expect((await saveManagementChange({ ...change(input), action: "stms_account_suspended" }, request())).toJSON())
      .toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when another edit commits after preparation then the stale revision cannot overwrite it", async () => {
    const input = command(), held = holdBatch(env.DB);
    const pending = rename(input, request({ database: held.database }));
    await held.entered;
    let before: Snapshot;
    try {
      const concurrent = command({ name: "Concurrent edit" });
      expect((await rename(concurrent, request())).toJSON()).toEqual(ok(receipt(concurrent)).toJSON());
      before = await state();
    } finally { held.release(); }
    expect((await pending).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when the selected holder becomes inactive before the guarded batch then the prepared eligibility cannot save", async () => {
    const input = command(), held = holdBatch(env.DB);
    const pending = saveManagementChange({ ...change(input), async prepare(db) {
      const plan = renamePlan(db, input);
      return ok({ ...plan, canApply: sql<SqlBool>`(${plan.canApply}) and exists
        (select 1 from user where id = ${holderId} and coalesce(banned, 0) = 0 and archived_at is null)` });
    } }, request({ database: held.database }));
    await held.entered;
    let before: Snapshot;
    try {
      await saveHub(env.DB, [sql`update user set banned = 1 where id = ${holderId}`.compile(fixture.identities.db)]);
      before = await state();
    } finally { held.release(); }
    expect((await pending).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when authority changes inside the batch before its claim then the injected fault and unconditional writes roll back", async () => {
    const input = command(), before = await state();
    const database = beforeBatch(env.DB, async (statements, target) => {
      const revoke = target.prepare('update user set role = ? where id = ?').bind("user", master.loginId);
      // A real in-transaction fault probe, not an outside writer interleaving with atomic D1.batch.
      const [preamble, ...guardedStatements] = statements;
      if (!preamble) throw new Error("The actual deferred-FK batch must contain its preamble.");
      return await target.batch([preamble, revoke, ...guardedStatements]);
    });
    const services = request({ database }), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await rename(input, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expectUnexpected(log.mock.calls, services, "stms_save_management_change");
    expect(await state()).toEqual(before);
  });

  const revoked = [
    ["session ended", { code: "core_unauthenticated" }],
    ["session expired", { code: "core_unauthenticated" }],
    ["role removed", { code: "core_forbidden" }],
    ["login suspended", { code: "core_login_inactive" }],
    ["login archived", { code: "core_login_inactive" }],
    ["invalid username", { code: "core_profile_incomplete", fields: ["username"] }],
    ["invalid phone", { code: "core_profile_incomplete", fields: ["phone"] }],
    ["incomplete creation", { code: "core_creation_incomplete" }],
    ["user revision", { code: "core_unauthenticated" }],
    ["session revision", { code: "core_unauthenticated" }],
    ["factor removed", { code: "core_unauthenticated" }],
    ["factor unverified", { code: "core_unauthenticated" }],
    ["enabled flag removed", { code: "core_unauthenticated" }],
    ["session MFA removed", { code: "core_mfa_required" }],
  ] satisfies readonly (readonly [string, CoreError])[];
  it.each(revoked)("when %s changes after preparation then the actual native guard refuses the pending command", async (kind, denial) => {
    const input = command(), held = holdBatch(env.DB);
    const pending = rename(input, request({ database: held.database }));
    await held.entered;
    let before: Snapshot;
    try { await revoke(kind); before = await state(); } finally { held.release(); }
    expect((await pending).toJSON()).toEqual(err(denial).toJSON());
    expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(err(denial).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when a valid profile changes without updatedAt changing then the original accepted snapshot is fenced", async () => {
    const input = command(), held = holdBatch(env.DB);
    const pending = rename(input, request({ database: held.database }));
    await held.entered;
    let before: Snapshot;
    try {
      await saveHub(env.DB, [sql`update user set name = 'Still valid changed profile' where id = ${master.loginId}`
        .compile(fixture.identities.db)]);
      before = await state();
    } finally { held.release(); }
    expect((await pending).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when unchanged accepted facts contain a session already expired on D1's clock then the execution-clock fence refuses it", async () => {
    const native = await fixture.identities.db.selectFrom("session").select("mfaVerifiedAt")
      .where("id", "=", master.hubSessionId).executeTakeFirstOrThrow();
    if (!native.mfaVerifiedAt) throw new Error("A real native verified MFA timestamp is required.");
    const verifiedAt = Date.parse(native.mfaVerifiedAt), expiresAt = new Date(verifiedAt + 1).toISOString();
    const clock = (await sql<{ now: string }>`select strftime('%Y-%m-%dT%H:%M:%fZ', 'now') as now`
      .execute(fixture.identities.db.withoutPlugins())).rows[0];
    expect(clock && Date.parse(clock.now)).toBeGreaterThan(verifiedAt + 1);
    await saveHub(env.DB, [sql`update session set "expiresAt" = ${expiresAt} where id = ${master.hubSessionId}`
      .compile(fixture.identities.db)]);
    const input = command(), before = await state();
    // Only the JS policy clock is shifted; SQL must independently consult D1 execution time.
    vi.spyOn(Date, "now").mockReturnValue(verifiedAt);
    expect((await rename(input, request())).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when authority is lost before a recorded lookup then neither replay nor status exposes the existing receipt", async () => {
    const input = command();
    expect((await rename(input, request())).toJSON()).toEqual(ok(receipt(input)).toJSON());
    await revoke("session ended");
    const before = await state();
    expect((await rename(input, request())).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when authority is lost after a duplicate batch fails then recovery still cannot disclose the first receipt", async () => {
    const input = command(), first = holdBatch(env.DB);
    let afterRevocation: Snapshot | undefined;
    const second = holdBatch(beforeBatch(env.DB, async (statements, target) => {
      try { return await target.batch(statements); }
      catch (error) {
        await revoke("session ended");
        afterRevocation = await state();
        throw error;
      }
    }));
    const firstRun = rename(input, request({ database: first.database }));
    const secondRun = rename(input, request({ database: second.database }));
    await Promise.all([first.entered, second.entered]);
    first.release();
    try { expect((await firstRun).toJSON()).toEqual(ok(receipt(input)).toJSON()); }
    finally { second.release(); }
    expect((await secondRun).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    if (!afterRevocation) throw new Error("Real duplicate failure must precede the committed native sign-out.");
    expect(await state()).toEqual(afterRevocation);
  });

  it("when a different current master recovers then the original actor and audit remain unchanged", async () => {
    const input = command();
    expect((await rename(input, request())).toJSON()).toEqual(ok(receipt(input)).toJSON());
    const otherMaster = await createEnrolledMaster(fixture), services = request({ session: otherMaster });
    const before = await state();
    expect((await getManagementOperation(input.operationId, services)).toJSON())
      .toEqual(ok({ status: "recorded", result: receipt(input) }).toJSON());
    expect((await rename(input, services)).toJSON()).toEqual(ok(receipt(input)).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when a master login is paired with another actual session then neither operation reads nor writes borrow authority", async () => {
    const ordinary = await fixture.identities.signIn();
    const services = request({ session: { loginId: master.loginId, hubSessionId: ordinary.hubSessionId } });
    const before = await state(), input = command();
    expect((await rename(input, services)).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await getManagementOperation(input.operationId, services)).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("when anonymous, holder or tenant-admin actors request management then neither present nor absent keys grant access", async () => {
    const input = command();
    expect((await rename(input, request())).toJSON()).toEqual(ok(receipt(input)).toJSON());
    const holder = await fixture.identities.db.selectFrom("user").select(["id", "email"]).where("id", "=", holderId).executeTakeFirstOrThrow();
    const signedInHolder = await fixture.identities.signInAgain({ loginId: holder.id, email: holder.email });
    const tenantAdmin = await fixture.identities.signIn();
    await fixture.identities.auth.api.addMember({ body: { userId: tenantAdmin.loginId, organizationId: unrelatedWorkspaceId, role: "admin" } });
    const unenrolled = await fixture.identities.signIn({ role: "admin" });
    const before = await state();
    for (const [actor, denial] of [
      [null, { code: "core_unauthenticated" }], [signedInHolder, { code: "core_forbidden" }],
      [tenantAdmin, { code: "core_forbidden" }], [unenrolled, { code: "core_mfa_required" }],
    ] satisfies readonly (readonly [AccessSession | null, CoreError])[]) {
      const services = request({ session: actor });
      for (const key of [input.operationId, crypto.randomUUID()]) {
        expect((await getManagementOperation(key, services)).toJSON()).toEqual(err(denial).toJSON());
        expect((await rename({ ...input, operationId: key }, services)).toJSON()).toEqual(err(denial).toJSON());
      }
    }
    expect(await state()).toEqual(before);
  });

  it.each(["envelope", "private result", "context", "action", "outcome", "legacy"] as const)(
    "when a stored audit has invalid %s then a present row cannot become a fabricated recorded or absent result", async (kind) => {
      const input = command(), action = "stms_account_renamed";
      const valid = { version: 1, fingerprint: await fingerprintManagementCommand(action, fields(input)), result: receipt(input) };
      const details = kind === "legacy" ? null : JSON.stringify(kind === "envelope" ? { ...valid, version: 2 }
        : kind === "private result" ? { ...valid, result: { ...valid.result, clientSecret: "private_corruption_marker" } }
          : kind === "action" ? { ...valid, result: { action: "stms_account_suspended", accountId: targetId } } : valid);
      await saveHub(env.DB, [fixture.identities.db.insertInto("auditEntries").values({ id: input.operationId,
        action, outcome: kind === "outcome" ? "failure" : "success", actorLoginId: master.loginId,
        affectedLoginId: null, reason: null, comment: null, requestId: crypto.randomUUID(), createdAt: new Date().toISOString(),
        accountId: kind === "context" ? otherId : targetId, workspaceId: null, details }).compile()]);
      const before = await state(), services = request(), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect((await getManagementOperation(input.operationId, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
      expect((await rename(input, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
      expect(log.mock.calls).toEqual([
        [JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: "stms_get_management_operation" })],
        [JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: "stms_save_management_change" })],
      ]);
      expect(await state()).toEqual(before);
    },
  );

  it("when status is absent before a held real batch then the same in-flight command may still commit once", async () => {
    const input = command(), held = holdBatch(env.DB), before = await state();
    const services = request({ database: held.database }), pending = rename(input, services);
    await held.entered;
    try {
      expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(ok({ status: "not_recorded" }).toJSON());
      expect(await state()).toEqual(before);
    } finally { held.release(); }
    expect((await pending).toJSON()).toEqual(ok(receipt(input)).toJSON());
    await expectRenamed({ input, services, before });
    const committed = await state();
    expect((await getManagementOperation(input.operationId, request())).toJSON())
      .toEqual(ok({ status: "recorded", result: receipt(input) }).toJSON());
    expect(await state()).toEqual(committed);
  });

  it("when a new account is created after its audit claim then the final referenced graph commits and replays its original ID", async () => {
    const holder = await fixture.identities.createLogin(), id = crypto.randomUUID(), key = crypto.randomUUID();
    const services = request(), before = await state();
    const run = (prospectiveId: string) => saveManagementChange({ operationId: key, action: "stms_account_created",
      command: { holderId: holder.loginId, name: "Created account" }, async prepare(db) {
        const now = new Date().toISOString();
        return ok({ receipt: { action: "stms_account_created", accountId: prospectiveId }, canApply: sql<SqlBool>`1`, queries: [
          sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
            values (${prospectiveId}, ${holder.loginId}, 'Created account', 'created account', ${now}, ${now})`.compile(db),
        ] } satisfies PreparedManagementChange);
      } }, services);
    const expected = { action: "stms_account_created", accountId: id };
    expect((await run(id)).toJSON()).toEqual(ok(expected).toJSON());
    const committed = await state(), row = committed.hub.accounts.find((account) => account.id === id);
    expect(row).toEqual({ id, ownerLoginId: holder.loginId, name: "Created account", nameSearch: "created account",
      status: "stms_active", revision: 0, createdAt: expect.any(String), updatedAt: expect.any(String) });
    const audit = committed.hub.audits.find((item) => item.id === key);
    if (!row || !audit) throw new Error("The new account and its audit must both be durable.");
    expect(audit.accountId).toBe(id); expect(audit.actorLoginId).toBe(master.loginId);
    expect(audit.details && JSON.parse(audit.details)).toEqual({ version: 1,
      fingerprint: await fingerprintManagementCommand("stms_account_created", { holderId: holder.loginId, name: "Created account" }), result: expected });
    expect(committed).toEqual({ ...before, hub: { ...before.hub,
      accounts: sorted([...before.hub.accounts, row]), audits: sorted([...before.hub.audits, audit]),
    } });
    expect((await run(crypto.randomUUID())).toJSON()).toEqual(ok(expected).toJSON());
    expect((await getManagementOperation(key, request())).toJSON()).toEqual(ok({ status: "recorded", result: expected }).toJSON());
    expect(await state()).toEqual(committed);
  });

  it("when the final audit reference is missing then deferred foreign keys roll back every earlier write and remain enforced", async () => {
    const input = command(), before = await state(), services = request();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await saveManagementChange({ operationId: input.operationId, action: "stms_account_created",
      command: { holderId, name: "Missing account" }, async prepare(db) {
        return ok({ receipt: { action: "stms_account_created", accountId: crypto.randomUUID() },
          canApply: sql<SqlBool>`1`, queries: renamePlan(db, input).queries } satisfies PreparedManagementChange);
      } }, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expectUnexpected(log.mock.calls, services, "stms_save_management_change");
    expect(await state()).toEqual(before);
    expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(ok({ status: "not_recorded" }).toJSON());
    await expect(saveHub(env.DB, [sql`insert into workspaces (id, account_id, region_hint, name_search, created_at, updated_at)
      values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'wnam', 'missing', ${new Date().toISOString()}, ${new Date().toISOString()})`
      .compile(fixture.identities.db)])).rejects.toThrow();
    expect(await state()).toEqual(before);
    expect((await rename(command(), request())).toJSON()).toEqual(ok({ action: "stms_account_renamed", accountId: targetId }).toJSON());
  });

  it("when a committed batch loses its reply then fresh lookup and explicit replay recover one unchanged result", async () => {
    const input = command(), database = interruptAfterWrite(env.DB, (query) => /^insert into "audit_entries"/i.test(query));
    const services = request({ database }), before = await state();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await rename(input, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expectUnexpected(log.mock.calls, services, "stms_save_management_change");
    await expectRenamed({ input, services, before });
    const committed = await state();
    expect((await getManagementOperation(input.operationId, request())).toJSON())
      .toEqual(ok({ status: "recorded", result: receipt(input) }).toJSON());
    expect((await rename(input, request())).toJSON()).toEqual(ok(receipt(input)).toJSON());
    expect(await state()).toEqual(committed);
  });

  it.each(["private receipt", "wrong action", "account context"] as const)(
    "when preparation supplies an invalid %s then neither its business writes nor audit can commit", async (kind) => {
      const input = command(), services = request(), before = await state();
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = await saveManagementChange({ ...change(input), async prepare(db) {
        const plan = renamePlan(db, input);
        if (kind === "private receipt") {
          const unsafe = { ...plan.receipt, clientSecret: "private_preparation_marker" };
          return ok({ ...plan, receipt: unsafe });
        }
        if (kind === "wrong action") return ok({ ...plan,
          receipt: { action: "stms_account_suspended" as const, accountId: targetId } });
        return ok({ ...plan, audit: { accountId: otherId } });
      } }, services);
      expect(result.toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
      expectUnexpected(log.mock.calls, services, "stms_save_management_change");
      expect(await state()).toEqual(before);
    },
  );

  it("when a workspace change carries its related account then its atomic writes retain context but its receipt stays minimal", async () => {
    const key = crypto.randomUUID(), name = "Renamed workspace", services = request(), before = await state();
    const expected = { action: "stms_workspace_renamed" as const, workspaceId: unrelatedWorkspaceId };
    const normalized = { workspaceId: unrelatedWorkspaceId, revision: 0, name };
    const result = await saveManagementChange({ operationId: key, action: "stms_workspace_renamed",
      command: normalized, async prepare(db) {
        return ok({ receipt: expected, audit: { accountId: otherId, workspaceId: unrelatedWorkspaceId },
          canApply: sql<SqlBool>`exists (select 1 from workspaces where id = ${unrelatedWorkspaceId}
            and account_id = ${otherId} and revision = 0)`, queries: [
            sql`update organization set name = ${name} where id = ${unrelatedWorkspaceId}`.compile(db),
            sql`update workspaces set name_search = ${normalizeSearchText(name)}, revision = revision + 1,
              updated_at = ${new Date().toISOString()} where id = ${unrelatedWorkspaceId}`.compile(db),
          ] } satisfies PreparedManagementChange);
      } }, services);
    expect(result.toJSON()).toEqual(ok(expected).toJSON());
    const after = await state(), audit = after.hub.audits.find((entry) => entry.id === key);
    expect(audit).toEqual({ id: key, action: expected.action, outcome: "success", actorLoginId: master.loginId,
      affectedLoginId: null, accountId: otherId, workspaceId: unrelatedWorkspaceId,
      reason: null, comment: null, requestId: services.context.requestId, createdAt: expect.any(String),
      details: JSON.stringify({ version: 1, fingerprint: await fingerprintManagementCommand(expected.action, normalized), result: expected }) });
    if (!audit) throw new Error("The workspace change must retain its immutable operation audit.");
    expect(after).toEqual({ ...before, hub: { ...before.hub,
      workspaces: before.hub.workspaces.map((row) => row.id === unrelatedWorkspaceId ? { ...row, name } : row),
      audits: sorted([...before.hub.audits, audit]),
    }, managementWorkspaces: before.managementWorkspaces.map((row) => row.id === unrelatedWorkspaceId
      ? { ...row, nameSearch: normalizeSearchText(name), revision: row.revision + 1, updatedAt: expect.any(String) } : row) });
    expect((await getManagementOperation(key, request())).toJSON()).toEqual(ok({ status: "recorded", result: expected }).toJSON());
    expect(await state()).toEqual(after);
  });

  it("when status storage is unavailable then no fabricated absence or receipt escapes", async () => {
    const input = command(), before = await state();
    const database = new Proxy(env.DB, { get(target, key) {
      if (key === "prepare") return () => { throw new Error("private_operation_lookup_failure"); };
      return bound(target, key);
    } });
    const services = request({ database }), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await getManagementOperation(input.operationId, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expectUnexpected(log.mock.calls, services, "stms_get_management_operation");
    expect(await state()).toEqual(before);
  });

  it("when actual management queries are planned then key lookups stay indexed and within D1's parameter budget", async () => {
    const captured: { query: string; parameters: unknown[] }[] = [];
    const database = new Proxy(env.DB, { get(target, key) {
      if (key === "prepare") return (query: string) => {
        const statement = target.prepare(query);
        return new Proxy(statement, { get(prepared, property) {
          if (property === "bind") return (...parameters: unknown[]) => {
            captured.push({ query, parameters }); return prepared.bind(...parameters);
          };
          return bound(prepared, property);
        } });
      };
      return bound(target, key);
    } });
    const input = command();
    expect((await rename(input, request({ database }))).toJSON()).toEqual(ok(receipt(input)).toJSON());
    expect((await getManagementOperation(input.operationId, request({ database }))).toJSON())
      .toEqual(ok({ status: "recorded", result: receipt(input) }).toJSON());
    const before = await state(), db = (await createHubConnection<unknown>(env.DB)).withoutPlugins();
    try {
      const details: string[] = [];
      for (const { query, parameters } of captured) {
        expect(parameters.length).toBeLessThanOrEqual(100);
        if (/^pragma\b/i.test(query)) continue;
        const plan = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query, parameters));
        const rows = plan.rows.map((row) => row.detail); details.push(...rows);
        expect(rows.filter((detail) => /\bSCAN (?:s|u|c|f|m|audit|accounts|user|session|twoFactor|audit_entries|workspaces)\b/.test(detail))).toEqual([]);
      }
      expect(details.some((detail) => /SEARCH audit USING INDEX/.test(detail))).toBe(true);
      expect(details.some((detail) => detail.includes("twoFactor_userId_idx"))).toBe(true);
      expect(details.some((detail) => /SEARCH accounts USING INDEX/.test(detail))).toBe(true);
    } finally { await db.destroy(); }
    expect(await state()).toEqual(before);
  });

  type Rename = { operationId: string; accountId: string; name: string; revision: number };
  type Snapshot = Awaited<ReturnType<typeof state>>;

  function command(overrides: Partial<Rename> = {}): Rename {
    return { operationId: crypto.randomUUID(), accountId: targetId, name: "Renamed account", revision: 0, ...overrides };
  }
  function request(input: { session?: AccessSession | null; database?: D1Database } = {}): ManagementServices {
    return { database: input.database ?? env.DB, session: input.session === undefined ? master : input.session, context: createRequestContext() };
  }
  function receipt(input: Rename): ManagementReceipt { return { action: "stms_account_renamed", accountId: input.accountId }; }
  function fields(input: Rename): { accountId: string; name: string; revision: number } {
    return { accountId: input.accountId, name: parse(nameSchema, input.name), revision: input.revision };
  }
  function change(input: Rename): {
    operationId: string; action: "stms_account_renamed"; command: ReturnType<typeof fields>;
    prepare(db: Kysely<ManagementChangeTables>): Promise<Result<PreparedManagementChange, never>>;
  } {
    return { operationId: input.operationId, action: "stms_account_renamed", command: fields(input),
      async prepare(db) { return ok(renamePlan(db, input)); } };
  }
  async function rename(input: Rename, services: ManagementServices): Promise<Awaited<ReturnType<typeof saveManagementChange<never>>>> {
    return await saveManagementChange(change(input), services);
  }
  function renamePlan(db: Kysely<ManagementChangeTables>, input: Rename): PreparedManagementChange {
    const normalized = fields(input);
    return { receipt: receipt(input), canApply: sql<SqlBool>`exists
      (select 1 from accounts where id = ${normalized.accountId} and revision = ${normalized.revision})`, queries: [
      // Deliberately unconditional with respect to claim/revision: the shared guard must abort the entire batch.
      sql`update accounts set name = ${normalized.name}, name_search = ${normalizeSearchText(normalized.name)},
        revision = revision + 1, updated_at = ${new Date().toISOString()} where id = ${normalized.accountId}`.compile(db),
    ] };
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
  async function expectRenamed(input: { input: Rename; services: ManagementServices; before: Snapshot }): Promise<void> {
    const { input: submitted, services, before } = input, normalized = fields(submitted);
    const audit = { id: submitted.operationId, action: "stms_account_renamed", outcome: "success", actorLoginId: master.loginId,
      affectedLoginId: null, reason: null, comment: null, accountId: submitted.accountId, workspaceId: null,
      requestId: services.context.requestId, createdAt: expect.any(String), details: JSON.stringify({ version: 1,
        fingerprint: await fingerprintManagementCommand("stms_account_renamed", normalized), result: receipt(submitted) }) };
    const after = await state();
    expect(after).toEqual({ ...before, hub: { ...before.hub,
      accounts: before.hub.accounts.map((row) => row.id === submitted.accountId ? { ...row,
        name: normalized.name, nameSearch: normalizeSearchText(normalized.name), revision: row.revision + 1,
        updatedAt: expect.any(String) } : row),
      audits: sorted([...before.hub.audits, audit]),
    } });
    const saved = after.hub.audits.find((row) => row.id === submitted.operationId);
    expect(saved?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(saved?.details).not.toContain(normalized.name);
  }
  async function revoke(kind: string): Promise<void> {
    const db = fixture.identities.db.withoutPlugins(), loginId = master.loginId, sessionId = master.hubSessionId;
    if (kind === "session ended") {
      await fixture.auth.api.signOut({ headers: { cookie: master.cookie } }); return;
    }
    if (kind === "incomplete creation") {
      const id = crypto.randomUUID();
      await saveHub(env.DB, [sql`insert into login_creations
        (id, creator_login_id, created_login_id, organization_id, kind, details, created_at, completed_at)
        values (${id}, ${loginId}, ${loginId}, null, null, '{}', ${new Date().toISOString()}, null)`.compile(db),
      sql`update user set login_creation_id = ${id} where id = ${loginId}`.compile(db)]); return;
    }
    const queries = {
      "session expired": sql`update session set "expiresAt" = '2000-01-01T00:00:00.000Z' where id = ${sessionId}`,
      "role removed": sql`update user set role = 'user' where id = ${loginId}`,
      "login suspended": sql`update user set banned = 1 where id = ${loginId}`,
      "login archived": sql`update user set archived_at = ${new Date().toISOString()} where id = ${loginId}`,
      "invalid username": sql`update user set username = 'INVALID' where id = ${loginId}`,
      "invalid phone": sql`update user set phone = 'not-a-phone' where id = ${loginId}`,
      "user revision": sql`update user set auth_revision = auth_revision + 1 where id = ${loginId}`,
      "session revision": sql`update session set auth_revision = auth_revision + 1 where id = ${sessionId}`,
      "factor removed": sql`delete from "twoFactor" where "userId" = ${loginId}`,
      "factor unverified": sql`update "twoFactor" set verified = 0 where "userId" = ${loginId}`,
      "enabled flag removed": sql`update user set "twoFactorEnabled" = 0 where id = ${loginId}`,
      "session MFA removed": sql`update session set mfa_verified_at = null where id = ${sessionId}`,
    };
    const query = queries[kind as keyof typeof queries];
    if (!query) throw new Error("Unsupported negative authority fixture change.");
    await saveHub(env.DB, [query.compile(db)]);
  }
});

function sorted<Row extends { id: string }>(rows: Row[]): Row[] {
  return [...rows].sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
}

function expectUnexpected(calls: unknown[][], services: ManagementServices, operation: string): void {
  expect(calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation })]]);
}

function bound(target: object, key: PropertyKey): unknown {
  const value: unknown = Reflect.get(target, key, target);
  return typeof value === "function" ? value.bind(target) : value;
}

function beforeBatch(database: D1Database, run: (statements: D1PreparedStatement[], target: D1Database) => Promise<D1Result[]>): D1Database {
  return new Proxy(database, { get(target, key) {
    if (key === "batch") return async (statements: D1PreparedStatement[]) => await run(statements, target);
    return bound(target, key);
  } });
}

function holdBatch(database: D1Database): { database: D1Database; entered: Promise<void>; release(): void } {
  let signalEntered: () => void = () => {}, signalRelease: () => void = () => {};
  const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
  const released = new Promise<void>((resolve) => { signalRelease = resolve; });
  return { database: beforeBatch(database, async (statements, target) => {
    signalEntered(); await released; return await target.batch(statements);
  }), entered, release: () => signalRelease() };
}
