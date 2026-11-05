import { createHubConnection } from "@xpro/core/server";
import { sql, type CompiledQuery, type Kysely, type RawBuilder } from "kysely";

type Tables = {
  organization: { id: string };
};

type Destinations = { workspaceId: string | null; accountId: string | null };

export function destinationQuery(loginId: string): RawBuilder<Destinations> {
  // One statement keeps the native membership and xpro account lookup together.
  return sql<Destinations>`select
    (select "organizationId" from member where "userId" = ${loginId}) as "workspaceId",
    (select id from accounts where owner_login_id = ${loginId} limit 1) as "accountId"`;
}

export function requestedWorkspaceQuery(db: Kysely<Tables>, workspaceId: string): CompiledQuery<{ id: string }> {
  return db.selectFrom("organization").select("id").where("id", "=", workspaceId).compile();
}

export async function readDestinations(database: D1Database, input: { loginId: string; requestedWorkspaceId?: string }): Promise<Destinations & { requestedWorkspaceId: string | undefined }> {
  const db = await createHubConnection<Tables>(database);
  try {
    const own = (await destinationQuery(input.loginId).execute(db.withoutPlugins())).rows[0];
    if (!own) throw new Error("Destination query returned no result.");
    const requested = input.requestedWorkspaceId
      ? (await db.executeQuery(requestedWorkspaceQuery(db, input.requestedWorkspaceId))).rows[0] : undefined;
    return { ...own, requestedWorkspaceId: requested?.id };
  } finally { await db.destroy(); }
}
