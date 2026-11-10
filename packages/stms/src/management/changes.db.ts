import { masterAuthorityMatches } from "@xpro/accounts/server";
import { createHubConnection, reportUnexpectedError, saveHub } from "@xpro/core/server";
import type { AccessActor } from "@xpro/core/server";
import { sql } from "kysely";
import type { ColumnType, CompiledQuery, Expression, Kysely, SqlBool } from "kysely";
import { err, ok } from "true-myth/result";
import type { Result } from "true-myth/result";
import { safeParse } from "valibot";
import { decodeManagementAuditRecord, fingerprintManagementCommand, readManagementOperationSnapshot } from "./operations.db";
import type { ManagementCommandFields, ManagementOperationSnapshot } from "./operations.db";
import { managementReceiptSchema } from "./operations";
import type { ManagementAction, ManagementOperationError, ManagementReceipt, ManagementServices } from "./operations";

export type ManagementChangeTables = {
  audit_entries: {
    // NULL is an intentional failing INSERT value; successful stored IDs are never nullable.
    id: ColumnType<string, string | null, never>; action: string; outcome: string;
    actor_login_id: string | null; affected_login_id: string | null;
    account_id: string | null; workspace_id: string | null; reason: string | null; comment: string | null;
    request_id: string; created_at: string; details: string | null;
  };
};
type AuditContext = {
  accountId?: string | null; workspaceId?: string | null; affectedLoginId?: string | null;
  reason?: string | null; comment?: string | null;
};
export type PreparedManagementChange = {
  receipt: ManagementReceipt; canApply: Expression<SqlBool>; queries: readonly CompiledQuery[]; audit?: AuditContext;
};
type ManagementChange<Failure> = {
  operationId: string; action: ManagementAction; command: ManagementCommandFields;
  // Preparation may read/build SQL, but must perform no writes or provider calls.
  prepare(db: Kysely<ManagementChangeTables>, actor: Readonly<AccessActor>): Promise<Result<PreparedManagementChange, Failure>>;
};

export async function saveManagementChange<Failure>(change: ManagementChange<Failure>, services: ManagementServices): Promise<Result<ManagementReceipt, ManagementOperationError | Failure>> {
  if (!services.session) return err({ code: "core_unauthenticated" });
  try {
    const db = (await createHubConnection<ManagementChangeTables>(services.database)).withoutPlugins();
    try {
      const lookup = { operationId: change.operationId, session: services.session };
      const snapshot = await readManagementOperationSnapshot(lookup, db);
      if (snapshot.isErr) return err(snapshot.error);
      const fingerprint = await fingerprintManagementCommand(change.action, change.command);
      const intent = { action: change.action, fingerprint };
      const recorded = readRecordedResult(snapshot.value.record, intent);
      if (recorded !== null) return recorded;
      const prepared = await change.prepare(db, snapshot.value.authority.actor);
      if (prepared.isErr) {
        // A same-key invocation may commit after our absent-key snapshot but
        // before preparation observes changed business state. Recover by reading
        // once under current authority; never retry preparation or any write.
        const recovery = await readManagementOperationSnapshot(lookup, db);
        if (recovery.isErr) return err(recovery.error);
        const recovered = readRecordedResult(recovery.value.record, intent);
        return recovered ?? err(prepared.error);
      }
      const plan = prepared.value;
      const parsed = safeParse(managementReceiptSchema, plan.receipt);
      if (!parsed.success || parsed.output.action !== change.action) throw new Error("The prepared management receipt is invalid.");
      const receipt = parsed.output;
      const guard = sql<SqlBool>`(${masterAuthorityMatches(snapshot.value.authority)}) and (${plan.canApply})`;
      const claim = claimManagementChangeQuery(db, {
        operationId: change.operationId, receipt, fingerprint, guard, audit: plan.audit,
        actorLoginId: snapshot.value.authority.actor.loginId, requestId: services.context.requestId,
      });
      try {
        // The audit can reference a target created later in this same transaction.
        // D1 enforces the complete foreign-key graph at commit, not on this first INSERT.
        await saveHub(services.database, [sql`pragma defer_foreign_keys = on`.compile(db), claim, ...plan.queries]);
        return ok(receipt);
      } catch (error) {
        // A lost reply or duplicate claim can follow a committed write. Never retry it.
        const recovery = await readManagementOperationSnapshot(lookup, db);
        if (recovery.isErr) return err(recovery.error);
        const recovered = readRecordedResult(recovery.value.record, intent);
        if (recovered !== null) return recovered;
        const current = (await sql<{ canApply: number }>`select case when ${guard} then 1 else 0 end as "canApply"`.execute(db)).rows[0];
        if (current?.canApply === 0) return err({ code: "stms_operation_conflict" });
        throw error;
      }
    } finally { await db.destroy(); }
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "stms_save_management_change" });
    return err({ code: "core_unexpected_error" });
  }
}

function readRecordedResult(record: ManagementOperationSnapshot["record"], intent: {
  action: ManagementAction; fingerprint: string;
}): Result<ManagementReceipt, ManagementOperationError> | null {
  if (record === null) return null;
  if (record.action !== intent.action) return err({ code: "stms_operation_conflict" });
  const details = decodeManagementAuditRecord(record);
  return details.fingerprint === intent.fingerprint ? ok(details.result) : err({ code: "stms_operation_conflict" });
}

function claimManagementChangeQuery(db: Kysely<ManagementChangeTables>, input: {
  operationId: string; receipt: ManagementReceipt; fingerprint: string; guard: Expression<SqlBool>;
  actorLoginId: string; requestId: string; audit?: AuditContext;
}): CompiledQuery {
  const { receipt, audit } = input;
  const accountId = "accountId" in receipt ? receipt.accountId : audit?.accountId ?? null;
  const workspaceId = "workspaceId" in receipt ? receipt.workspaceId : audit?.workspaceId ?? null;
  if (("accountId" in receipt && audit?.accountId !== undefined && audit.accountId !== accountId)
    || ("workspaceId" in receipt && audit?.workspaceId !== undefined && audit.workspaceId !== workspaceId)) {
    throw new Error("The prepared management audit target is inconsistent.");
  }
  return db.insertInto("audit_entries").values({
    // Always attempt one row: a false guard must abort, not leave an old claim usable.
    id: sql<string | null>`case when ${input.guard} then ${input.operationId} else null end`,
    action: receipt.action, outcome: "success", actor_login_id: input.actorLoginId,
    affected_login_id: audit?.affectedLoginId ?? null, account_id: accountId, workspace_id: workspaceId,
    reason: audit?.reason ?? null, comment: audit?.comment ?? null,
    request_id: input.requestId, created_at: new Date().toISOString(),
    details: JSON.stringify({ version: 1, fingerprint: input.fingerprint, result: receipt }),
  }).compile();
}
