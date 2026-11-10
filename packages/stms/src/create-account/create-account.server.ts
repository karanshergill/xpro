import { parseInput } from "@xpro/core/server";
import { err } from "true-myth/result";
import type { Result } from "true-myth/result";
import { saveManagementChange } from "#management/changes.db.ts";
import type { ManagementOperationError, ManagementReceipt, ManagementServices } from "#management/operations.ts";
import { prepareAccountCreation } from "./create-account.db";
import { createAccountEntries } from "./input";

export type CreateAccountError = ManagementOperationError | { code: "stms_account_holder_unavailable" };
export async function createAccount(input: unknown, services: ManagementServices): Promise<Result<ManagementReceipt, CreateAccountError>> {
  if (!services.session) return err({ code: "core_unauthenticated" });
  const parsed = parseInput(input, createAccountEntries);
  if (parsed.isErr) return err(parsed.error);
  const command = { name: parsed.value.name, holderLoginId: parsed.value.holderLoginId };
  return await saveManagementChange({ operationId: parsed.value.operationId, action: "stms_account_created", command,
    async prepare(db) { return await prepareAccountCreation(db, parsed.value); } }, services);
}
