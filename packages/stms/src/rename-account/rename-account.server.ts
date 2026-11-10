import { parseInput } from "@xpro/core/server";
import { err } from "true-myth/result";
import type { Result } from "true-myth/result";
import { saveManagementChange } from "#management/changes.db.ts";
import type { ManagementOperationError, ManagementReceipt, ManagementServices } from "#management/operations.ts";
import { prepareAccountRename } from "./rename-account.db";
import { renameAccountEntries } from "./input";

export type RenameAccountError = ManagementOperationError | { code: "stms_account_not_found" };
export async function renameAccount(input: unknown, services: ManagementServices): Promise<Result<ManagementReceipt, RenameAccountError>> {
  if (!services.session) return err({ code: "core_unauthenticated" });
  const parsed = parseInput(input, renameAccountEntries);
  if (parsed.isErr) return err(parsed.error);
  const { accountId, expectedRevision, name } = parsed.value;
  return await saveManagementChange({ operationId: parsed.value.operationId, action: "stms_account_renamed",
    command: { accountId, expectedRevision, name }, async prepare(db) { return await prepareAccountRename(db, parsed.value); } }, services);
}
