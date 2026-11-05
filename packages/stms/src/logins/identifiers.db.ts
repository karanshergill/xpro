import type { CompiledQuery, ExpressionBuilder, ExpressionWrapper, Kysely, SqlBool } from "kysely";
import { claimLoginChangeQuery, type LoginChangeSave, type LoginChangeTables } from "./changes.db";

export type IdentifierField = "email" | "username";
export type IdentifierSave = LoginChangeSave & { field: IdentifierField; value: string; comment: string | null };
export type IdentifierState = { id: string; currentValue: string | null; isTaken: SqlBool; isReserved: SqlBool };
export type IdentifierSaveResult = "saved" | "unchanged" | "missing" | "taken" | "reserved";

export function identifierStateQuery(db: Kysely<LoginChangeTables>, input: IdentifierSave): CompiledQuery<IdentifierState> {
  return db.selectFrom("user").select("id").select((eb) => [
    normalizedIdentifier(eb, input.field).as("currentValue"),
    identifierTaken(eb, input).as("isTaken"),
    (input.field === "username" ? usernameReserved(eb, input.value) : eb.lit(0)).as("isReserved"),
  ]).where("id", "=", input.loginId).compile();
}

export function claimIdentifierChangeQuery(db: Kysely<LoginChangeTables>, input: IdentifierSave): CompiledQuery {
  return claimLoginChangeQuery(db, {
    ...input, action: input.field === "email" ? "stms_email_changed" : "stms_username_changed", reason: null,
    matches: (eb) => eb.and([
      eb.or([eb(normalizedIdentifier(eb, input.field), "is", null), eb(normalizedIdentifier(eb, input.field), "!=", input.value)]),
      eb.not(identifierTaken(eb, input)),
      ...(input.field === "username" ? [eb.not(usernameReserved(eb, input.value))] : []),
    ]),
  });
}

export function readIdentifierSaveResult(results: D1Result<IdentifierState>[], value: string): IdentifierSaveResult {
  const [target, claim] = results;
  if (!target || !claim) throw new Error("The identifier batch returned an incomplete result.");
  const [row] = target.results;
  if (!row) return "missing";
  // The current login may itself be present in either namespace check.
  if (row.currentValue === value) return "unchanged";
  if (row.isReserved) return "reserved";
  if (row.isTaken) return "taken";
  if (claim.meta.changes !== 1) throw new Error("The eligible identifier change was not claimed.");
  return "saved";
}

export function normalizedIdentifier(eb: ExpressionBuilder<LoginChangeTables, "user">, field: IdentifierField): ExpressionWrapper<LoginChangeTables, "user", string | null> {
  // Match the native expression indexes exactly, including legacy outer spaces.
  return eb.fn<string | null>("lower", [eb.fn<string | null>("trim", [field])]);
}

function identifierTaken(eb: ExpressionBuilder<LoginChangeTables, "user">, input: IdentifierSave): ExpressionWrapper<LoginChangeTables, "user", SqlBool> {
  const column = input.field === "email" ? "candidate.email" : "candidate.username";
  return eb.exists(eb.selectFrom("user as candidate").select("candidate.id").where(({ fn, eb: compare }) =>
    compare(fn<string | null>("lower", [fn<string | null>("trim", [column])]), "=", input.value)));
}

function usernameReserved(eb: ExpressionBuilder<LoginChangeTables, "user">, username: string): ExpressionWrapper<LoginChangeTables, "user", SqlBool> {
  return eb.exists(eb.selectFrom("reserved_usernames").select("username").where("username", "=", username));
}
