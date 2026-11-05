import { fileURLToPath } from "node:url";
import { createRequestContext, reportUnexpectedError } from "@xpro/core/server";
import { getPlatformProxy } from "wrangler";
import { createInitialMaster } from "#auth/initial-master.db.ts";
import { createHubDatabase, createHubMigrator } from "#db/hub.db.ts";

const context = createRequestContext();
try {
  const email = process.env.XPRO_INITIAL_MASTER_EMAIL;
  const password = process.env.XPRO_INITIAL_MASTER_PASSWORD;
  const baseURL = process.env.BETTER_AUTH_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!email || !password || !baseURL || !secret) {
    console.error("Supply XPRO_INITIAL_MASTER_EMAIL, XPRO_INITIAL_MASTER_PASSWORD, BETTER_AUTH_URL and BETTER_AUTH_SECRET.");
    process.exitCode = 1;
  } else {
    const proxy = await getPlatformProxy<HubEnv>({
      configPath: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
      environment: "local",
      persist: { path: fileURLToPath(new URL("../.wrangler/state/v3", import.meta.url)) },
      remoteBindings: false,
    });
    try {
      const db = await createHubDatabase(proxy.env.DB);
      try {
        const migrated = await createHubMigrator(db).migrateToLatest();
        if (migrated.error) throw migrated.error;
      } finally {
        await db.destroy();
      }
      const result = await createInitialMaster({ database: proxy.env.DB, baseURL, secret, requestContext: context }, { email, password });
      console.log(JSON.stringify({ event: "stms_initial_master_setup", target: "local", requestId: context.requestId, ...result }));
      if (result.status === "invalid_input") process.exitCode = 1;
    } finally {
      await proxy.dispose();
    }
  }
} catch {
  reportUnexpectedError(context, { app: "hub", operation: "stms_initial_master_setup" });
  process.exitCode = 1;
}
