import { authorizeMasterAuthority, sessionAccessQuery } from "@xpro/accounts/server";
import type { MasterAuthority, SessionAccessRow } from "@xpro/accounts/server";
import { createHubConnection, parseInput, reportUnexpectedError } from "@xpro/core/server";
import type { AccessError, AccessSession, CoreError } from "@xpro/core/server";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import { err, ok } from "true-myth/result";
import type { Result } from "true-myth/result";
import { safeParse } from "valibot";
import { managementOperationEntries } from "./input";
import { managementAuditDetailsSchema } from "./operations";
import type { ManagementAction, ManagementAuditDetails,
  ManagementOperationStatus, ManagementServices } from "./operations";

export type ManagementCommandFields = Readonly<Record<string, string | number | boolean | null>>;
type ManagementAuditRecord = {
  operationId: string | null; action: string | null; outcome: string | null;
  actorLoginId: string | null; accountId: string | null; workspaceId: string | null; details: string | null;
};
type ManagementOperationRow = SessionAccessRow & ManagementAuditRecord;
export type ManagementOperationSnapshot = { authority: MasterAuthority; record: ManagementAuditRecord | null };

export async function getManagementOperation(operationId: string, services: ManagementServices): Promise<Result<ManagementOperationStatus, CoreError>> {
  if (!services.session) return err({ code: "core_unauthenticated" });
  const parsed = parseInput({ operationId }, managementOperationEntries);
  if (parsed.isErr) return err(parsed.error);
  try {
    const db = (await createHubConnection<unknown>(services.database)).withoutPlugins();
    try {
      const snapshot = await readManagementOperationSnapshot({ operationId: parsed.value.operationId, session: services.session }, db);
      if (snapshot.isErr) return err(snapshot.error);
      const { record } = snapshot.value;
      return ok(record === null ? { status: "not_recorded" } : {
        status: "recorded", result: decodeManagementAuditRecord(record).result,
      });
    } finally { await db.destroy(); }
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "stms_get_management_operation" });
    return err({ code: "core_unexpected_error" });
  }
}

export async function fingerprintManagementCommand(action: ManagementAction, fields: ManagementCommandFields): Promise<string> {
  // Callers supply normalized, non-secret semantics, never session/request or allocated result IDs.
  const canonical = JSON.stringify([action, Object.keys(fields).sort().map((key) => [key, fields[key]])]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  let fingerprint = "";
  for (const byte of new Uint8Array(digest)) fingerprint += byte.toString(16).padStart(2, "0");
  return fingerprint;
}

export async function readManagementOperationSnapshot<Tables>(input: {
  operationId: string; session: AccessSession;
}, db: Kysely<Tables>): Promise<Result<ManagementOperationSnapshot, AccessError>> {
  // A missing audit and its authority are observed in the same database snapshot.
  const row = (await sql<ManagementOperationRow>`select current_access.*,
    audit.id as "operationId", audit.action, audit.outcome,
    audit.actor_login_id as "actorLoginId", audit.account_id as "accountId",
    audit.workspace_id as "workspaceId", audit.details
    from (${sessionAccessQuery({ ...input.session, workspaceId: null })}) as current_access
    left join audit_entries audit on audit.id = ${input.operationId}`.execute(db)).rows[0];
  const authority = authorizeMasterAuthority({ session: input.session, row, now: Date.now() });
  if (authority.isErr) return err(authority.error);
  return ok({ authority: authority.value, record: row && row.operationId !== null ? row : null });
}

export function decodeManagementAuditRecord(record: ManagementAuditRecord): ManagementAuditDetails {
  if (record.operationId === null || record.outcome !== "success" || record.actorLoginId === null || record.details === null) {
    throw new Error("The management operation audit is invalid.");
  }
  const parsed = safeParse(managementAuditDetailsSchema, JSON.parse(record.details));
  if (!parsed.success || parsed.output.result.action !== record.action) {
    throw new Error("The management operation receipt is invalid.");
  }
  const receipt = parsed.output.result;
  if (("accountId" in receipt && receipt.accountId !== record.accountId)
    || ("workspaceId" in receipt && receipt.workspaceId !== record.workspaceId)) {
    throw new Error("The management operation target is inconsistent.");
  }
  return parsed.output;
}
