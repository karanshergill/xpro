import { check, integer, maxLength, maxValue, minLength, minValue, number, optional, pipe, string, trim, uuid } from "valibot";

export const defaultAccountPageSize = 25;
export const maximumAccountPageSize = 100;
export const maximumAccountSearchLength = 200;
const pageSizeSchema = pipe(number(), integer(), minValue(1), maxValue(maximumAccountPageSize));
const offsetSchema = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER));

export const listAccountsEntries = {
  limit: optional(pageSizeSchema, defaultAccountPageSize), offset: optional(offsetSchema, 0),
};
export const searchAccountsEntries = {
  ...listAccountsEntries, query: pipe(string(), trim(), minLength(1), maxLength(maximumAccountSearchLength),
    check((value) => !/[\uD800-\uDFFF]/u.test(value))),
};
export const getAccountEntries = { accountId: pipe(string(), uuid()) };
export type AccountPageInput = { limit: number; offset: number };
export type AccountSearchInput = AccountPageInput & { query: string };
