import { nameSchema } from "@xpro/accounts";
import { pipe, string, uuid } from "valibot";
import { managementOperationEntries } from "#management/input.ts";

export const createAccountEntries = {
  ...managementOperationEntries, name: nameSchema, holderLoginId: pipe(string(), uuid()),
};
export type CreateAccountInput = { operationId: string; name: string; holderLoginId: string };
