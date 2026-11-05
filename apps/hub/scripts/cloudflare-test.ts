import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequestContext, reportUnexpectedError } from "@xpro/core/server";
import { prepareCloudflareTest, publishCloudflareTestPlacement } from "./cloudflare-test.db";
import { readPrivateSetupJson, reserveCloudflareTestFiles } from "./cloudflare-test-files";
import { CLOUDFLARE_TEST_TARGET, parseCloudflareTestInput,
  parseCloudflareTestReceipt } from "./cloudflare-test-settings";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const privateDirectory = join(root, ".cloudflare-test.local");
const context = createRequestContext();

async function main(): Promise<void> {
  const [step, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || (step !== "prepare" && step !== "publish-placement")) {
    throw new Error("Use prepare or publish-placement, without additional arguments.");
  }
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ACCOUNT_ID !== CLOUDFLARE_TEST_TARGET.accountId) {
    throw new Error("The selected Cloudflare account does not match the test account.");
  }

  // Import Wrangler only after fixing its diagnostics settings. Native library
  // errors and proxy diagnostics must never print operator values or credentials.
  process.env.WRANGLER_LOG = "none";
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_LOG_PATH = join(privateDirectory, "wrangler-logs");
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.WRANGLER_HIDE_BANNER = "true";
  const { getPlatformProxy } = await import("wrangler");
  const temporary = await mkdtemp(join(tmpdir(), "xpro-test-setup-"));
  try {
    const configPath = join(temporary, "wrangler.json");
    await writeFile(configPath, JSON.stringify({
      name: "xpro-hub-test", account_id: CLOUDFLARE_TEST_TARGET.accountId,
      compatibility_date: "2025-09-02",
      compatibility_flags: ["nodejs_compat", "unhandled_rejection_after_microtask_checkpoint"],
      d1_databases: [{ binding: "DB", database_name: "xpro-hub-test",
        database_id: CLOUDFLARE_TEST_TARGET.databaseId, remote: true }],
    }), { mode: 0o600 });
    if (step === "prepare") {
      const input = parseCloudflareTestInput(await readPrivateSetupJson(privateDirectory, "operator.json"));
      const outputs = await reserveCloudflareTestFiles(privateDirectory);
      try {
        const proxy = await getPlatformProxy<Pick<HubEnv, "DB">>({ configPath, envFiles: [], persist: false, remoteBindings: true });
        try {
          const result = await prepareCloudflareTest({ database: proxy.env.DB, context }, input);
          if (result.status !== "prepared") {
            console.log(JSON.stringify({ event: "stms_test_setup", step, requestId: context.requestId, ...result }));
            process.exitCode = 1;
            return;
          }
          // shortcut: attended setup does not atomically commit native D1 writes
          // and operator files. Add resumable setup before unattended execution.
          await outputs.hub.writeFile(JSON.stringify({ BETTER_AUTH_SECRET: input.hubSecret,
            TURNSTILE_SITE_KEY: input.turnstileSiteKey, TURNSTILE_SECRET_KEY: input.turnstileSecretKey }) + "\n");
          await outputs.workspace.writeFile(JSON.stringify({ WORKSPACE_ID: result.receipt.workspaceId,
            OIDC_CLIENT_ID: result.receipt.clientId, OIDC_CLIENT_SECRET: result.clientSecret,
            WORKSPACE_SESSION_SECRET: input.workspaceSessionSecret }) + "\n");
          await outputs.receipt.writeFile(JSON.stringify(result.receipt) + "\n");
          console.log(JSON.stringify({ event: "stms_test_setup", step, status: result.status,
            requestId: context.requestId, ...result.receipt }));
        } finally { await proxy.dispose(); }
      } finally {
        await Promise.all([outputs.hub.close(), outputs.workspace.close(), outputs.receipt.close()]);
      }
    } else {
      // The operator approves this separate write only after checking the three
      // deployed Workers and their bindings. This command does not deploy them.
      const receipt = parseCloudflareTestReceipt(await readPrivateSetupJson(privateDirectory, "prepared.json"));
      const proxy = await getPlatformProxy<Pick<HubEnv, "DB">>({ configPath, envFiles: [], persist: false, remoteBindings: true });
      try {
        const result = await publishCloudflareTestPlacement({ database: proxy.env.DB, context }, receipt);
        console.log(JSON.stringify({ event: "stms_test_setup", step, requestId: context.requestId, ...result }));
        if (result.status !== "published") process.exitCode = 1;
      } finally { await proxy.dispose(); }
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

try { await main(); }
catch {
  reportUnexpectedError(context, { app: "hub", operation: "stms_test_setup" });
  process.exitCode = 1;
}
