import { createErrorResponse, createRequestContext, isMfaRecent, type CoreError, type RequestContext } from "@xpro/core/server";
import { pageLoginIdHeader } from "@xpro/core";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx, isAPIError } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import { v7 } from "uuid";
import { getMfaAccessState } from "./access";
import { readAuthSource, readMfaOperation, refuseMfaWrite, setMfaOperation } from "./context.db";
import { assertMfaSource, completeMfaSession, readMfaChallenge, readMfaSnapshot, readPasswordAccount, type MfaOperation, type MfaStorage } from "./phases.db";

type Endpoint = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
type Settings = MfaStorage & { rateLimiter?: RateLimit; requestContext?: RequestContext };
const paths: Record<string, MfaOperation["kind"]> = {
  "/two-factor/enable": "setup", "/two-factor/disable": "disable", "/two-factor/generate-backup-codes": "backups",
  "/two-factor/verify-totp": "verify", "/two-factor/verify-backup-code": "verify",
  "/change-password": "password",
};

export async function captureMfaOperation(ctx: Endpoint, settings: Settings): Promise<void> {
  let kind = paths[ctx.path];
  if (!kind) return;
  if (ctx.body?.trustDevice !== undefined || ctx.body?.disableSession !== undefined) refuseMfaWrite();
  if (kind === "password" && ctx.body?.revokeOtherSessions !== true) refuseMfaWrite();
  const context = settings.requestContext ?? createRequestContext(), { db } = settings;
  const session = await getAuthoritativeSessionFromCtx(ctx);
  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = kind === "verify" ? await ctx.getSignedCookie(cookie.name, ctx.context.secret) : null;
  if (session && identifier) refuseMfaWrite();
  let loginId = session?.user.id;
  let challenge: MfaOperation["challenge"] = null, challengeRevision: number | null = null;
  if (!session) {
    if (kind !== "verify" || !identifier) refuseMfaWrite();
    const native = await ctx.context.internalAdapter.findVerificationValue(identifier);
    if (!native) refuseMfaWrite();
    const stored = await readMfaChallenge(db, native.id);
    if (!stored || !Number.isSafeInteger(stored.auth_revision) || stored.auth_revision === null || stored.auth_revision < 0
      || !(stored.expiresAt > new Date().toISOString())) refuseMfaWrite();
    loginId = stored.value; challengeRevision = stored.auth_revision;
    challenge = { id: stored.id, identifier: stored.identifier, expiresAt: stored.expiresAt };
  }
  if (!loginId) refuseMfaWrite();
  const expectedLoginId = ctx.headers?.get(pageLoginIdHeader);
  if (expectedLoginId !== undefined && expectedLoginId !== null && expectedLoginId !== loginId) {
    await rejectAccess({ code: "core_identity_changed" }, context);
  }
  const snapshot = await readMfaSnapshot(db, { loginId, sessionId: session?.session.id ?? null });
  if (!snapshot) refuseMfaWrite();
  const { user, actor, factor } = snapshot;
  if (!Number.isSafeInteger(user.auth_revision) || user.auth_revision < 0
    || challengeRevision !== null && challengeRevision !== user.auth_revision) refuseMfaWrite();
  const role = user.role;
  const isMaster = role?.split(",").includes("admin") ?? false;
  if (kind !== "password" && !isMaster) await rejectAccess({ code: "core_forbidden" }, context);
  if (session && (!actor || actor.userId !== user.id || actor.auth_revision !== user.auth_revision)) refuseMfaWrite();
  const now = Date.now();
  const mfa = getMfaAccessState({ isMaster, userAuthRevision: user.auth_revision,
    sessionAuthRevision: actor?.auth_revision ?? challengeRevision ?? -1, twoFactorEnabled: user.twoFactorEnabled,
    factorId: factor?.id ?? null, factorVerified: factor?.verified ?? null, mfaVerifiedAt: actor?.mfa_verified_at ?? null, now });
  if (!mfa) refuseMfaWrite();
  if (kind === "password" && isMaster && mfa.status !== "verified") await rejectAccess({ code: "core_mfa_required" }, context);
  if (kind === "setup" && factor && mfa.status === "enrollment_required") {
    throw new APIError("CONFLICT", { code: "accounts_mfa_setup_pending", message: "Finish the existing setup or explicitly restart it." });
  }
  if (kind === "setup" && (factor || mfa.status !== "enrollment_required")) refuseMfaWrite();
  if (kind === "verify" && session) {
    if (ctx.path !== "/two-factor/verify-totp" || !factor || factor.verified !== 0 || user.twoFactorEnabled !== 0) refuseMfaWrite();
    kind = "activate";
  }
  if (kind === "verify" && (mfa.status !== "sign_in_required" || !challenge)) refuseMfaWrite();
  if (kind === "disable" && !factor || kind === "backups" && (mfa.status !== "verified" || !factor)) {
    await rejectAccess({ code: "core_mfa_required" }, context);
  }
  if (kind === "backups" || kind === "disable" && user.twoFactorEnabled === 1) {
    if (mfa.status !== "verified") await rejectAccess({ code: "core_mfa_required" }, context);
    if (!isMfaRecent(mfa, now)) {
      await rejectAccess({ code: "core_mfa_recent_verification_required" }, context);
    }
  }
  if (kind !== "password") await limitAttempt(settings.rateLimiter, loginId);
  const source = { userId: user.id, role, revision: user.auth_revision,
    enabled: user.twoFactorEnabled === 1, actor: actor ? { id: actor.id, expiresAt: actor.expiresAt, mfaAt: actor.mfa_verified_at } : null,
    challenge, factor, consumed: false, auditId: v7(), requestId: context.requestId };
  const operation: MfaOperation = kind === "password"
    ? { ...source, kind, phase: "running", account: await readPasswordAccount(db, user.id) ?? null }
    : { ...source, kind, phase: "running" };
  await assertMfaSource(db, operation);
  await setMfaOperation(operation);
}

