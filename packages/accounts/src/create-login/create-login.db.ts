import { createHubConnection, parseInput, saveHub, type CoreError } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { err, ok, type Result } from "true-myth/result";
import { check, nullable, picklist, pipe, strictObject, string, uuid } from "valibot";
import { emailSchema } from "#credentials/credentials.ts";
import { getMissingProfileFields, isValidUsername, nameSchema } from "#profile/profile.ts";

export type CreationDetails = { email: string; username: string; name: string; phone: string };
type WorkspaceTarget = { workspaceId: null; kind: null } | { workspaceId: string; kind: "internal" | "external" };
export type LoginCreation = WorkspaceTarget & {
  id: string; creatorLoginId: string; details: CreationDetails;
  createdLoginId: string | null; createdAt: string; completedAt: string | null;
};
export type CreationError = Extract<CoreError, { code: "core_invalid_input" }> | { code: "core_forbidden" } | { code: "accounts_creation_conflict" };
type StoredCreation = {
  id: string; creatorLoginId: string; organizationId: string | null; kind: "internal" | "external" | null;
  details: string; createdLoginId: string | null; createdAt: string; completedAt: string | null;
};
export type CreatedLogin = {
  loginId: string; email: string; username: string | null; name: string; phone: string | null;
  role: string | null; banned: number | null; archivedAt: string | null;
};
type Tables = { loginCreations: StoredCreation; user: Omit<CreatedLogin, "loginId"> & { id: string; loginCreationId: string | null };
  organization: { id: string }; member: { userId: string; organizationId: string; role: string } };
const identifierSchema = pipe(string(), uuid());
const entries = {
  creationId: identifierSchema, creatorLoginId: identifierSchema, workspaceId: nullable(identifierSchema),
  kind: nullable(picklist(["internal", "external"])),
  details: pipe(strictObject({
    email: emailSchema, username: pipe(string(), check(isValidUsername)), name: nameSchema, phone: string(),
  }), check((profile) => getMissingProfileFields(profile).length === 0)),
};

export async function prepareLoginCreation(database: D1Database, input: unknown): Promise<Result<LoginCreation, CreationError>> {
  const parsed = parseInput(input, entries);
  if (parsed.isErr) return err(parsed.error);
  const intent = parsed.value;
  if (!hasValidWorkspaceTarget(intent)) return err({ code: "core_invalid_input", fields: ["workspaceId", "kind"] });
  // Project in a fixed order: retries compare canonical non-secret details, never credentials.
  const details = { email: intent.details.email, username: intent.details.username, name: intent.details.name, phone: intent.details.phone };
  const row: StoredCreation = { id: intent.creationId, creatorLoginId: intent.creatorLoginId,
    organizationId: intent.workspaceId, kind: intent.kind, details: JSON.stringify(details),
    createdLoginId: null, createdAt: new Date().toISOString(), completedAt: null };
  const db = await createHubConnection<Tables>(database);
  try {
    const [inserted] = await saveHub(database, [db.insertInto("loginCreations").values(row)
      .onConflict((conflict) => conflict.column("id").doNothing()).compile()]);
    // A fresh claim needs one binding call. A repeat reads the existing record without updating it.
    const saved = inserted.meta.changes === 1 ? row : (await db.executeQuery(loginCreationQuery(db, row.id))).rows[0];
    if (!saved) throw new Error("The login creation request was not saved.");
    if (saved.creatorLoginId !== row.creatorLoginId) return err({ code: "core_forbidden" });
    if (!matchesIntent(saved, row)) return err({ code: "accounts_creation_conflict" });
    const target: WorkspaceTarget = intent.workspaceId === null ? { workspaceId: null, kind: null }
      : { workspaceId: intent.workspaceId, kind: intent.kind };
    return ok({ ...target, id: saved.id, creatorLoginId: saved.creatorLoginId,
      details, createdLoginId: saved.createdLoginId, createdAt: saved.createdAt, completedAt: saved.completedAt });
  } finally { await db.destroy(); }
}

export async function readCreatedLogin(database: D1Database, creationId: string): Promise<CreatedLogin | null> {
  const db = await createHubConnection<Tables>(database);
  try { return (await db.executeQuery(creationLoginQuery(db, creationId))).rows[0] ?? null; }
  finally { await db.destroy(); }
}

export async function hasCreationEmail(database: D1Database, email: string): Promise<boolean> {
  const db = await createHubConnection<Tables>(database);
  try { return (await db.executeQuery(creationEmailQuery(db, email))).rows.length > 0; }
  finally { await db.destroy(); }
}

export async function hasCreationWorkspace(database: D1Database, workspaceId: string): Promise<boolean> {
  const db = await createHubConnection<Tables>(database);
  try { return (await db.executeQuery(creationWorkspaceQuery(db, workspaceId))).rows.length > 0; }
  finally { await db.destroy(); }
}

export async function readCreationMembership(database: D1Database, loginId: string): Promise<{ workspaceId: string; role: string } | null> {
  const db = await createHubConnection<Tables>(database);
  try { return (await db.executeQuery(creationMembershipQuery(db, loginId))).rows[0] ?? null; }
  finally { await db.destroy(); }
}

export function loginCreationQuery(db: Kysely<Tables>, creationId: string): CompiledQuery<StoredCreation> {
  return db.selectFrom("loginCreations").selectAll().where("id", "=", creationId).compile();
}

export function creationLoginQuery(db: Kysely<Tables>, creationId: string): CompiledQuery<CreatedLogin> {
  return db.selectFrom("user").select(["id as loginId", "email", "username", "name", "phone", "role", "banned", "archivedAt"])
    .where("loginCreationId", "=", creationId).compile();
}

export function creationEmailQuery(db: Kysely<Tables>, email: string): CompiledQuery<{ id: string }> {
  return db.selectFrom("user").select("id").where(({ eb, fn }) =>
    eb(fn<string>("lower", [fn<string>("trim", ["email"])]), "=", email)).compile();
}

export function creationWorkspaceQuery(db: Kysely<Tables>, workspaceId: string): CompiledQuery<{ id: string }> {
  return db.selectFrom("organization").select("id").where("id", "=", workspaceId).compile();
}

export function creationMembershipQuery(db: Kysely<Tables>, loginId: string): CompiledQuery<{ workspaceId: string; role: string }> {
  // Native Better Auth fields keep their camelCase names.
  return db.withoutPlugins().selectFrom("member").select(["organizationId as workspaceId", "role"])
    .where("userId", "=", loginId).compile();
}

function hasValidWorkspaceTarget(input: { workspaceId: string | null; kind: "internal" | "external" | null }): input is WorkspaceTarget {
  return input.workspaceId === null ? input.kind === null : input.kind !== null;
}

function matchesIntent(saved: StoredCreation, submitted: StoredCreation): boolean {
  return saved.organizationId === submitted.organizationId
    && saved.kind === submitted.kind && saved.details === submitted.details;
}
