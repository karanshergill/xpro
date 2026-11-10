import { validateHubLocalAccess, type CreateLoginServices, type LoginCreationIdentity } from "@xpro/accounts/server";
import { pageLoginIdHeader } from "@xpro/core";
import { err, ok, type Result } from "true-myth/result";
import { createAccessRequest, type AccessActor, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { isAPIError } from "better-auth/api";
import { createHubAuth, type HubAuthSettings } from "./auth.server";

export async function createLoginServices(request: Request, input: { settings: HubAuthSettings; context: RequestContext }): Promise<CreateLoginServices> {
  const { settings, context } = input;
  const auth = await createHubAuth({ ...settings, requestContext: context, loginCreation: undefined });
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  const access = await createAccessRequest({ app: "hub",
    session: session ? { loginId: session.user.id, hubSessionId: session.session.id } : null,
    workspaceId: null, context,
    hub: { async validateAccess(value) { return await validateHubLocalAccess(settings.database, value); } },
  });
  const identity: LoginCreationIdentity = {
    async hasCreationPermission(workspaceId) {
      try {
        const permission = await auth.api.hasPermission({ headers: request.headers,
          body: { organizationId: workspaceId, permissions: { member: ["create"] } } });
        return permission.success;
      } catch (error) {
        if (isAPIError(error) && error.statusCode < 500) return false;
        throw error;
      }
    },
    async createUser({ creation, password }) {
      // Trusted server call: xpro checks the creator; tenant owners never become global admins.
      const scoped = await createHubAuth({ ...settings, requestContext: context, loginCreation: creation });
      const { email, username, name, phone } = creation.details;
      await scoped.api.createUser({ body: { email, password, name, role: "user", data: { username, phone } } });
    },
    async ensureCredential({ loginId, password }) {
      const native = await auth.$context;
      let account = await native.internalAdapter.findCredentialAccount(loginId);
      if (!account) {
        try {
          const hashed = await native.password.hash(password);
          await native.internalAdapter.linkAccount({ providerId: "credential", accountId: loginId, userId: loginId, password: hashed });
        } catch (error) {
          // The existing unique index chooses a winner; never update a saved credential.
          account = await native.internalAdapter.findCredentialAccount(loginId);
          if (!account) throw error;
        }
        account ??= await native.internalAdapter.findCredentialAccount(loginId);
      }
      return account?.accountId === loginId && typeof account.password === "string" && account.password.length > 0 ? "ready" : "invalid";
    },
    async addMember({ loginId, workspaceId }) {
      await auth.api.addMember({ body: { userId: loginId, organizationId: workspaceId, role: "member" } });
    },
  };
  return { database: settings.database, access, identity, context };
}

export function authorizeCreationActor(request: Request, access: AccessRequest): Result<AccessActor, CoreError> {
  const actor = access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  const expected = request.headers.get(pageLoginIdHeader);
  // UI hints only refuse another authenticated actor; they never grant access.
  if (expected !== null && expected !== actor.value.loginId) return err({ code: "core_identity_changed" });
  return ok(actor.value);
}
