import { createAccessRequest, createErrorResponse, createRequestContext, reportUnexpectedError,
  type AccessError, type RequestContext } from "@xpro/core/server";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import { readLoginAccess, isLoginCreationComplete, isLoginInactive, validateHubLocalAccess } from "@xpro/accounts/server";
import { captureAuthSource } from "#auth/mfa/context.db.ts";
import { readMfaOperation } from "#auth/mfa/context.db.ts";
import { captureMfaOperation, createMfaVerificationHooks, finishMfaOperation } from "#auth/mfa/native.server.ts";
import { assertMfaSource, type MfaTables } from "#auth/mfa/phases.db.ts";
import type { Kysely } from "kysely";

export function createHubAccessHooks(settings: { database: D1Database; requestContext?: RequestContext; rateLimiter?: RateLimit },
  db: Kysely<MfaTables>): Pick<BetterAuthOptions, "hooks" | "databaseHooks"> {
  return {
    hooks: { before: createAuthMiddleware(async (ctx) => {
      await captureAuthSource(ctx, settings.database);
      await captureMfaOperation(ctx, { ...settings, db });
      // Native trusted server APIs are composed by xpro actions, not this HTTP gate.
      if (!ctx.request || ctx.path === "/sign-in/email" || ctx.path === "/sign-in/username") return;
      const isOAuthContinuation = ctx.path === "/oauth2/authorize" || ctx.path === "/oauth2/continue";
      // Provider callbacks check the actual authorization session before issuing
      // a code, or the verified bearer's originating session for UserInfo.
      if (isOAuthContinuation || ctx.path === "/oauth2/userinfo") return;
      const session = await getAuthoritativeSessionFromCtx(ctx);
      if (!session) return;
      const context = settings.requestContext ?? createRequestContext();
      const access = await createAccessRequest({ app: "hub",
        session: { loginId: session.user.id, hubSessionId: session.session.id }, workspaceId: null, context,
        hub: { async validateAccess(input) { return await validateHubLocalAccess(settings.database, input); } },
      });
      const action = ctx.path === "/two-factor/verify-totp" ? { kind: "enroll_mfa" as const }
        : ctx.path === "/get-session" ? { kind: "check_session" as const }
        : ctx.path === "/sign-out" ? { kind: "sign_out" as const }
        : { kind: "protected" as const, hasLocalPermission: true };
      const result = access.authorize(action);
      if (result.isErr) await rejectAccess(result.error, context);
    }), after: createAuthMiddleware(async (ctx) => { await finishMfaOperation(ctx, { ...settings, db }); }) },
    databaseHooks: { verification: createMfaVerificationHooks(), session: { create: { before: async (session) => {
      const context = settings.requestContext ?? createRequestContext();
      let error: AccessError | undefined;
      try {
        const login = await readLoginAccess(settings.database, session.userId);
        if (!login) error = { code: "core_unauthenticated" };
        else if (isLoginInactive(login)) error = { code: "core_login_inactive" };
        else if (!isLoginCreationComplete(login)) error = { code: "core_creation_incomplete" };
      } catch {
        reportUnexpectedError(context, { app: "hub", operation: "accounts_create_hub_session" });
        error = { code: "core_unexpected_error" };
      }
      if (error) await rejectAccess(error, context);
      const operation = await readMfaOperation();
      if (operation) {
        await assertMfaSource(db, operation);
        return { data: { ...session, authRevision: operation.revision, mfaVerifiedAt: null } };
      }
    } } } },
  };
}

async function rejectAccess(error: AccessError, context: RequestContext): Promise<never> {
  const response = createErrorResponse(error, context);
  const status = error.code === "core_unexpected_error" ? "INTERNAL_SERVER_ERROR"
    : error.code === "core_unauthenticated" ? "UNAUTHORIZED" : "FORBIDDEN";
  throw new APIError(status, await response.json(), response.headers);
}
