import { check, integer, maxLength, maxValue, minLength, minValue, number, optional, pipe, string, trim, uuid } from "valibot";

export const defaultLoginPageSize = 25;
export const maximumLoginPageSize = 100;
export const maximumLoginSearchLength = 200;
const pageSizeSchema = pipe(number(), integer(), minValue(1), maxValue(maximumLoginPageSize));
const offsetSchema = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER));

export const listLoginsEntries = {
  limit: optional(pageSizeSchema, defaultLoginPageSize), offset: optional(offsetSchema, 0),
};
export const searchLoginsEntries = {
  ...listLoginsEntries, query: pipe(string(), trim(), minLength(1), maxLength(maximumLoginSearchLength),
    check((value) => !/[\uD800-\uDFFF]/u.test(value))),
};
export const getLoginEntries = { loginId: pipe(string(), uuid()) };
export type LoginPageInput = { limit: number; offset: number };
export type LoginSearchInput = LoginPageInput & { query: string };
