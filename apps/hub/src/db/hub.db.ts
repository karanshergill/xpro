import { createHubConnection } from "@xpro/core/server";
import { type Kysely, Migrator } from "kysely";
import * as initialHub from "./migrations/2026-10-27-010000-initial-hub";
import * as workspacePlacements from "./migrations/2026-10-28-100900-workspace-placements";
import * as loginSearch from "./migrations/2026-10-29-100000-login-search";
import * as masterMfa from "./migrations/2026-10-31-014344-master-mfa";

type UserRow = {
  id: string;
  name: string;
  nameSearch: string | null;
  email: string;
  emailVerified: number;
  image: string | null;
  createdAt: string;
  updatedAt: string;
  username: string | null;
  displayUsername: string | null;
  role: string | null;
  banned: number | null;
  banReason: string | null;
  banExpires: string | null;
  phone: string | null;
  pictureKey: string | null;
  archivedAt: string | null;
  statusBeforeArchiving: string | null;
  loginCreationId: string | null;
  twoFactorEnabled: number | null;
  authRevision: number;
};

type HubTables = {
  workspacePlacements: { id: string; organizationId: string; workerName: string; createdAt: string };
  workspaceAddresses: { id: string; workspacePlacementId: string; origin: string; isPrimary: number; createdAt: string };
  user: UserRow;
  session: {
    id: string; expiresAt: string; token: string; createdAt: string; updatedAt: string;
    ipAddress: string | null; userAgent: string | null; userId: string;
    impersonatedBy: string | null; activeOrganizationId: string | null;
    authRevision: number; mfaVerifiedAt: string | null;
  };
  account: {
    id: string; accountId: string; providerId: string; userId: string;
    accessToken: string | null; refreshToken: string | null; idToken: string | null;
    accessTokenExpiresAt: string | null; refreshTokenExpiresAt: string | null;
    scope: string | null; password: string | null; createdAt: string; updatedAt: string;
  };
  organization: { id: string; name: string; slug: string; logo: string | null; createdAt: string; metadata: string | null };
  member: { id: string; organizationId: string; userId: string; role: string; createdAt: string };
  invitation: {
    id: string; organizationId: string; email: string; role: string | null;
    status: string; expiresAt: string; createdAt: string; inviterId: string;
  };
  verification: { id: string; identifier: string; value: string; expiresAt: string; createdAt: string; updatedAt: string; authRevision: number | null };
  // Native camelCase identifiers require withoutPlugins() when queried directly.
  twoFactor: {
    id: string; secret: string; backupCodes: string; userId: string;
    verified: number | null; failedVerificationCount: number | null; lockedUntil: string | null;
  };
  accounts: { id: string; ownerLoginId: string; createdAt: string };
  reservedUsernames: { id: string; username: string; addedAt: string };
  loginCreations: {
    id: string; creatorLoginId: string; organizationId: string | null;
    createdLoginId: string | null; kind: "internal" | "external" | null; details: string;
    createdAt: string; completedAt: string | null;
  };
  auditEntries: {
    id: string; action: string; outcome: string; actorLoginId: string | null;
    affectedLoginId: string | null; reason: string | null; comment: string | null;
    requestId: string; createdAt: string;
  };
};

export const createHubDatabase = createHubConnection<HubTables>;

export function createHubMigrator<Database>(database: Kysely<Database>): Migrator {
  // Run serially before release. D1 has no interactive transactions or migration lock.
  return new Migrator({
    db: database.withoutPlugins(),
    disableTransactions: true,
    provider: { async getMigrations() { return {
      "2026-10-27-010000-initial-hub": initialHub,
      "2026-10-28-100900-workspace-placements": workspacePlacements,
      "2026-10-29-100000-login-search": loginSearch,
      "2026-10-31-014344-master-mfa": masterMfa,
    }; } },
  });
}
