import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRequestContext, reportUnexpectedError } from "@xpro/core/server";
import { getPlatformProxy, unstable_readConfig, type Unstable_Config } from "wrangler";
import { readAccountWorkspacePreflight } from "./account-workspace-preflight.db";
import { CLOUDFLARE_TEST_TARGET } from "./cloudflare-test-settings";

export type PreflightOptions = { environment: "local" | "test"; remote: boolean };
const usage = "Use bun run preflight:account-workspaces --env local, or --env test [--remote] for an approved read.";

async function main(): Promise<void> {
  let options: PreflightOptions;
  try { options = readPreflightOptions(process.argv.slice(2)); }
  catch { console.error(usage); process.exitCode = 1; return; }
  const context = createRequestContext();
  const directory = await mkdtemp(join(tmpdir(), "xpro-account-preflight-"));
  try {
    if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ACCOUNT_ID !== CLOUDFLARE_TEST_TARGET.accountId) {
      throw new Error("The account does not match the approved test target.");
    }
    process.env.WRANGLER_LOG = "none";
    process.env.WRANGLER_WRITE_LOGS = "false";
    process.env.WRANGLER_LOG_PATH = join(directory, "wrangler.log");
    process.env.WRANGLER_SEND_METRICS = "false";
    process.env.WRANGLER_HIDE_BANNER = "true";
    const source = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
    const config: Unstable_Config = unstable_readConfig({ config: source, env: options.environment },
      { hideWarnings: true, useRedirectIfAvailable: false });
    const name = options.environment === "local" ? "xpro-hub" : "xpro-hub-test";
    const database = config.d1_databases.find((binding) => binding.binding === "DB");
    if (config.name !== name || !database || database.database_name !== name
      || (options.environment === "test" && (config.account_id !== CLOUDFLARE_TEST_TARGET.accountId
        || database.database_id !== CLOUDFLARE_TEST_TARGET.databaseId))
      || (options.environment === "local" && database.database_id !== undefined)) {
      throw new Error("The configured database does not match the preflight target.");
    }
    const configPath = join(directory, "wrangler.json");
    await writeFile(configPath, JSON.stringify({
      name, account_id: options.environment === "test" ? CLOUDFLARE_TEST_TARGET.accountId : undefined,
      compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags,
      d1_databases: [{ binding: "DB", database_name: database.database_name,
        database_id: database.database_id, remote: options.remote }],
    }), { mode: 0o600 });
    const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath, envFiles: [],
      persist: options.remote ? false : { path: fileURLToPath(new URL("../.wrangler/state/v3", import.meta.url)) },
      remoteBindings: options.remote });
    try {
      const result = await readAccountWorkspacePreflight(proxy.env.DB);
      console.log(JSON.stringify({ event: "stms_account_workspace_preflight", environment: options.environment,
        remote: options.remote, ...result }));
      if (result.status !== "clear") process.exitCode = 2;
    } finally { await proxy.dispose(); }
  } catch {
    reportUnexpectedError(context, { app: "hub", operation: "stms_account_workspace_preflight" });
    process.exitCode = 1;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function readPreflightOptions(args: string[]): PreflightOptions {
  const parsed = parseArgs({ args, options: { env: { type: "string" }, remote: { type: "boolean" } }, tokens: true });
  if ((parsed.values.env !== "local" && parsed.values.env !== "test")
    || (parsed.values.remote && parsed.values.env !== "test")
    || ["env", "remote"].some((name) => parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length > 1)) {
    throw new Error("Invalid preflight options.");
  }
  return { environment: parsed.values.env, remote: parsed.values.remote ?? false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
