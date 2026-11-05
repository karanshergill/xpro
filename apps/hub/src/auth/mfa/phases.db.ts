import { saveHub } from "@xpro/core/server";
import { expressionBuilder, type CompiledQuery, type Expression, type Kysely, type SelectQueryBuilder, type SqlBool } from "kysely";
import { refuseMfaWrite } from "./context.db";

export type NativeFactor = { id: string; userId: string; secret: string; backupCodes: string;
  verified: number | null; failedVerificationCount: number | null; lockedUntil: string | null };
// This view names native columns directly; it uses the existing adapter's executor without plugins.
export type MfaTables = {
  user: { id: string; role: string | null; banned: number | null; archived_at: string | null;
    login_creation_id: string | null; auth_revision: number; twoFactorEnabled: number | null; updatedAt: string };
  session: { id: string; userId: string; token: string; expiresAt: string; auth_revision: number; mfa_verified_at: string | null };
  account: { id: string; userId: string; providerId: string; password: string | null; updatedAt: string };
  verification: { id: string; identifier: string; value: string; expiresAt: string; auth_revision: number | null };
  twoFactor: NativeFactor;
  login_creations: { id: string; created_login_id: string | null; completed_at: string | null };
  audit_entries: { id: string; action: string; outcome: string; actor_login_id: string | null; affected_login_id: string | null;
    reason: string | null; comment: string | null; request_id: string; created_at: string };
  oauthAccessToken: { id: string; userId: string | null; revoked: string | null };
  oauthRefreshToken: { id: string; userId: string; revoked: string | null };
};
type OperationSource = {
  userId: string; role: string | null; revision: number; enabled: boolean;
  actor: { id: string; expiresAt: string; mfaAt: string | null } | null;
  challenge: { id: string; identifier: string; expiresAt: string } | null;
  factor: NativeFactor | null; consumed: boolean;
  auditId: string; requestId: string;
};
export type MfaOperation = OperationSource & (
  | { kind: "setup" | "activate" | "verify" | "disable" | "backups"; phase: "running" | "activated" | "disabled" }
  | { kind: "password"; phase: "running" | "sessions_ended" | "password_saved"; account: { id: string; password: string | null } | null }
);
export type MfaStorage = { db: Kysely<MfaTables>; database: D1Database };
const recentMfaMilliseconds = 300_000;

export async function readMfaSnapshot(db: Kysely<MfaTables>, input: { loginId: string; sessionId: string | null }): Promise<{
  user: MfaTables["user"]; actor: MfaTables["session"] | null; factor: NativeFactor | null;
} | null> {
  const user = await db.selectFrom("user").selectAll().where("id", "=", input.loginId).executeTakeFirst();
  if (!user) return null;
  const actor = input.sessionId ? await db.selectFrom("session").selectAll().where("id", "=", input.sessionId).executeTakeFirst() ?? null : null;
  const factor = await db.selectFrom("twoFactor").selectAll().where("userId", "=", input.loginId).executeTakeFirst() ?? null;
  return { user, actor, factor };
}

