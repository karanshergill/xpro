import { normalizeSearchText } from "@xpro/accounts";
import type { LoginCreation } from "@xpro/accounts/server";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";

export function createUserPersistenceHooks(creation: LoginCreation | undefined): Pick<BetterAuthOptions, "databaseHooks"> {
  // Capture one trusted saved request for this auth instance, independent of caller input.
  const request = creation ? { ...creation, details: { ...creation.details } } : null;
  return { databaseHooks: { user: { create: { before: async (user) => {
    if (request) {
      const isPending = request.createdLoginId === null && request.completedAt === null;
      const matchesProfile = user.email === request.details.email && user.username === request.details.username
        && user.name === request.details.name && user.phone === request.details.phone;
      if (!isPending || !matchesProfile || user.role !== "user") {
        throw new APIError("CONFLICT", { code: "accounts_creation_conflict", message: "The login creation request does not match." });
      }
    }
    // This runs before the native INSERT. Body data cannot choose or replace the link.
    return { data: { ...user, loginCreationId: request?.id ?? null, nameSearch: normalizeSearchText(user.name) } };
  } }, update: { before: async (user) => {
    // Hooks merge returned data, so overwrite a supplied private copy rather than
    // relying on removing a property from the hook result.
    if (user.name === undefined) {
      if (user.nameSearch !== undefined) throw new APIError("BAD_REQUEST", { message: "The search name is server-owned." });
      return { data: user };
    }
    return { data: { ...user, nameSearch: normalizeSearchText(user.name) } };
  } } } } };
}
