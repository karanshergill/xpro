import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { CLOUDFLARE_TEST_TARGET } from "../apps/hub/scripts/cloudflare-test-settings.ts";
import { checkBuiltRelease, checkPackagedTarget, checkReleaseAccount, describeRelease, readDeployment, readReleaseSecrets, readTestRelease, type ReleasePlan } from "./release-config.ts";

type Options = { environment: "test"; mode: "check" | "publish" };
export type ReleaseCommand = { args: string[]; cwd: string; env: NodeJS.ProcessEnv };
type Deployment = { app: string; worker: string; versionId: string };
type Receipt = { status: "checked" | "publishing" | "published" | "failed"; environment: "test"; stage: string; plan: ReleasePlan | null; deployments: Deployment[]; receipt: string | null };
type ReleaseInput = { root: string; args: string[]; run: (command: ReleaseCommand) => Promise<string> };
const executeFile = promisify(execFile);
const usage = "Use bun run release --env test to preview, or add --publish for an approved test deployment.";

export async function runRelease({ root, args, run }: ReleaseInput): Promise<Receipt> {
  const result: Receipt = { status: "failed", environment: "test", stage: "options", plan: null, deployments: [], receipt: null };
  let temporary: string | null = null;
  let receipt: string | null = null;
  try {
    const options = parseReleaseOptions(args);
    result.stage = "target";
    assert.ok(!process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID === CLOUDFLARE_TEST_TARGET.accountId);
    const targets = readTestRelease(root);
    result.plan = describeRelease({ root, targets });
    temporary = await mkdtemp(join(tmpdir(), "xpro-release-"));
    const output = join(temporary, "output.ndjson");
    const env: NodeJS.ProcessEnv = { ...process.env,
      CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_TEST_TARGET.accountId, WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: join(temporary, "wrangler.log"), WRANGLER_OUTPUT_FILE_PATH: output, CI: "true", NO_COLOR: "1" };
    delete env.WRANGLER_CI_OVERRIDE_NAME;
    delete env.CLOUDFLARE_ENV;
    for (const app of ["hub", "web"]) {
      result.stage = "build_" + app;
      await run({ args: ["--filter", "@xpro/" + app, "build"], cwd: root, env: { ...env, CLOUDFLARE_ENV: options.environment } });
    }
    result.stage = "built_target";
    checkBuiltRelease(targets);
    for (const target of targets) {
      result.stage = "package_" + target.app;
      await rm(output, { force: true });
      await run({ args: [...target.args, "--dry-run", "--outdir", join(temporary, target.app)], cwd: root, env });
      checkPackagedTarget(await readFile(output, "utf8"), target);
    }
    if (options.mode === "check") { result.status = "checked"; result.stage = "complete"; return result; }
    result.stage = "account";
    checkReleaseAccount(await run({ args: ["x", "--no-install", "wrangler", "whoami", "--json"], cwd: root, env }));
    result.stage = "secrets";
    const directory = join(root, ".cloudflare-test.local");
    const secrets = await readReleaseSecrets(directory);
    for (const app of ["hub", "web"] as const) await writeFile(join(temporary, app + ".json"), JSON.stringify(secrets[app]), { mode: 0o600 });
    receipt = join(directory, "release-" + randomUUID() + ".json");
    await (await open(receipt, "wx", 0o600)).close();
    result.receipt = relative(root, receipt);
    result.status = "publishing";
    await saveReceipt(receipt, result);
    for (const target of targets) {
      result.stage = "publish_" + target.app;
      await saveReceipt(receipt, result);
      await rm(output, { force: true });
      await run({ args: [...target.args, "--strict", ...(target.app === "router" ? [] : ["--secrets-file", join(temporary, target.app + ".json")])], cwd: root, env });
      result.deployments.push(readDeployment(await readFile(output, "utf8"), target));
      await saveReceipt(receipt, result);
    }
    result.status = "published"; result.stage = "complete";
    await saveReceipt(receipt, result);
    return result;
  } catch {
    result.status = "failed";
    if (receipt) await saveReceipt(receipt, result);
    return result;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

function parseReleaseOptions(args: string[]): Options {
  const parsed = parseArgs({ args, options: { env: { type: "string" }, publish: { type: "boolean" } }, tokens: true });
  assert.equal(parsed.values.env, "test");
  for (const name of ["env", "publish"]) assert.ok(parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length <= 1);
  return { environment: "test", mode: parsed.values.publish ? "publish" : "check" };
}

async function saveReceipt(path: string, result: Receipt): Promise<void> {
  const temporary = path + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify({ ...result, accountId: CLOUDFLARE_TEST_TARGET.accountId, recordedAt: new Date().toISOString() }) + "\n", { mode: 0o600, flag: "wx", flush: true });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

async function runCommand(command: ReleaseCommand): Promise<string> {
  const result = await executeFile("bun", command.args, { cwd: command.cwd, env: command.env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  return result.stdout;
}

async function main(): Promise<void> {
  const result = await runRelease({ root: fileURLToPath(new URL("../", import.meta.url)), args: process.argv.slice(2), run: runCommand });
  console.log(JSON.stringify(result));
  if (result.status === "failed") { console.error(result.stage === "options" ? usage : "Release stopped at " + result.stage + ". Review any attempted deployment before retrying."); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch { console.error("Release interrupted. Review the private receipt and any attempted deployment before retrying."); process.exitCode = 1; }
}
