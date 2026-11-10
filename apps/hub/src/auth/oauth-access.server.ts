import type { oauthProvider } from "@better-auth/oauth-provider";
import { createAccessRequest, createErrorResponse, createRequestContext, type AccessError, type AccessSession, type RequestContext } from "@xpro/core/server";
import { APIError } from "better-auth/api";
import { validateHubLocalAccess } from "@xpro/accounts/server";

type OAuthOptions = NonNullable<Parameters<typeof oauthProvider>[0]>;
type Settings = { database: D1Database; requestContext?: RequestContext };

export function createOAuthAccessPolicy(settings: Settings): Pick<OAuthOptions, "postLogin" | "customUserInfoClaims"> {
  const context = settings.requestContext ?? createRequestContext();
  return {
    postLogin: {
      page: "/complete-profile",
      shouldRedirect: async ({ user, session }) => {
        const { facts, access } = await readOAuthAccess(settings, { loginId: user.id, hubSessionId: session.id, context });
        const current = access.authorize({ kind: "check_session" });
        if (current.isErr) await rejectAccess(current.error, context);
        if (facts.status !== "valid") return await rejectAccess({ code: facts.code }, context);
        if (!facts.isCreationComplete) await rejectAccess({ code: "core_creation_incomplete" }, context);
        return facts.actor.isMaster && facts.mfa.status !== "verified" || facts.missingProfileFields.length > 0;
      },
      consentReferenceId: async ({ user, session }) => {
        await requireOAuthAccess(settings, { loginId: user.id, hubSessionId: session.id, context });
        return undefined;
      },
    },
    customUserInfoClaims: async ({ user, jwt }) => {
      // The native provider verifies the bearer first. Its sid, not a browser
      // cookie or a decoded client claim, identifies the originating session.
      if (typeof jwt.sid !== "string" || !jwt.sid) return await rejectAccess({ code: "core_unauthenticated" }, context);
      await requireOAuthAccess(settings, { loginId: user.id, hubSessionId: jwt.sid, context });
      return {};
    },
  };
}

async function requireOAuthAccess(settings: Settings, input: AccessSession & { context: RequestContext }): Promise<void> {
  const { access } = await readOAuthAccess(settings, input);
  const result = access.authorize({ kind: "protected", hasLocalPermission: true });
  if (result.isErr) await rejectAccess(result.error, input.context);
}

async function readOAuthAccess(settings: Settings, input: AccessSession & { context: RequestContext }) {
  const facts = await validateHubLocalAccess(settings.database, { ...input, workspaceId: null });
  const access = await createAccessRequest({ app: "hub", session: input, workspaceId: null, context: input.context,
    hub: { async validateAccess() { return facts; } } });
  return { facts, access };
}

async function rejectAccess(error: AccessError, context: RequestContext): Promise<never> {
  const response = createErrorResponse(error, context);
  const status = error.code === "core_unexpected_error" ? "INTERNAL_SERVER_ERROR"
    : error.code === "core_unauthenticated" ? "UNAUTHORIZED" : "FORBIDDEN";
  throw new APIError(status, await response.json(), response.headers);
}
