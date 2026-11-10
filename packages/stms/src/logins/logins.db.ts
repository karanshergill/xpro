import { normalizeSearchText } from "@xpro/accounts";
import { createHubConnection } from "@xpro/core/server";
import { sql, type CompiledQuery, type Kysely, type SqlBool, type Expression, type RawBuilder } from "kysely";
import { prefixRange, type PrefixRange } from "#prefix-range.ts";
import type { LoginPageInput, LoginSearchInput } from "./input";
import type { LoginDetails, LoginSummary } from "./logins";

export type LoginsTables = {
  user: { id: string; username: string | null; name: string; name_search: string | null; email: string;
    phone: string | null; createdAt: string; archived_at: string | null; banned: number | null };
  member: { userId: string; organizationId: string };
  organization: { id: string; name: string };
};
type DetailRow = LoginSummary & { workspaceId: string | null; workspaceName: string | null };

export async function readLogins(database: D1Database, input: LoginPageInput): Promise<LoginSummary[]> {
  const db = await createHubConnection<LoginsTables>(database);
  try { return (await db.withoutPlugins().executeQuery(listLoginsQuery(db, input))).rows; }
  finally { await db.destroy(); }
}

export async function searchLogins(database: D1Database, input: LoginSearchInput): Promise<LoginSummary[]> {
  const db = await createHubConnection<LoginsTables>(database);
  try { return (await db.withoutPlugins().executeQuery(searchLoginsQuery(db, input))).rows; }
  finally { await db.destroy(); }
}

export async function readLogin(database: D1Database, loginId: string): Promise<LoginDetails | undefined> {
  const db = await createHubConnection<LoginsTables>(database);
  try {
    const { rows: [row] } = await db.withoutPlugins().executeQuery(loginDetailQuery(db, loginId));
    if (!row) return undefined;
    const { workspaceId, workspaceName, ...login } = row;
    return { ...login, workspace: workspaceId !== null && workspaceName !== null ? { workspaceId, name: workspaceName } : null };
  } finally { await db.destroy(); }
}

export function listLoginsQuery(db: Kysely<LoginsTables>, input: LoginPageInput): CompiledQuery<LoginSummary> {
  // shortcut: offset paging reads skipped rows; use seek cursors when large
  // directories make deep pages costly. The approved initial contract uses offsets.
  return summaryQuery(db).where("user.archived_at", "is", null)
    .orderBy("user.createdAt", "desc").orderBy("user.id", "desc").limit(input.limit + 1).offset(input.offset).compile();
}

export function searchLoginsQuery(db: Kysely<LoginsTables>, input: LoginSearchInput): CompiledQuery<LoginSummary> {
  const range = prefixRange(normalizeSearchText(input.query));
  const native = db.withoutPlugins();
  // Separate indexed branches avoid choosing a broad active-user scan for OR.
  // Ranges also avoid D1's 50-byte LIKE limit and need no wildcard escaping.
  const candidates = native.selectFrom("user").select("id").where((eb) => prefixMatch(eb.ref("name_search"), range))
    .union(native.selectFrom("user").select("id").where((eb) =>
      prefixMatch(eb.fn<string>("lower", [eb.fn<string>("trim", ["email"])]), range)))
    .union(native.selectFrom("user").select("id").where((eb) =>
      prefixMatch(eb.fn<string>("lower", [eb.fn<string>("trim", ["username"])]), range)));
  return summaryQuery(db).where("user.archived_at", "is", null).where("user.id", "in", candidates)
    .orderBy("user.createdAt", "desc").orderBy("user.id", "desc").limit(input.limit + 1).offset(input.offset).compile();
}

export function loginDetailQuery(db: Kysely<LoginsTables>, loginId: string): CompiledQuery<DetailRow> {
  return summaryQuery(db).leftJoin("member", "member.userId", "user.id")
    .leftJoin("organization", "organization.id", "member.organizationId")
    .select(["organization.id as workspaceId", "organization.name as workspaceName"]).where("user.id", "=", loginId).compile();
}

function summaryQuery(db: Kysely<LoginsTables>) {
  // Physical native names and explicit columns keep private fields out of these DTOs.
  return db.withoutPlugins().selectFrom("user").select([
    "user.id as loginId", "user.username", "user.name", "user.email", "user.phone", "user.createdAt",
  ]).select((eb) => eb.case().when("user.archived_at", "is not", null).then("archived" as const)
    .when("user.banned", "=", 1).then("suspended" as const).else("active" as const).end().as("status"));
}

function prefixMatch(value: Expression<string | null>, range: PrefixRange): RawBuilder<SqlBool> {
  return range.upper === null ? sql<SqlBool>`${value} >= ${range.lower}`
    : sql<SqlBool>`${value} >= ${range.lower} and ${value} < ${range.upper}`;
}
