import { saveHub, type RequestContext } from "@xpro/core/server";
import { v7 } from "uuid";
import { createHubAuth } from "#auth/auth.server.ts";
import { createInitialMaster } from "#auth/initial-master.db.ts";
import { createHubDatabase, createHubMigrator } from "#db/hub.db.ts";
import { CLOUDFLARE_TEST_TARGET, parseCloudflareTestInput, parseCloudflareTestReceipt,
  type CloudflareTestReceipt } from "./cloudflare-test-settings";

type Prepared = { status: "prepared"; receipt: CloudflareTestReceipt; clientSecret: string };
type PreparedResult = Prepared | { status: "existing_logins" };
type Settings = { database: D1Database; context: RequestContext };

export async function prepareCloudflareTest(settings: Settings, input: unknown): Promise<PreparedResult> {
  const values = parseCloudflareTestInput(input);
  const db = await createHubDatabase(settings.database);
  try {
    const migrated = await createHubMigrator(db).migrateToLatest();
    if (migrated.error) throw migrated.error;
    const authSettings = { database: settings.database, baseURL: values.hubOrigin,
      secret: values.hubSecret, requestContext: settings.context };
    const initial = await createInitialMaster(authSettings, { email: values.email, password: values.password });
    if (initial.status === "existing_logins") return initial;
    if (initial.status !== "created") throw new Error("Initial test master was not created.");

    const workspaceId = v7(), createdAt = new Date().toISOString();
    // The native Organization API always makes its creator an owner. A global
    // xpro master must not acquire tenant membership during private test setup.
    await saveHub(settings.database, [
      db.withoutPlugins().insertInto("organization").values({ id: workspaceId, name: "xpro test workspace",
        slug: "xpro-test", logo: null, metadata: null, createdAt }).compile(),
      db.insertInto("auditEntries").values({ id: v7(), action: "stms_test_workspace_prepared", outcome: "success",
        actorLoginId: initial.loginId, affectedLoginId: null, reason: null, comment: null,
        requestId: settings.context.requestId, createdAt }).compile(),
    ]);

    const auth = await createHubAuth(authSettings);
    const signedIn = await auth.api.signInEmail({ body: { email: values.email, password: values.password }, asResponse: true });
    const cookie = signedIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    if (!signedIn.ok || !cookie) throw new Error("Private test sign-in failed.");
    const headers = { cookie };
    try {
      const session = await auth.api.getSession({ headers });
      if (session?.user.id !== initial.loginId) throw new Error("Private test sign-in did not match its master.");
      const client = await auth.api.adminCreateOAuthClient({ headers, body: {
        client_name: "xpro test workspace", redirect_uris: [values.workspaceOrigin + "/auth/callback"],
        backchannel_logout_uri: values.workspaceOrigin + "/auth/back-channel-sign-out",
        backchannel_logout_session_required: true, token_endpoint_auth_method: "client_secret_basic",
        grant_types: ["authorization_code"], response_types: ["code"], scope: "openid profile email",
        require_pkce: true, skip_consent: true, enable_end_session: true, client_secret_expires_at: 0,
      } });
      if (!client.client_secret) throw new Error("Native test client has no secret.");
      return { status: "prepared", clientSecret: client.client_secret,
        receipt: { ...CLOUDFLARE_TEST_TARGET, loginId: initial.loginId, workspaceId, clientId: client.client_id } };
    } finally {
      await auth.api.signOut({ headers });
    }
  } finally {
    await db.destroy();
  }
}

export async function publishCloudflareTestPlacement(settings: Settings, input: unknown): Promise<{ status: "published" | "existing_placement" }> {
  const receipt = parseCloudflareTestReceipt(input);
  const db = await createHubDatabase(settings.database);
  try {
    const organization = await db.selectFrom("organization").select(["id", "slug"]).where("id", "=", receipt.workspaceId).executeTakeFirst();
    const master = await db.selectFrom("user").select("role").where("id", "=", receipt.loginId).executeTakeFirst();
    const client = await db.withoutPlugins().withTables<{ oauthClient: { clientId: string; userId: string | null } }>()
      .selectFrom("oauthClient").select("userId").where("clientId", "=", receipt.clientId).executeTakeFirst();
    if (organization?.slug !== "xpro-test" || !master?.role?.split(",").includes("admin") || client?.userId !== receipt.loginId) {
      throw new Error("Prepared test workspace or master is missing.");
    }
    const [workspace, worker, address] = await Promise.all([
      db.selectFrom("workspacePlacements").select("id").where("organizationId", "=", receipt.workspaceId).executeTakeFirst(),
      db.selectFrom("workspacePlacements").select("id").where("workerName", "=", "xpro-test").executeTakeFirst(),
      db.selectFrom("workspaceAddresses").select("id").where("origin", "=", receipt.workspaceOrigin).executeTakeFirst(),
    ]);
    if (workspace || worker || address) return { status: "existing_placement" };
    const placementId = v7(), createdAt = new Date().toISOString();
    await saveHub(settings.database, [
      db.insertInto("workspacePlacements").values({ id: placementId, organizationId: receipt.workspaceId, workerName: "xpro-test", createdAt }).compile(),
      db.insertInto("workspaceAddresses").values({ id: v7(), workspacePlacementId: placementId,
        origin: receipt.workspaceOrigin, isPrimary: 1, createdAt }).compile(),
      db.insertInto("auditEntries").values({ id: v7(), action: "stms_test_workspace_published", outcome: "success",
        actorLoginId: receipt.loginId, affectedLoginId: null, reason: null, comment: null,
        requestId: settings.context.requestId, createdAt }).compile(),
    ]);
    return { status: "published" };
  } finally {
    await db.destroy();
  }
}
