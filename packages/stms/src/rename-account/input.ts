import { nameSchema } from "@xpro/accounts";
import { pipe, string, uuid } from "valibot";
import { managementOperationEntries, managementRevisionSchema } from "#management/input.ts";

export const renameAccountEntries = {
  ...managementOperationEntries, accountId: pipe(string(), uuid()), expectedRevision: managementRevisionSchema, name: nameSchema,
};
export type RenameAccountInput = { operationId: string; accountId: string; expectedRevision: number; name: string };
