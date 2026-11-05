import { sql, type RawBuilder } from "kysely";
import { createHubDatabase } from "#db/hub.db.ts";
import type { HubAccessInput } from "@xpro/core/server";

export type LoginAccessRow = {
  loginId: string; role: string | null; name: string; username: string | null; phone: string | null;
  banned: number | null; archivedAt: string | null; loginCreationId: string | null;
  creationLoginId: string | null; creationCompletedAt: string | null;
};
export type SessionAccessRow = LoginAccessRow & {
  expiresAt: string; membershipRole: string | null; userAuthRevision: number; sessionAuthRevision: number;
  twoFactorEnabled: number | null; factorId: string | null; factorVerified: number | null; mfaVerifiedAt: string | null;
};

const loginColumns = sql`u.id as "loginId", u.role, u.name, u.username, u.phone, u.banned,
  u.archived_at as "archivedAt", u.login_creation_id as "loginCreationId",
  c.created_login_id as "creationLoginId", c.completed_at as "creationCompletedAt"`;
const creationJoin = sql`left join login_creations c on c.id = u.login_creation_id`;

export function sessionAccessQuery(input: HubAccessInput): RawBuilder<SessionAccessRow> {
  // Identity, revisions, MFA, completion and membership share one indexed snapshot.
  return sql<SessionAccessRow>`select ${loginColumns}, s."expiresAt", m.role as "membershipRole",
    u.auth_revision as "userAuthRevision", s.auth_revision as "sessionAuthRevision",
    u."twoFactorEnabled", f.id as "factorId", f.verified as "factorVerified", s.mfa_verified_at as "mfaVerifiedAt"
    from session s join user u on u.id = s."userId" ${creationJoin}
    left join member m on m."userId" = u.id and m."organizationId" = ${input.workspaceId}
    left join twoFactor f on f."userId" = u.id
    where s.id = ${input.hubSessionId} and u.id = ${input.loginId}`;
}

export function loginAccessQuery(loginId: string): RawBuilder<LoginAccessRow> {
  return sql<LoginAccessRow>`select ${loginColumns} from user u ${creationJoin} where u.id = ${loginId}`;
}

export async function readSessionAccess(database: D1Database, input: HubAccessInput): Promise<SessionAccessRow | undefined> {
  const db = await createHubDatabase(database);
  try { return (await sessionAccessQuery(input).execute(db.withoutPlugins())).rows[0]; }
  finally { await db.destroy(); }
}

export async function readLoginAccess(database: D1Database, loginId: string): Promise<LoginAccessRow | undefined> {
  const db = await createHubDatabase(database);
  try { return (await loginAccessQuery(loginId).execute(db.withoutPlugins())).rows[0]; }
  finally { await db.destroy(); }
}
