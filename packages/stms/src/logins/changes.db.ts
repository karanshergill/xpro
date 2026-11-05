import { expressionBuilder, type CompiledQuery, type Expression, type ExpressionBuilder, type Kysely, type SqlBool } from "kysely";

export type LoginChangeSave = {
  loginId: string; auditId: string; actorLoginId: string; requestId: string; createdAt: string;
};
export type LoginChangeTables = {
  user: { id: string; banned: number | null; banReason: string | null; banExpires: string | null;
    archived_at: string | null; status_before_archiving: string | null; updatedAt: string;
    email: string; emailVerified: number; username: string | null; displayUsername: string | null; auth_revision: number };
  reserved_usernames: { id: string; username: string; added_at: string };
  session: { id: string; userId: string };
  verification: { id: string; value: string; auth_revision: number | null };
  oauthAccessToken: { id: string; userId: string | null; revoked: string | null };
  oauthRefreshToken: { id: string; userId: string; revoked: string | null };
  audit_entries: { id: string; action: string; outcome: string; actor_login_id: string; affected_login_id: string;
    reason: string | null; comment: string | null; request_id: string; created_at: string };
};
type Claim = LoginChangeSave & {
  action: "stms_login_suspended" | "stms_login_reactivated" | "stms_login_archived" | "stms_login_restored";
  reason: string | null; comment: string | null;
};
export type LoginStatusSaveResult = "saved" | "missing" | "conflict";

export function loginStatusTargetQuery(db: Kysely<LoginChangeTables>, loginId: string): CompiledQuery<{ id: string }> {
  return db.selectFrom("user").select("id").where("id", "=", loginId).compile();
}

export function claimLoginStatusQuery(db: Kysely<LoginChangeTables>, input: Claim): CompiledQuery {
  return claimLoginChangeQuery(db, { ...input, matches: (eb) => canClaimLoginStatus(eb, input.action) });
}

type ChangeClaim = LoginChangeSave & {
  action: Claim["action"] | "stms_email_changed" | "stms_username_changed";
  reason: string | null; comment: string | null;
  matches: (eb: ExpressionBuilder<LoginChangeTables, "user">) => Expression<SqlBool>;
};

export function claimLoginChangeQuery(db: Kysely<LoginChangeTables>, input: ChangeClaim): CompiledQuery {
  // A new conditional audit row claims the change inside this transaction.
  // An ineligible or concurrently changed target creates no claim and no later writes.
  return db.insertInto("audit_entries")
    .columns(["id", "action", "outcome", "actor_login_id", "affected_login_id", "reason", "comment", "request_id", "created_at"])
    .expression(db.selectFrom("user").select((eb) => [
      eb.val(input.auditId).as("id"), eb.val(input.action).as("action"), eb.val("success").as("outcome"),
      eb.val(input.actorLoginId).as("actor_login_id"), eb.val(input.loginId).as("affected_login_id"),
      eb.val(input.reason).as("reason"), eb.val(input.comment).as("comment"),
      eb.val(input.requestId).as("request_id"), eb.val(input.createdAt).as("created_at"),
    ]).where("id", "=", input.loginId).where(input.matches)).compile();
}

export function hasLoginChangeClaim(auditId: string): Expression<SqlBool> {
  const eb = expressionBuilder<LoginChangeTables>();
  return eb.exists(eb.selectFrom("audit_entries").select("id").where("id", "=", auditId));
}

export function readLoginStatusSaveResult(results: D1Result[]): LoginStatusSaveResult {
  const [target, claim] = results;
  if (!target || !claim) throw new Error("The login status batch returned an incomplete result.");
  if (target.results.length === 0) return "missing";
  return claim.meta.changes === 1 ? "saved" : "conflict";
}

export function revokeLoginAccessQueries(db: Kysely<LoginChangeTables>, input: LoginChangeSave): CompiledQuery[] {
  const claimed = hasLoginChangeClaim(input.auditId);
  return [
    db.updateTable("user").set((eb) => ({ auth_revision: eb("auth_revision", "+", 1) }))
      .where("id", "=", input.loginId).where(claimed).compile(),
    db.deleteFrom("verification").where("value", "=", input.loginId).where("auth_revision", "is not", null).where(claimed).compile(),
    // Direct deletion skips native provider hooks; revoke tokens in this same batch.
    db.updateTable("oauthAccessToken").set({ revoked: input.createdAt }).where("userId", "=", input.loginId)
      .where("revoked", "is", null).where(claimed).compile(),
    db.updateTable("oauthRefreshToken").set({ revoked: input.createdAt }).where("userId", "=", input.loginId)
      .where("revoked", "is", null).where(claimed).compile(),
    // shortcut: live Hub checks stop the next action; add logout messages when idle screens must sign out immediately.
    db.deleteFrom("session").where("userId", "=", input.loginId).where(claimed).compile(),
  ];
}

function canClaimLoginStatus(eb: ExpressionBuilder<LoginChangeTables, "user">, action: Claim["action"]): Expression<SqlBool> {
  const active = eb.or([eb("banned", "=", 0), eb("banned", "is", null)]);
  const suspended = eb("banned", "=", 1);
  const unarchived = eb("archived_at", "is", null);
  switch (action) {
    case "stms_login_suspended": return eb.and([unarchived, active]);
    case "stms_login_reactivated": return eb.and([unarchived, suspended]);
    case "stms_login_archived": return unarchived;
    case "stms_login_restored":
      // Keep the retained native suspension/reason, and refuse inconsistent history.
      return eb.and([eb("archived_at", "is not", null), eb.or([
        eb.and([eb("status_before_archiving", "=", "active"), active]),
        eb.and([eb("status_before_archiving", "=", "suspended"), suspended]),
      ])]);
    default: {
      const unhandled: never = action;
      throw new Error("Unsupported login status action.", { cause: unhandled });
    }
  }
}