export async function readMfaChallenge(db: Kysely<MfaTables>, id: string): Promise<MfaTables["verification"] | undefined> {
  return await db.selectFrom("verification").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function readPasswordAccount(db: Kysely<MfaTables>, loginId: string): Promise<Pick<MfaTables["account"], "id" | "password"> | undefined> {
  return await db.selectFrom("account").select(["id", "password"]).where("userId", "=", loginId)
    .where("providerId", "=", "credential").executeTakeFirst();
}

export function currentMfaSource(db: Kysely<MfaTables>, value: MfaOperation): SelectQueryBuilder<MfaTables, "user", {}> {
  const now = new Date().toISOString();
  let query = db.selectFrom("user").where("id", "=", value.userId)
    .where("auth_revision", "=", value.revision).where("archived_at", "is", null)
    .where((eb) => eb.or([eb("banned", "is", null), eb("banned", "=", 0)]))
    .where((eb) => eb.or([eb("login_creation_id", "is", null), eb.exists(eb.selectFrom("login_creations").select("id")
      .whereRef("login_creations.id", "=", "user.login_creation_id").whereRef("login_creations.created_login_id", "=", "user.id")
      .where("completed_at", "is not", null))]));
  query = value.role === null ? query.where("role", "is", null) : query.where("role", "=", value.role);
  const actor = value.actor, challenge = value.challenge, factor = value.factor;
  const requiresFactor = value.kind !== "password" || (value.role?.split(",").includes("admin") ?? false);
  if (actor) {
    if (!(actor.expiresAt > now)) refuseMfaWrite();
    if (value.kind === "password" && requiresFactor && (!actor.mfaAt || actor.mfaAt > now)) refuseMfaWrite();
    if (value.phase === "running") {
      let original = db.selectFrom("session").select("id").where("id", "=", actor.id).where("userId", "=", value.userId)
        .where("auth_revision", "=", value.revision).where("expiresAt", ">", now);
      if (value.kind === "password") original = actor.mfaAt === null ? original.where("mfa_verified_at", "is", null)
        : original.where("mfa_verified_at", "=", actor.mfaAt);
      query = query.where((eb) => eb.exists(original));
    }
    if (value.phase === "running" && (value.kind === "backups" || value.kind === "disable" && value.enabled)) {
      if (actor.mfaAt === null) refuseMfaWrite();
      query = query.where((eb) => eb.exists(db.selectFrom("session").select("id").where("id", "=", actor.id)
        .where("mfa_verified_at", "=", actor.mfaAt).where("mfa_verified_at", "<=", now)
        .where("mfa_verified_at", ">=", new Date(Date.now() - recentMfaMilliseconds).toISOString())));
    }
  } else if (challenge) {
    if (!(challenge.expiresAt > now)) refuseMfaWrite();
    if (!value.consumed) query = query.where((eb) => eb.exists(db.selectFrom("verification").select("id")
      .where("id", "=", challenge.id).where("identifier", "=", challenge.identifier).where("value", "=", value.userId)
      .where("auth_revision", "=", value.revision).where("expiresAt", ">", now)));
  } else refuseMfaWrite();
  if (factor && value.phase !== "disabled" && requiresFactor) {
    let selected = db.selectFrom("twoFactor").select("id").where("id", "=", factor.id).where("userId", "=", value.userId)
      .where("secret", "=", factor.secret);
    const verified = value.phase === "activated" ? 1 : factor.verified;
    selected = verified === null ? selected.where("verified", "is", null) : selected.where("verified", "=", verified);
    if (value.kind === "backups") selected = selected.where("backupCodes", "=", factor.backupCodes);
    query = query.where((eb) => eb.exists(selected));
  }
  if (value.phase === "disabled" || value.kind === "setup") query = query.where((eb) => eb.not(eb.exists(
    db.selectFrom("twoFactor").select("id").where("userId", "=", value.userId))));
  if (value.kind === "password" && value.phase !== "password_saved" && value.account) {
    let credential = db.selectFrom("account").select("id").where("id", "=", value.account.id).where("userId", "=", value.userId)
      .where("providerId", "=", "credential");
    credential = value.account.password === null ? credential.where("password", "is", null) : credential.where("password", "=", value.account.password);
    query = query.where((eb) => eb.exists(credential));
  }
  return requiresFactor ? query.where("twoFactorEnabled", "=", value.phase === "activated" ? 1 : value.phase === "disabled" ? 0 : Number(value.enabled)) : query;
}

export async function assertMfaSource(db: Kysely<MfaTables>, value: MfaOperation): Promise<void> {
  if (!await currentMfaSource(db, value).select("id").executeTakeFirst()) refuseMfaWrite();
}

export async function completeMfaSession(db: Kysely<MfaTables>, input: { operation: MfaOperation; sessionId: string }): Promise<void> {
  const { operation: value, sessionId: id } = input;
  const now = new Date().toISOString();
  const verifiedAt = value.kind === "password" ? value.actor?.mfaAt ?? null : now;
  const saved = await db.updateTable("session").set({ mfa_verified_at: verifiedAt }).where("id", "=", id)
    .where("userId", "=", value.userId).where("auth_revision", "=", value.revision).where("mfa_verified_at", "is", null)
    .where("expiresAt", ">", now).where((eb) => eb.exists(currentMfaSource(db, value).select("id")))
    .returning("id").executeTakeFirst();
  if (!saved) refuseMfaWrite();
}

export function mfaAuditClaim(db: Kysely<MfaTables>, input: { operation: MfaOperation; action: string }): CompiledQuery {
  const { operation: value, action } = input;
  return db.insertInto("audit_entries").columns(["id", "action", "outcome", "actor_login_id", "affected_login_id",
    "reason", "comment", "request_id", "created_at"]).expression(currentMfaSource(db, value).select((eb) => [
    eb.val(value.auditId).as("id"), eb.val(action).as("action"), eb.val("success").as("outcome"),
    eb.val(value.userId).as("actor_login_id"), eb.val(value.userId).as("affected_login_id"),
    eb.val(null).as("reason"), eb.val(null).as("comment"), eb.val(value.requestId).as("request_id"),
    eb.val(new Date().toISOString()).as("created_at"),
  ])).compile();
}

export function mfaPhaseClaim(db: Kysely<MfaTables>, value: MfaOperation): Expression<SqlBool> {
  return expressionBuilder<MfaTables>().exists(db.selectFrom("audit_entries").select("id").where("id", "=", value.auditId));
}

export function mfaRevocations(db: Kysely<MfaTables>, value: MfaOperation): CompiledQuery[] {
  const claimed = mfaPhaseClaim(db, value), now = new Date().toISOString();
  return [
    db.updateTable("oauthAccessToken").set({ revoked: now }).where("userId", "=", value.userId).where("revoked", "is", null).where(claimed).compile(),
    db.updateTable("oauthRefreshToken").set({ revoked: now }).where("userId", "=", value.userId).where("revoked", "is", null).where(claimed).compile(),
    db.deleteFrom("session").where("userId", "=", value.userId).where(claimed).compile(),
    db.deleteFrom("verification").where("value", "=", value.userId).where("auth_revision", "is not", null).where(claimed).compile(),
  ];
}

export async function commitMfaPhase(storage: MfaStorage, queries: Parameters<typeof saveHub>[1]): Promise<void> {
  const result = await saveHub(storage.database, queries);
  if (result[0]?.meta.changes !== 1) refuseMfaWrite();
}
