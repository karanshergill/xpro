import { createHubConnection, saveHub, type RequestContext } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { v7 as uuid } from "uuid";
import type { PreparedLoginCreation } from "./create-login.server";

// This native view keeps Better Auth's camelCase columns and xpro's physical names.
type Tables = {
  login_creations: { id: string; creator_login_id: string; organization_id: string | null; kind: string | null; details: string;
    created_login_id: string | null; completed_at: string | null };
  user: { id: string; login_creation_id: string | null; email: string; username: string | null; name: string; phone: string | null;
    role: string | null; banned: number | null; archived_at: string | null };
  account: { userId: string; accountId: string; providerId: string; password: string | null };
  member: { userId: string; organizationId: string };
  audit_entries: { id: string; action: string; outcome: string; actor_login_id: string; affected_login_id: string;
    reason: null; comment: null; request_id: string; created_at: string };
};
type CompletionSave = PreparedLoginCreation & { auditId: string; completedAt: string; context: RequestContext };

export async function saveCompletedCreation(database: D1Database, input: PreparedLoginCreation & { context: RequestContext }): Promise<boolean> {
  const db = (await createHubConnection<Tables>(database)).withoutPlugins();
  try {
    await saveHub(database, completionQueries(db, { ...input, auditId: uuid(), completedAt: new Date().toISOString() }));
    return (await db.executeQuery(completedCreationQuery(db, input))).rows.length > 0;
  } finally { await db.destroy(); }
}

export function completedCreationQuery(database: Kysely<Tables>, input: PreparedLoginCreation): CompiledQuery<{ created_login_id: string | null }> {
  return database.withoutPlugins().selectFrom("login_creations as c").innerJoin("user as u", "u.login_creation_id", "c.id")
    .select("c.created_login_id").where("c.id", "=", input.creation.id).where("u.id", "=", input.loginId)
    .where("c.created_login_id", "=", input.loginId).where("c.completed_at", "is not", null).compile();
}

export function completionQueries(database: Kysely<Tables>, input: CompletionSave): CompiledQuery[] {
  const db = database.withoutPlugins();
  const { creation, loginId, auditId, completedAt, context } = input;
  const { details } = creation;
  const ready = db.selectFrom("login_creations as c").innerJoin("user as u", "u.login_creation_id", "c.id")
    .innerJoin("account as a", (join) => join.onRef("a.userId", "=", "u.id").on("a.providerId", "=", "credential").onRef("a.accountId", "=", "u.id"))
    .leftJoin("member as m", "m.userId", "u.id")
    .where("c.id", "=", creation.id).where("c.creator_login_id", "=", creation.creatorLoginId)
    .where("c.details", "=", JSON.stringify(details)).where("c.created_login_id", "is", null).where("c.completed_at", "is", null)
    .where("u.id", "=", loginId).where("u.role", "=", "user").where("u.archived_at", "is", null)
    .where((eb) => eb.or([eb("u.banned", "is", null), eb("u.banned", "=", 0)]))
    .where("u.email", "=", details.email).where("u.username", "=", details.username).where("u.name", "=", details.name).where("u.phone", "=", details.phone)
    .where("a.password", "is not", null).where("a.password", "!=", "")
    .where("c.organization_id", creation.workspaceId === null ? "is" : "=", creation.workspaceId)
    .where("c.kind", creation.kind === null ? "is" : "=", creation.kind)
    .where(creation.workspaceId === null ? "m.userId" : "m.organizationId", creation.workspaceId === null ? "is" : "=", creation.workspaceId);
  const audit = db.insertInto("audit_entries")
    .columns(["id", "action", "outcome", "actor_login_id", "affected_login_id", "reason", "comment", "request_id", "created_at"])
    .expression(ready.select((eb) => [eb.val(auditId).as("id"), eb.val("accounts_login_created").as("action"), eb.val("success").as("outcome"),
      eb.val(creation.creatorLoginId).as("actor_login_id"), eb.val(loginId).as("affected_login_id"),
      eb.val(null).as("reason"), eb.val(null).as("comment"), eb.val(context.requestId).as("request_id"), eb.val(completedAt).as("created_at")])).compile();
  // Only this batch's winning audit may mark completion. A failed update rolls its audit back too.
  const complete = db.updateTable("login_creations").set({ created_login_id: loginId, completed_at: completedAt })
    .where("id", "=", creation.id).where("created_login_id", "is", null).where("completed_at", "is", null)
    .where((eb) => eb.exists(eb.selectFrom("audit_entries").select("id").where("id", "=", auditId))).compile();
  return [audit, complete];
}
