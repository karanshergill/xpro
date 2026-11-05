import { oauthProvider } from "@better-auth/oauth-provider";
import { createKyselyAdapter, kyselyAdapter } from "@better-auth/kysely-adapter";
import { isValidUsername } from "@xpro/accounts";
import { createRequestContext, reportUnexpectedError, type RequestContext } from "@xpro/core/server";
import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth";
import { isAPIError } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";
import { username } from "better-auth/plugins/username";
import { twoFactor } from "better-auth/plugins/two-factor";
import { v7 } from "uuid";
import { createHubAccessHooks } from "./access-policy.server";
import { createUserPersistenceHooks } from "./user-persistence.server";
import type { LoginCreation } from "@xpro/accounts/server";
import { createSignInCaptcha } from "./sign-in-protection.server";
import { createOAuthAccessPolicy } from "./oauth-access.server";
import { guardMfaAdapter } from "#auth/mfa/adapter.db.ts";
import type { Kysely } from "kysely";
import type { MfaTables } from "#auth/mfa/phases.db.ts";

type SchemaSettings = {
  database: NonNullable<BetterAuthOptions["database"]>;
  baseURL: string;
  secret: string;
  requestContext?: RequestContext;
  onUnexpectedError?: () => void;
};

export type HubAuthSettings = Omit<SchemaSettings, "database"> & {
  database: D1Database;
  // Trusted server APIs also run during private setup, without public HTTP protection.
  turnstileSecret?: string;
  rateLimiter?: RateLimit;
  // Only trusted creation code supplies this saved request; it never comes from HTTP input.
  loginCreation?: LoginCreation;
};

const sessionLifetimeSeconds = 30 * 24 * 60 * 60;
const minimumSecretLength = 32;
const revisionField = {
  type: "number", fieldName: "auth_revision", required: true, defaultValue: 0, input: false, returned: false,
} as const;

// An explicitly typed alias preserves native plugin and field inference.
export const createHubAuthOptions: typeof createOptions = createOptions;

export async function createHubAuth(settings: HubAuthSettings): Promise<Auth<ReturnType<typeof createRuntimeOptions>>> {
  const { kysely } = await createKyselyAdapter({ database: settings.database });
  if (!kysely) throw new Error("Better Auth did not provide its D1 adapter.");
  return betterAuth(createRuntimeOptions(settings, kysely.withTables<MfaTables>()));
}

function createRuntimeOptions(settings: HubAuthSettings, db: Kysely<MfaTables>) {
  const nativeDatabase = kyselyAdapter(db, { type: "sqlite", transaction: false });
  const options = createOptions(settings, createOAuthAccessPolicy(settings));
  const accessHooks = createHubAccessHooks(settings, db);
  const userHooks = createUserPersistenceHooks(settings.loginCreation);
  return { ...options, ...accessHooks,
    database: (configured: BetterAuthOptions) => guardMfaAdapter(nativeDatabase(configured), { db, database: settings.database }),
    databaseHooks: { ...accessHooks.databaseHooks, ...userHooks.databaseHooks },
    plugins: [
    ...options.plugins,
    ...(settings.turnstileSecret === undefined ? [] : [createSignInCaptcha({
      baseURL: settings.baseURL, turnstileSecret: settings.turnstileSecret,
    })]),
  ] } satisfies BetterAuthOptions;
}

