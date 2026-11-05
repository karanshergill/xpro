import { appendFile, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { experimental_readRawConfig, unstable_readConfig } from "wrangler";
import { runRelease, type ReleaseCommand } from "../../scripts/release.ts";
import { CLOUDFLARE_TEST_TARGET } from "../../apps/hub/scripts/cloudflare-test-settings.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const secret = "synthetic-release-secret-never-printed";
const ids = { hub: "60013c39-1812-4e5c-a279-236222a182d2", web: "a903955912df41d3b6a479ff00976436", router: "adabfa0e-0f47-4ebe-92e2-c22c882d29db" };
let directory: string;
let commands: { args: string[]; logPath: string }[];
let published: string[];
let previousAccount: string | undefined;
let previousEnvironment: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "xpro-release-test-")); commands = []; published = [];
  previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  previousEnvironment = process.env.CLOUDFLARE_ENV;
  delete process.env.CLOUDFLARE_ENV;
  process.env.CLOUDFLARE_ACCOUNT_ID = CLOUDFLARE_TEST_TARGET.accountId;
  for (const app of ["hub", "web", "router"]) {
    await mkdir(join(directory, "apps", app), { recursive: true });
    await copyFile(join(root, "apps", app, "wrangler.jsonc"), join(directory, "apps", app, "wrangler.jsonc"));
  }
});
afterEach(async () => {
  try {
    for (const path of new Set(commands.map((command) => dirname(command.logPath)))) {
      await expect(readdir(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    if (previousAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;
    if (previousEnvironment === undefined) delete process.env.CLOUDFLARE_ENV;
    else process.env.CLOUDFLARE_ENV = previousEnvironment;
    await rm(directory, { recursive: true, force: true });
  }
});

async function externalTools(command: ReleaseCommand): Promise<string> {
  commands.push({ args: command.args, logPath: command.env.WRANGLER_LOG_PATH ?? "" });
  expect(command.cwd).toBe(directory);
  expect(command.env.CLOUDFLARE_ACCOUNT_ID).toBe(CLOUDFLARE_TEST_TARGET.accountId);
  if (command.args[0] === "--filter") {
    expect(command.env.CLOUDFLARE_ENV).toBe("test");
    const app = command.args[1].replace("@xpro/", "");
    const { rawConfig } = experimental_readRawConfig({ config: join(directory, "apps", app, "wrangler.jsonc") });
    const generated = { ...rawConfig, ...rawConfig.env?.test, env: undefined };
    const output = join(directory, "apps", app, "dist/server");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "wrangler.json"), JSON.stringify(generated));
  } else if (command.args.includes("whoami")) {
    return JSON.stringify({ loggedIn: true, email: secret, accounts: [{ id: CLOUDFLARE_TEST_TARGET.accountId }] });
  } else {
    const app = command.args[5].includes("/hub/") ? "hub" : command.args[5].includes("/web/") ? "web" : "router";
    const environmentIndex = command.args.indexOf("--env");
    const configuration = unstable_readConfig({ config: command.args[5],
      env: environmentIndex < 0 ? command.env.CLOUDFLARE_ENV ?? "" : command.args[environmentIndex + 1] }, { hideWarnings: true, useRedirectIfAvailable: false });
    if (!command.args.includes("--dry-run")) published.push(app);
    const output = command.env.WRANGLER_OUTPUT_FILE_PATH;
    if (!output) throw new Error("Missing native output path.");
    await appendFile(output, JSON.stringify({ type: "deploy", version: 1, worker_name: configuration.name, version_id: command.args.includes("--dry-run") ? null : ids[app] }) + "\n");
  }
  return secret;
}

async function prepareSecrets(): Promise<string> {
  const privateDirectory = join(directory, ".cloudflare-test.local");
  await mkdir(privateDirectory, { mode: 0o700 });
  const prepared = { ...CLOUDFLARE_TEST_TARGET, loginId: "019a2f10-1234-7000-8000-000000000001", workspaceId: "019a2f10-1234-7000-8000-000000000002", clientId: "synthetic-client" };
  for (const [name, value] of Object.entries({ "prepared.json": prepared,
    "hub.json": { BETTER_AUTH_SECRET: secret, TURNSTILE_SECRET_KEY: secret, TURNSTILE_SITE_KEY: "synthetic-site" },
    "workspace.json": { WORKSPACE_ID: prepared.workspaceId, OIDC_CLIENT_ID: prepared.clientId, OIDC_CLIENT_SECRET: secret, WORKSPACE_SESSION_SECRET: secret } })) {
    await writeFile(join(privateDirectory, name), JSON.stringify(value), { mode: 0o600 });
  }
  return privateDirectory;
}

describe("release target selection", () => {
  it.each([[], ["--publish"], ["--env", "local"], ["--env", "production"], ["--env", "test", "--env", "test"], ["--env", "test", "--name", "xpro"], ["--env", "test", "unexpected"]].map((args) => ({ args })))("when arguments are unsupported $args then no outside command runs", async ({ args }) => {
    const result = await runRelease({ root: directory, args, run: externalTools });
    expect(result).toEqual({ status: "failed", environment: "test", stage: "options", plan: null, deployments: [], receipt: null });
    expect(commands).toEqual([]);
  });
  it.each(["account", "namespace", "public_workspace"])("when the configured %s differs from the approved target then nothing builds or deploys", async (kind) => {
    const app = kind === "public_workspace" ? "web" : "hub";
    const path = join(directory, "apps", app, "wrangler.jsonc"), source = JSON.parse(await readFile(path, "utf8"));
    if (kind === "account") source.env.test.account_id = "0".repeat(32);
    if (kind === "namespace") source.env.test.dispatch_namespaces[0].namespace = "production";
    if (kind === "public_workspace") source.env.test.workers_dev = true;
    await writeFile(path, JSON.stringify(source));
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run: externalTools })).toMatchObject({ status: "failed", stage: "target", deployments: [], receipt: null });
    expect(commands).toEqual([]);
  });
  it("when the inherited account conflicts with the requested test target then no outside command runs", async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "0".repeat(32);
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run: externalTools })).toEqual({ status: "failed", environment: "test", stage: "target", plan: null, deployments: [], receipt: null });
    expect(commands).toEqual([]);
  });
  it.each(["service", "privacy"])("when generated %s settings differ then packaging and publication do not start", async (kind) => {
    const run = async (command: ReleaseCommand): Promise<string> => {
      const output = await externalTools(command);
      if (command.args[1] === "@xpro/web") {
        const path = join(directory, "apps/web/dist/server/wrangler.json"), config = JSON.parse(await readFile(path, "utf8"));
        if (kind === "service") config.services[0].service = "xpro-hub";
        else config.observability.redact_query_string = false;
        await writeFile(path, JSON.stringify(config));
      }
      return output;
    };
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run })).toMatchObject({ status: "failed", stage: "built_target", deployments: [], receipt: null });
    expect(commands.map((command) => command.args[0])).toEqual(["--filter", "--filter"]);
  });
});

