import { getMissingProfileFields } from "#profile/profile.ts";
import { authorizeAccess, type AccessError, type AccessSession, type HubAccessInput, type HubAccessResult } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { readSessionAccess, type LoginAccessRow, type MasterAuthority, type SessionAccessRow } from "./validate-access.db";
import { getMfaAccessState } from "./mfa-access";

export async function validateHubAccess(database: D1Database, input: HubAccessInput): Promise<HubAccessResult> {
  const result = await validateHubLocalAccess(database, input);
  // Refuse here too: older workspace code may ignore new fields on a valid result.
  if (result.status === "valid" && result.actor.isMaster && result.mfa.status !== "verified") {
    return { status: "invalid", code: "core_unauthenticated" };
  }
  return result;
}

export async function validateHubLocalAccess(database: D1Database, input: HubAccessInput): Promise<HubAccessResult> {
  try {
    const row = await readSessionAccess(database, input);
    return evaluateSessionAccess(row, Date.now());
  } catch {
    // Do not serialize a database exception, query or bound data across RPC.
    // The request's access boundary reports this named failure once.
    return { status: "invalid", code: "core_unexpected_error" };
  }
}

export function authorizeMasterAuthority(input: {
  session: AccessSession | null; row: SessionAccessRow | undefined; now: number;
}): Result<MasterAuthority, AccessError> {
  const { session, row, now } = input;
  if (!session || !row || row.loginId !== session.loginId) return err({ code: "core_unauthenticated" });
  const actor = authorizeAccess({ result: evaluateSessionAccess(row, now), workspaceId: null,
    action: { kind: "protected", hasLocalPermission: false }, now });
  return actor.isErr ? err(actor.error) : ok({ session, facts: row, actor: actor.value });
}

function evaluateSessionAccess(row: SessionAccessRow | undefined, now: number): HubAccessResult {
  if (!row || !(Date.parse(row.expiresAt) > now)) return { status: "invalid", code: "core_unauthenticated" };
  if (isLoginInactive(row)) return { status: "invalid", code: "core_login_inactive" };
  const isMaster = row.role?.split(",").includes("admin") ?? false;
  const mfa = getMfaAccessState({ ...row, isMaster, now });
  if (mfa === null) return { status: "invalid", code: "core_unauthenticated" };
  const membershipRole = row.membershipRole === "owner" || row.membershipRole === "admin" || row.membershipRole === "member"
    ? row.membershipRole : null;
  return {
    status: "valid", actor: { loginId: row.loginId, isMaster, membershipRole }, mfa,
    sessionExpiresAt: new Date(row.expiresAt).toISOString(),
    isCreationComplete: isLoginCreationComplete(row), missingProfileFields: getMissingProfileFields(row),
  };
}

export function isLoginInactive(row: Pick<LoginAccessRow, "banned" | "archivedAt">): boolean {
  return row.banned === 1 || row.archivedAt !== null;
}

export function isLoginCreationComplete(row: Pick<LoginAccessRow, "loginId" | "loginCreationId" | "creationLoginId" | "creationCompletedAt">): boolean {
  return row.loginCreationId === null || (row.creationLoginId === row.loginId && row.creationCompletedAt !== null);
}