function createOptions(settings: SchemaSettings, oauthAccess?: ReturnType<typeof createOAuthAccessPolicy>) {
  if (settings.secret.length < minimumSecretLength) {
    throw new Error("Hub authentication requires a supplied secret of at least 32 characters.");
  }
  const baseURL = new URL(settings.baseURL);
  if (baseURL.protocol !== "https:") throw new Error("Hub authentication requires an HTTPS base URL.");
  const reportError = settings.onUnexpectedError
    ?? ((): void => { reportUnexpectedError(settings.requestContext ?? createRequestContext(), { app: "hub", operation: "accounts_native_auth" }); });

  return {
    appName: "xpro",
    database: settings.database,
    baseURL: settings.baseURL,
    secret: settings.secret,
    trustedOrigins: [baseURL.origin],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 64 },
    user: {
      deleteUser: { enabled: false },
      changeEmail: { enabled: false },
      additionalFields: {
        authRevision: revisionField,
        phone: { type: "string", required: false, input: false, returned: false },
        nameSearch: { type: "string", fieldName: "name_search", required: false, input: false, returned: false },
        pictureKey: { type: "string", fieldName: "picture_key", required: false, input: false, returned: false },
        archivedAt: { type: "string", fieldName: "archived_at", required: false, input: false, returned: false },
        statusBeforeArchiving: { type: "string", fieldName: "status_before_archiving", required: false, input: false, returned: false },
        loginCreationId: {
          type: "string", fieldName: "login_creation_id", required: false, input: false, returned: false, unique: true,
        },
      },
    },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: sessionLifetimeSeconds,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      additionalFields: {
        authRevision: revisionField,
        mfaVerifiedAt: { type: "string", fieldName: "mfa_verified_at", required: false, input: false, returned: false },
      },
    },
    verification: { additionalFields: {
      authRevision: { type: "number", fieldName: "auth_revision", required: false, input: false, returned: false },
    } },
    advanced: { useSecureCookies: true, database: { generateId: () => v7() } },
    // The public Hub entry uses the Cloudflare identifier binding, not an IP counter.
    rateLimit: { enabled: false },
    logger: {
      level: "error",
      // Library messages and arguments may contain credentials or personal details.
      log: reportError,
    },
    onAPIError: {
      onError: (error) => {
        if (isAPIError(error) && (error.statusCode < 500 || error.body?.code === "core_unexpected_error")) return;
        // The access boundary reports its own core_unexpected_error before refusing.
        reportError();
      },
    },
    plugins: [
      createMasterTwoFactor(),
      username({ minUsernameLength: 4, maxUsernameLength: 8, usernameValidator: isValidUsername,
        validationOrder: { username: "pre-normalization" } }),
      // The global admin role represents an xpro master, independently of membership roles.
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        // Workspace size limits belong to subscription policy, not the plugin's default cap.
        membershipLimit: Number.MAX_SAFE_INTEGER,
        teams: { enabled: false },
        dynamicAccessControl: { enabled: false },
      }),
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        ...oauthAccess,
        scopes: ["openid", "profile", "email"],
        grantTypes: ["authorization_code"],
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
      }),
    ],
    // This HTTP-router filter leaves trusted auth.api methods available to xpro.
    disabledPaths: [
      "/sign-up/email", "/sign-in/social", "/is-username-available", "/update-user", "/update-session",
      "/change-email", "/change-password", "/set-password", "/delete-user", "/delete-user/callback",
      "/request-password-reset", "/reset-password", "/send-verification-email", "/verify-email",
      "/two-factor/enable", "/two-factor/disable", "/two-factor/get-totp-uri",
      "/two-factor/send-otp", "/two-factor/verify-otp", "/two-factor/generate-backup-codes",
      "/link-social", "/unlink-account", "/get-access-token", "/refresh-token", "/token",
      "/admin/create-user", "/admin/update-user", "/admin/set-role", "/admin/set-user-password",
      "/admin/ban-user", "/admin/unban-user", "/admin/remove-user",
      "/admin/impersonate-user", "/admin/stop-impersonating",
      "/admin/revoke-user-session", "/admin/revoke-user-sessions", "/admin/list-user-sessions",
      "/admin/list-users", "/admin/get-user",
      "/organization/create", "/organization/update", "/organization/delete", "/organization/set-active",
      "/organization/add-member", "/organization/remove-member", "/organization/update-member-role", "/organization/leave",
      "/organization/invite-member", "/organization/accept-invitation", "/organization/reject-invitation", "/organization/cancel-invitation",
      "/organization/get-invitation", "/organization/list-invitations", "/organization/list-user-invitations",
      "/organization/create-team", "/organization/update-team", "/organization/remove-team",
      "/organization/set-active-team", "/organization/add-team-member", "/organization/remove-team-member",
      "/organization/create-role", "/organization/update-role", "/organization/delete-role",
      "/oauth2/register", "/oauth2/create-client", "/oauth2/update-client", "/oauth2/delete-client",
      "/oauth2/client/rotate-secret", "/oauth2/client/rotate-keys",
      "/admin/oauth2/create-client", "/admin/oauth2/update-client",
    ],
  } satisfies BetterAuthOptions;
}

function createMasterTwoFactor(): ReturnType<typeof twoFactor> {
  const plugin = twoFactor();
  return { ...plugin, hooks: { ...plugin.hooks, after: plugin.hooks.after.map((hook) => ({
    ...hook,
    matcher: (ctx) => {
      const user = ctx.context.newSession?.user, role = user && "role" in user ? user.role : undefined;
      return hook.matcher(ctx) && typeof role === "string" && role.split(",").includes("admin");
    },
  })) } };
}
