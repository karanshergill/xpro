import { integer, maxValue, minValue, number, pipe, string, uuid } from "valibot";

export const managementOperationEntries = { operationId: pipe(string(), uuid()) };
export const managementRevisionSchema = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER));
