import { createHubConnection, saveHub } from "@xpro/core/server";
import { sql, type CompiledQuery, type Kysely } from "kysely";

export type PasswordResetTables = {
  user: { id: string; auth_revision: number };
  account: { id: string; userId: string; accountId: string; providerId: string; password: string | null; createdAt: string; updatedAt: string };
  session: { id: string; userId: string };
  verification: { id: string; value: string; auth_revision: number | null };
  oauthAccessToken: { id: string; userId: string | null; revoked: string | null };
  oauthRefreshToken: { id: string; userId: string; revoked: string | null };
  audit_entries: { id: string; action: string; outcome: string; actor_login_id: string; affected_login_id: string;
    reason: string | null; comment: string | null; request_id: string; created_at: string };
};
export type PasswordResetSave = {
  loginId: string; passwordHash: string; credentialId: string; auditId: string;
  actorLoginId: string; comment: string | null; requestId: string; createdAt: string;
};

export async function hasResetLogin(database: D1Database, loginId: string): Promise<boolean> {
  const db = await createHubConnection<PasswordResetTables>(database);
  try { return (await db.executeQuery(resetLoginQuery(db.withoutPlugins(), loginId))).rows.length > 0; }
  finally { await db.destroy(); }
}

export async function savePasswordReset(database: D1Database, input: PasswordResetSave): Promise<void> {
  const db = await createHubConnection<PasswordResetTables>(database);
  try { await saveHub(database, resetPasswordQueries(db.withoutPlugins(), input)); }
  finally { await db.destroy(); }
}

export function resetLoginQuery(db: Kysely<PasswordResetTables>, loginId: string): CompiledQuery<{ id: string }> {
  return db.selectFrom("user").select("id").where("id", "=", loginId).compile();
}

export function resetPasswordQueries(db: Kysely<PasswordResetTables>, input: PasswordResetSave): CompiledQuery[] {
  const { loginId, passwordHash, createdAt } = input;
  return [
    db.insertInto("account").values({ id: input.credentialId, userId: loginId, accountId: loginId,
      providerId: "credential", password: passwordHash, createdAt, updatedAt: createdAt })
      .onConflict((conflict) => conflict.column("userId").where("providerId", "=", sql.lit("credential"))
        .doUpdateSet({ password: passwordHash, updatedAt: createdAt })).compile(),
    db.updateTable("user").set((eb) => ({ auth_revision: eb("auth_revision", "+", 1) })).where("id", "=", loginId).compile(),
    db.deleteFrom("verification").where("value", "=", loginId).where("auth_revision", "is not", null).compile(),
    // Direct session deletion skips native hooks; revoke their tokens in this same batch.
    db.updateTable("oauthAccessToken").set({ revoked: createdAt }).where("userId", "=", loginId).where("revoked", "is", null).compile(),
    db.updateTable("oauthRefreshToken").set({ revoked: createdAt }).where("userId", "=", loginId).where("revoked", "is", null).compile(),
    // shortcut: rely on next-action Hub checks; add logout messages when idle screens must sign out immediately.
    db.deleteFrom("session").where("userId", "=", loginId).compile(),
    db.insertInto("audit_entries").values({ id: input.auditId, action: "stms_password_reset", outcome: "success",
      actor_login_id: input.actorLoginId, affected_login_id: loginId, reason: null, comment: input.comment,
      request_id: input.requestId, created_at: createdAt }).compile(),
  ];
}