describe("release preview and publication", () => {
  it("when the first build fails then later builds and all deployment steps stop", async () => {
    const run = async (command: ReleaseCommand): Promise<string> => { commands.push({ args: command.args, logPath: command.env.WRANGLER_LOG_PATH ?? "" }); throw new Error(secret); };
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run })).toEqual({ status: "failed", environment: "test", stage: "build_hub", plan: expect.objectContaining({ accountId: CLOUDFLARE_TEST_TARGET.accountId }), deployments: [], receipt: null });
    expect(commands.map((command) => command.args)).toEqual([["--filter", "@xpro/hub", "build"]]);
  });
  it("when preview is selected then all apps are packaged without authentication, secrets or remote changes", async () => {
    const result = await runRelease({ root: directory, args: ["--env", "test"], run: externalTools });
    expect(result).toEqual({ status: "checked", environment: "test", stage: "complete", deployments: [], receipt: null, plan: {
      accountId: CLOUDFLARE_TEST_TARGET.accountId, targets: [
        expect.objectContaining({ app: "hub", worker: "xpro-hub-test", configuration: "apps/hub/dist/server/wrangler.json", dispatchNamespace: null, requiredSecrets: ["BETTER_AUTH_SECRET", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"] }),
        expect.objectContaining({ app: "web", worker: "xpro-test", configuration: "apps/web/dist/server/wrangler.json", dispatchNamespace: "xpro-workspaces-test", requiredSecrets: ["WORKSPACE_ID", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "WORKSPACE_SESSION_SECRET"] }),
        expect.objectContaining({ app: "router", worker: "xpro-router-test", configuration: "apps/router/wrangler.jsonc", dispatchNamespace: null, requiredSecrets: [] }),
      ],
    } });
    expect(commands.map((command) => command.args[0])).toEqual(["--filter", "--filter", "x", "x", "x"]);
    expect(commands.slice(2).every((command) => command.args.includes("--dry-run"))).toBe(true);
    expect(commands[3].args).toContain("--dispatch-namespace");
    expect(published).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it.each(["test", "production"])("when the caller inherits %s then generated test configurations still package their exact Worker names", async (environment) => {
    process.env.CLOUDFLARE_ENV = environment;
    expect(await runRelease({ root: directory, args: ["--env", "test"], run: externalTools })).toMatchObject({ status: "checked", stage: "complete" });
    expect(process.env.CLOUDFLARE_ENV).toBe(environment);
    expect(published).toEqual([]);
  });
  it.each(["hub", "web", "router"])("when native packaging targets an unexpected %s Worker then authentication and publication never start", async (app) => {
    const run = async (command: ReleaseCommand): Promise<string> => {
      const output = await externalTools(command);
      if (command.args.includes("--dry-run") && command.args[5].includes("/" + app + "/")) {
        await writeFile(command.env.WRANGLER_OUTPUT_FILE_PATH ?? "missing", JSON.stringify({ type: "deploy", worker_name: "wrong-worker", version_id: null }) + "\n");
      }
      return output;
    };
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run })).toMatchObject({ status: "failed", stage: "package_" + app, deployments: [], receipt: null });
    expect(commands.some((command) => command.args.includes("whoami"))).toBe(false);
    expect(published).toEqual([]);
  });
  it("when the dry-run acknowledgement contains a live version then publication is refused", async () => {
    const run = async (command: ReleaseCommand): Promise<string> => {
      const output = await externalTools(command);
      if (command.args.includes("--dry-run")) {
        await writeFile(command.env.WRANGLER_OUTPUT_FILE_PATH ?? "missing", JSON.stringify({ type: "deploy", worker_name: "xpro-hub-test", version_id: ids.hub }) + "\n");
      }
      return output;
    };
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run })).toMatchObject({ status: "failed", stage: "package_hub", deployments: [], receipt: null });
    expect(published).toEqual([]);
  });
  it("when prepared publication succeeds then Hub, private workspace and router IDs are recorded without private values", async () => {
    const privateDirectory = await prepareSecrets();
    const originals = await Promise.all(["prepared.json", "hub.json", "workspace.json"].map((name) => readFile(join(privateDirectory, name), "utf8")));
    const result = await runRelease({ root: directory, args: ["--env", "test", "--publish"], run: externalTools });
    expect(result).toEqual({ status: "published", environment: "test", stage: "complete", plan: expect.objectContaining({ accountId: CLOUDFLARE_TEST_TARGET.accountId }), receipt: expect.stringMatching(/^\.cloudflare-test\.local\/release-[a-f0-9-]+\.json$/), deployments: [
      { app: "hub", worker: "xpro-hub-test", versionId: ids.hub }, { app: "web", worker: "xpro-test", versionId: ids.web }, { app: "router", worker: "xpro-router-test", versionId: ids.router },
    ] });
    expect(published).toEqual(["hub", "web", "router"]);
    const receiptPath = join(directory, result.receipt ?? "missing");
    expect((await stat(receiptPath)).mode & 0o777).toBe(0o600);
    const receipt = await readFile(receiptPath, "utf8");
    expect(JSON.parse(receipt)).toMatchObject(JSON.parse(JSON.stringify(result)));
    expect(receipt).not.toContain(secret);
    expect(await Promise.all(["prepared.json", "hub.json", "workspace.json"].map((name) => readFile(join(privateDirectory, name), "utf8")))).toEqual(originals);
  });
  it("when workspace publication fails after Hub succeeds then the partial receipt survives and the router is untouched", async () => {
    await prepareSecrets();
    const run = async (command: ReleaseCommand): Promise<string> => {
      if (command.args.includes("--strict") && command.args.includes("--dispatch-namespace")) throw new Error(secret);
      return await externalTools(command);
    };
    const result = await runRelease({ root: directory, args: ["--env", "test", "--publish"], run });
    expect(result).toMatchObject({ status: "failed", stage: "publish_web", deployments: [{ app: "hub", worker: "xpro-hub-test", versionId: ids.hub }] });
    expect(published).toEqual(["hub"]);
    const receipt = await readFile(join(directory, result.receipt ?? "missing"), "utf8");
    expect(JSON.parse(receipt)).toMatchObject(JSON.parse(JSON.stringify(result)));
    expect(receipt).not.toContain(secret);
  });
  it("when authentication is for another account then no secret or deployment is used", async () => {
    const run = async (command: ReleaseCommand): Promise<string> => command.args.includes("whoami") ? JSON.stringify({ loggedIn: true, accounts: [{ id: "0".repeat(32) }] }) : await externalTools(command);
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run })).toMatchObject({ status: "failed", stage: "account", deployments: [], receipt: null });
    expect(published).toEqual([]);
  });
  it.each(["worker", "version"])("when native acknowledgement has an invalid %s then later Workers are not published", async (kind) => {
    await prepareSecrets();
    const run = async (command: ReleaseCommand): Promise<string> => {
      const output = await externalTools(command);
      if (command.args.includes("--strict")) await writeFile(command.env.WRANGLER_OUTPUT_FILE_PATH ?? "missing", JSON.stringify({ type: "deploy", worker_name: kind === "worker" ? "wrong-worker" : "xpro-hub-test", version_id: kind === "version" ? secret : ids.hub }) + "\n");
      return output;
    };
    const result = await runRelease({ root: directory, args: ["--env", "test", "--publish"], run });
    expect(result).toMatchObject({ status: "failed", stage: "publish_hub", deployments: [] });
    expect(published).toEqual(["hub"]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("when operator secret files are readable by others then publication is refused", async () => {
    const privateDirectory = await prepareSecrets(); await chmod(join(privateDirectory, "hub.json"), 0o644);
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run: externalTools })).toMatchObject({ status: "failed", stage: "secrets", deployments: [], receipt: null });
    expect(published).toEqual([]);
  });
  it("when workspace secrets belong to another prepared identity then publication is refused", async () => {
    const privateDirectory = await prepareSecrets(), path = join(privateDirectory, "workspace.json"), input = JSON.parse(await readFile(path, "utf8"));
    input.WORKSPACE_ID = "019a2f10-1234-7000-8000-000000000099"; await writeFile(path, JSON.stringify(input));
    expect(await runRelease({ root: directory, args: ["--env", "test", "--publish"], run: externalTools })).toMatchObject({ status: "failed", stage: "secrets", deployments: [], receipt: null });
    expect(published).toEqual([]);
  });
});
