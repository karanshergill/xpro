import type { AccessSession, CoreError, RequestContext } from "@xpro/core/server";
import { literal, picklist, pipe, regex, strictObject, string, uuid, variant, type InferOutput } from "valibot";

const idSchema = pipe(string(), uuid());
const accountActions = ["stms_account_created", "stms_account_renamed", "stms_account_holder_transferred",
  "stms_account_suspended", "stms_account_reactivated"] as const;
const workspaceActions = ["stms_workspace_renamed", "stms_workspace_owner_transferred",
  "stms_workspace_suspended", "stms_workspace_reactivated"] as const;
const creationActions = ["stms_workspace_creation_requested", "stms_workspace_creation_resumed"] as const;
const handoverActions = ["stms_tenant_ownership_transferred", "stms_tenant_departure_completed"] as const;

export const managementReceiptSchema = variant("action", [
  strictObject({ action: picklist(accountActions), accountId: idSchema }),
  strictObject({ action: picklist(workspaceActions), workspaceId: idSchema }),
  strictObject({ action: picklist(creationActions), workspaceId: idSchema, creationId: idSchema }),
  strictObject({ action: picklist(handoverActions), accountId: idSchema, workspaceId: idSchema }),
]);
export type ManagementReceipt = InferOutput<typeof managementReceiptSchema>;
export type ManagementAction = ManagementReceipt["action"];

export const managementAuditDetailsSchema = strictObject({
  version: literal(1), fingerprint: pipe(string(), regex(/^[0-9a-f]{64}$/)), result: managementReceiptSchema,
});
export type ManagementAuditDetails = InferOutput<typeof managementAuditDetailsSchema>;

export const managementOperationStatusSchema = variant("status", [
  strictObject({ status: literal("not_recorded") }),
  strictObject({ status: literal("recorded"), result: managementReceiptSchema }),
]);
export type ManagementOperationStatus = InferOutput<typeof managementOperationStatusSchema>;
export type ManagementOperationError = CoreError | { code: "stms_operation_conflict" };
export type ManagementServices = { database: D1Database; session: AccessSession | null; context: RequestContext };
