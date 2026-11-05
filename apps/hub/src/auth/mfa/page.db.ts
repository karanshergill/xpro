import { createHubConnection, type RequestContext } from "@xpro/core/server";
import { sessionAccessQuery, type LoginAccessRow, type SessionAccessRow } from "#auth/validate-access.db.ts";
import type { MfaTables } from "./phases.db";

export type ChallengePageRow = Pick<LoginAccessRow, "loginId" | "role" | "banned" | "archivedAt" | "loginCreationId" | "creationLoginId" | "creationCompletedAt"> & {
  expiresAt: string; userAuthRevision: number; sourceRevision: number | null;
  twoFactorEnabled: number | null; factorId: string | null; factorVerified: number | null;
};

export async function readMfaSessionPage(database: D1Database, input: { token: string; context: RequestContext }): Promise<SessionAccessRow | undefined> {
  const db = (await createHubConnection<MfaTables>(database)).withoutPlugins();
  try {
    const session = await db.selectFrom("session").select(["id", "userId"]).where("token", "=", input.token).executeTakeFirst();
    return session ? (await sessionAccessQuery({ loginId: session.userId, hubSessionId: session.id, workspaceId: null, context: input.context }).execute(db)).rows[0] : undefined;
  } finally { await db.destroy(); }
}

export async function readMfaChallengePage(database: D1Database, identifier: string): Promise<ChallengePageRow | undefined> {
  const db = (await createHubConnection<MfaTables>(database)).withoutPlugins();
  try {
    return await db.selectFrom("verification as v").innerJoin("user as u", "u.id", "v.value")
      .leftJoin("twoFactor as f", "f.userId", "u.id").leftJoin("login_creations as c", "c.id", "u.login_creation_id")
      .select(["u.id as loginId", "u.role", "u.banned", "u.archived_at as archivedAt", "u.login_creation_id as loginCreationId",
        "c.created_login_id as creationLoginId", "c.completed_at as creationCompletedAt", "v.expiresAt", "u.auth_revision as userAuthRevision",
        "v.auth_revision as sourceRevision", "u.twoFactorEnabled", "f.id as factorId", "f.verified as factorVerified"])
      .where("v.identifier", "=", identifier).where("v.auth_revision", "is not", null).executeTakeFirst();
  } finally { await db.destroy(); }
}
