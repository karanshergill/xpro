import type { Where } from "@better-auth/core/db/adapter";
import type { Kysely, UpdateQueryBuilder, UpdateResult } from "kysely";
import { currentMfaSource, type MfaOperation, type MfaTables, type NativeFactor } from "./phases.db";
import { refuseMfaWrite } from "./context.db";

export function guardedFactorUpdate(db: Kysely<MfaTables>, input: { value: MfaOperation; where: Where[] }): UpdateQueryBuilder<MfaTables, "twoFactor", "twoFactor", UpdateResult> {
  const { value, where } = input;
  if (!value.factor || where.length === 0) refuseMfaWrite();
  let query = db.updateTable("twoFactor").where("id", "=", value.factor.id)
    .where((eb) => eb.exists(currentMfaSource(db, value).select("id")));
  const operators = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
  for (const part of where) {
    if (!["id", "userId", "backupCodes", "failedVerificationCount", "lockedUntil"].includes(part.field)
      || part.connector === "OR" || part.mode === "insensitive") refuseMfaWrite();
    const operator = part.operator ?? "eq";
    if (!(operator in operators)) refuseMfaWrite();
    const comparison = operators[operator as keyof typeof operators], argument = nativeFactorValue(part.value);
    if (argument === null && comparison !== "=" && comparison !== "!=") refuseMfaWrite();
    query = query.where(part.field as keyof NativeFactor, argument === null ? (comparison === "=" ? "is" : "is not") : comparison, argument);
  }
  return query;
}

export function nativeFactorValues(values: Record<string, unknown>): Record<string, string | number | null> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, nativeFactorValue(value)]));
}

function nativeFactorValue(value: unknown): string | number | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
  refuseMfaWrite();
}