export async function finishMfaOperation(ctx: Endpoint, storage: MfaStorage): Promise<void> {
  const value = await readMfaOperation();
  if (!value) return;
  const clearCookies = (): void => { ctx.context.responseHeaders?.delete("set-cookie"); ctx.context.setNewSession(null); };
  if (isAPIError(ctx.context.returned)) { clearCookies(); return; }
  if (value.kind === "setup" || value.kind === "backups") return;
  try {
    const fresh = ctx.context.newSession;
    if (!fresh || fresh.user.id !== value.userId || value.kind === "verify" && !value.consumed
      || value.kind === "activate" && value.phase !== "activated" || value.kind === "disable" && value.phase !== "disabled"
      || value.kind === "password" && value.phase !== "password_saved") refuseMfaWrite();
    if (value.kind === "disable") await assertMfaSource(storage.db, value);
    else await completeMfaSession(storage.db, { operation: value, sessionId: fresh.session.id });
  } catch (error) { clearCookies(); throw error; }
}

export function createMfaVerificationHooks(): NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["verification"]> {
  return { create: { before: async (record) => {
    if (!record.identifier.startsWith("2fa-") || record.identifier.startsWith("2fa-attempts-")) return;
    const source = await readAuthSource();
    if (!source || source.kind !== "credential" || record.value !== source.loginId) refuseMfaWrite();
    return { data: { ...record, authRevision: source.revision } };
  } } };
}

async function limitAttempt(rateLimiter: RateLimit | undefined, loginId: string): Promise<void> {
  let allowed: boolean;
  try {
    if (!rateLimiter) throw new Error("Missing MFA rate limiter.");
    allowed = (await rateLimiter.limit({ key: `mfa:${loginId}` })).success;
  } catch {
    throw new APIError("SERVICE_UNAVAILABLE", { code: "accounts_mfa_unavailable", message: "Verification is temporarily unavailable. Please try again." });
  }
  if (!allowed) throw new APIError("TOO_MANY_REQUESTS", { code: "accounts_mfa_limited", message: "Too many attempts. Please wait before trying again." });
}

async function rejectAccess(error: CoreError, context: RequestContext): Promise<never> {
  const response = createErrorResponse(error, context);
  throw new APIError(error.code === "core_identity_changed" ? "CONFLICT" : "FORBIDDEN", await response.json(), response.headers);
}
