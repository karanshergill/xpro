import { createHubConnection } from "@xpro/core/server";
import type { CompiledQuery, Kysely, SqlBool } from "kysely";
import { err, ok, type Result } from "true-myth/result";
import { isValidUsername } from "#profile/profile.ts";

type UsernameTables = { user: { username: string | null }; reservedUsernames: { username: string } };
type Availability = { isTaken: SqlBool; isReserved: SqlBool };
export type UsernameError = { code: "accounts_username_invalid" | "accounts_username_taken" | "accounts_username_reserved" };

export async function checkUsername(database: D1Database, input: unknown): Promise<Result<{ username: string }, UsernameError>> {
  if (typeof input !== "string" || !isValidUsername(input)) return err({ code: "accounts_username_invalid" });
  const db = await createHubConnection<UsernameTables>(database);
  try {
    const { rows: [availability] } = await db.executeQuery(usernameAvailabilityQuery(db, input));
    if (availability.isReserved) return err({ code: "accounts_username_reserved" });
    if (availability.isTaken) return err({ code: "accounts_username_taken" });
    return ok({ username: input });
  } finally { await db.destroy(); }
}

export function usernameAvailabilityQuery(db: Kysely<UsernameTables>, username: string): CompiledQuery<Availability> {
  return db.selectNoFrom(({ exists, selectFrom }) => [
    exists(selectFrom("user").select("username").where(({ eb, fn }) =>
      eb(fn<string>("lower", [fn<string>("trim", ["username"])]), "=", username))).as("isTaken"),
    exists(selectFrom("reservedUsernames").select("username").where("username", "=", username)).as("isReserved"),
  ]).compile();
}
