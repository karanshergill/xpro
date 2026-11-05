import { createHubConnection } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { maxWorkspaceChoices, type WorkspaceChoicePage, type WorkspaceChoice, type WorkspacePlacement } from "./placements";

type Tables = {
  organization: { id: string; name: string };
  workspacePlacements: { id: string; organizationId: string; workerName: string; createdAt: string };
  workspaceAddresses: { id: string; workspacePlacementId: string; origin: string; isPrimary: number; createdAt: string };
};

export function placementQuery(db: Kysely<Tables>, origin: string): CompiledQuery<WorkspacePlacement> {
  return db.selectFrom("workspaceAddresses").innerJoin("workspacePlacements", "workspacePlacements.id", "workspaceAddresses.workspacePlacementId")
    .select(["workspacePlacements.organizationId as workspaceId", "workspacePlacements.workerName", "workspaceAddresses.origin"])
    .where("workspaceAddresses.origin", "=", origin).compile();
}

export function workspaceOriginQuery(db: Kysely<Tables>, workspaceId: string): CompiledQuery<{ origin: string }> {
  return db.selectFrom("workspacePlacements").innerJoin("workspaceAddresses", "workspaceAddresses.workspacePlacementId", "workspacePlacements.id")
    .select("workspaceAddresses.origin").where("workspacePlacements.organizationId", "=", workspaceId).where("workspaceAddresses.isPrimary", "=", 1).compile();
}

export function workspacePlacementQuery(db: Kysely<Tables>, workspaceId: string): CompiledQuery<WorkspacePlacement> {
  return db.selectFrom("workspacePlacements").innerJoin("workspaceAddresses", "workspaceAddresses.workspacePlacementId", "workspacePlacements.id")
    .select(["workspacePlacements.organizationId as workspaceId", "workspacePlacements.workerName", "workspaceAddresses.origin"])
    .where("workspacePlacements.organizationId", "=", workspaceId).where("workspaceAddresses.isPrimary", "=", 1).compile();
}

export async function resolvePlacement(database: D1Database, origin: string): Promise<WorkspacePlacement | null> {
  const db = await createHubConnection<Tables>(database);
  try { return (await db.executeQuery(placementQuery(db, origin))).rows[0] ?? null; }
  finally { await db.destroy(); }
}

export async function readWorkspaceOrigin(database: D1Database, workspaceId: string): Promise<string | null> {
  const db = await createHubConnection<Tables>(database);
  try { return (await db.executeQuery(workspaceOriginQuery(db, workspaceId))).rows[0]?.origin ?? null; }
  finally { await db.destroy(); }
}

export async function readWorkspacePlacement(database: D1Database, workspaceId: string): Promise<WorkspacePlacement | null> {
  const db = await createHubConnection<Tables>(database);
  try { return (await db.executeQuery(workspacePlacementQuery(db, workspaceId))).rows[0] ?? null; }
  finally { await db.destroy(); }
}

export async function readWorkspaceChoices(database: D1Database, cursor?: string): Promise<WorkspaceChoicePage> {
  const db = await createHubConnection<Tables>(database);
  try {
    const rows = (await db.executeQuery(workspaceChoicesQuery(db, cursor))).rows;
    const shown = rows.slice(0, maxWorkspaceChoices), last = shown.at(-1);
    return { workspaces: shown.map((row) => ({ workspaceId: row.workspaceId, name: row.name, origin: row.origin })),
      nextCursor: rows.length > maxWorkspaceChoices && last ? last.cursor : null };
  } finally { await db.destroy(); }
}

export function workspaceChoicesQuery(db: Kysely<Tables>, cursor?: string): CompiledQuery<WorkspaceChoice & { cursor: string }> {
  let query = db.selectFrom("workspacePlacements")
    .innerJoin("organization", "organization.id", "workspacePlacements.organizationId")
    .select(["workspacePlacements.id as cursor", "organization.id as workspaceId", "organization.name"])
    .select((eb) => eb.selectFrom("workspaceAddresses").select("origin")
      .whereRef("workspaceAddresses.workspacePlacementId", "=", "workspacePlacements.id")
      .where("isPrimary", "=", 1).$asScalar().$notNull().as("origin"))
    .where((eb) => eb.exists(eb.selectFrom("workspaceAddresses").select("id")
      .whereRef("workspaceAddresses.workspacePlacementId", "=", "workspacePlacements.id").where("isPrimary", "=", 1)))
    // Seek the placement primary key on the first page too. Correlated address
    // lookups avoid scanning/sorting the entire shared primary-address index.
    .where("workspacePlacements.id", ">", "");
  if (cursor !== undefined) query = query.where("workspacePlacements.id", "<", cursor);
  return query.orderBy("workspacePlacements.id", "desc").limit(maxWorkspaceChoices + 1).compile();
}
