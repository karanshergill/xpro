import { createHubConnection } from "@xpro/core/server";
import { sql, type CompiledQuery, type Kysely } from "kysely";

type Tables = {
  accounts: { id: string; owner_login_id: string; name: string | null };
  organization: { id: string; name: string };
  member: { id: string; organizationId: string; role: string };
  workspaces: { id: string; account_id: string };
  workspace_creations: { id: string; workspace_id: string };
};
type IssueCode = "stms_duplicate_account_holder" | "stms_missing_account_name"
  | "stms_missing_workspace_name" | "stms_missing_workspace_account"
  | "stms_workspace_owner_review" | "stms_missing_workspace_creation";
type Issue = { code: IssueCode; recordIds: string[]; hasMore: boolean };
export type AccountWorkspacePreflight =
  | { status: "uninitialized"; missingTables: string[] }
  | { status: "clear" | "needs_review"; issues: Issue[] };
type Check = { code: IssueCode; query: CompiledQuery<{ id: string }> };
const reportLimit = 100;
const requiredTables = ["accounts", "organization", "member"] as const;
const nameWhitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

export async function readAccountWorkspacePreflight(database: D1Database): Promise<AccountWorkspacePreflight> {
  const connection = await createHubConnection<Tables>(database);
  const db = connection.withoutPlugins();
  try {
    const tables = await db.introspection.getTables();
    const missingTables = requiredTables.filter((name) => !tables.some((table) => table.name === name));
    if (missingTables.length > 0) return { status: "uninitialized", missingTables };
    const hasAccountNames = tables.some((table) => table.name === "accounts"
      && table.columns.some((column) => column.name === "name"));
    const hasWorkspaces = tables.some((table) => table.name === "workspaces");
    const hasCreations = tables.some((table) => table.name === "workspace_creations");
    const checks = prepareChecks(db, { hasAccountNames, hasWorkspaces, hasCreations });
    const issues: Issue[] = [];
    for (const check of checks) {
      const { rows } = await db.executeQuery(check.query);
      if (rows.length > 0) issues.push({ code: check.code,
        recordIds: rows.slice(0, reportLimit).map((row) => row.id), hasMore: rows.length > reportLimit });
    }
    return { status: issues.length === 0 ? "clear" : "needs_review", issues };
  } finally {
    await connection.destroy();
  }
}

function prepareChecks(db: Kysely<Tables>, schema: {
  hasAccountNames: boolean; hasWorkspaces: boolean; hasCreations: boolean;
}): Check[] {
  let missingNames = db.selectFrom("accounts").select("id");
  if (schema.hasAccountNames) missingNames = missingNames.where((eb) => eb.or([
    eb("name", "is", null), sql<boolean>`trim(name, ${nameWhitespace}) = ''`,
  ]));
  let unmappedWorkspaces = db.selectFrom("organization").select("organization.id");
  if (schema.hasWorkspaces) unmappedWorkspaces = unmappedWorkspaces.where((eb) => eb.not(eb.exists(
    eb.selectFrom("workspaces").innerJoin("accounts", "accounts.id", "workspaces.account_id")
      .select("workspaces.id").whereRef("workspaces.id", "=", "organization.id"),
  )));
  const checks: Check[] = [
    { code: "stms_duplicate_account_holder", query: db.selectFrom("accounts as candidate")
      .select("candidate.id").where((eb) => eb.exists(eb.selectFrom("accounts as other").select("other.id")
        .whereRef("other.owner_login_id", "=", "candidate.owner_login_id")
        .whereRef("other.id", "!=", "candidate.id")))
      .orderBy("candidate.id").limit(reportLimit + 1).compile() },
    { code: "stms_missing_account_name", query: missingNames.orderBy("id").limit(reportLimit + 1).compile() },
    { code: "stms_missing_workspace_name", query: db.selectFrom("organization").select("id")
      .where(sql<boolean>`trim(name, ${nameWhitespace}) = ''`).orderBy("id").limit(reportLimit + 1).compile() },
    { code: "stms_missing_workspace_account", query: unmappedWorkspaces.orderBy("organization.id")
      .limit(reportLimit + 1).compile() },
    { code: "stms_workspace_owner_review", query: unmappedWorkspaces.where((eb) => eb(
      eb.selectFrom("member").select(({ fn }) => fn.countAll<number>().as("count"))
        .whereRef("member.organizationId", "=", "organization.id")
        .where(sql<boolean>`instr(',' || role || ',', ',owner,') > 0`), "!=", 1,
    )).orderBy("organization.id").limit(reportLimit + 1).compile() },
  ];
  if (schema.hasWorkspaces) {
    let missingCreations = db.selectFrom("workspaces").select("id");
    if (schema.hasCreations) missingCreations = missingCreations.where((eb) => eb.not(eb.exists(
      eb.selectFrom("workspace_creations").select("workspace_creations.id")
        .whereRef("workspace_creations.workspace_id", "=", "workspaces.id"),
    )));
    checks.push({ code: "stms_missing_workspace_creation",
      query: missingCreations.orderBy("id").limit(reportLimit + 1).compile() });
  }
  return checks;
}
