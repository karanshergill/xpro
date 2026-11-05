import assert from "node:assert/strict";
import { join, relative } from "node:path";
import { experimental_readRawConfig, unstable_readConfig, type Unstable_Config } from "wrangler";
import { readPrivateSetupJson } from "../apps/hub/scripts/cloudflare-test-files.ts";
import { CLOUDFLARE_TEST_TARGET, parseCloudflareTestReceipt } from "../apps/hub/scripts/cloudflare-test-settings.ts";

export type ReleaseTarget = { app: "hub" | "web" | "router"; name: string; configPath: string; args: string[]; config: Unstable_Config };
export type ReleasePlan = {
  accountId: string;
  targets: {
    app: string; worker: string; configuration: string; dispatchNamespace: string | null;
    bindings: Pick<Unstable_Config, "services" | "d1_databases" | "r2_buckets" | "kv_namespaces" | "dispatch_namespaces" | "durable_objects" | "flagship" | "images" | "ratelimits">;
    requiredSecrets: string[];
  }[];
};
const bindingKeys = ["vars", "services", "r2_buckets", "kv_namespaces", "dispatch_namespaces", "durable_objects", "flagship", "images", "ratelimits", "migrations", "observability", "secrets", "workers_dev", "preview_urls", "compatibility_date", "compatibility_flags"] as const;

export function readTestRelease(root: string): ReleaseTarget[] {
  const targets = (["hub", "web", "router"] as const).map((app) => {
    const source = join(root, "apps", app, "wrangler.jsonc");
    const { rawConfig } = experimental_readRawConfig({ config: source }, { useRedirectIfAvailable: false });
    assert.ok(Object.hasOwn(rawConfig.env ?? {}, "test"));
    assert.equal(rawConfig.name, app === "web" ? "xpro" : "xpro-" + app);
    const config = unstable_readConfig({ config: source, env: "test" }, { hideWarnings: true, useRedirectIfAvailable: false });
    assert.equal(config.account_id, CLOUDFLARE_TEST_TARGET.accountId);
    const name = app === "web" ? "xpro-test" : "xpro-" + app + "-test";
    assert.equal(config.name, name);
    assert.equal(config.preview_urls, false);
    assert.equal(config.workers_dev, app !== "web");
    assert.deepEqual(config.unsafe, {});
    assert.ok(!config.routes?.length && !config.route);
    const path = app === "router" ? source : join(root, "apps", app, "dist/server/wrangler.json");
    return { app, name, configPath: path, config, args: ["x", "--no-install", "wrangler", "deploy", "--config", path,
      ...(app === "router" ? ["--env", "test"] : []), ...(app === "web" ? ["--dispatch-namespace", "xpro-workspaces-test"] : []), "--no-autoconfig"] };
  });
  for (const target of targets) assertTestBindings(target);
  return targets;
}

export function checkBuiltRelease(targets: ReleaseTarget[]): void {
  for (const target of targets) {
    // Vite has already flattened the selected environment into the built configuration.
    const config = unstable_readConfig({ config: target.configPath, env: target.app === "router" ? "test" : "" }, { hideWarnings: true, useRedirectIfAvailable: false });
    assert.equal(config.name, target.name);
    assert.equal(config.account_id, CLOUDFLARE_TEST_TARGET.accountId);
    // Vite relocates the local migration directory; this command never runs migrations.
    assert.deepEqual(config.d1_databases.map(({ migrations_dir, ...binding }: Record<string, unknown>) => binding), target.config.d1_databases);
    for (const key of bindingKeys) assert.deepEqual(config[key], target.config[key]);
  }
}

export function describeRelease({ root, targets }: { root: string; targets: ReleaseTarget[] }): ReleasePlan {
  return { accountId: CLOUDFLARE_TEST_TARGET.accountId, targets: targets.map(({ app, name, configPath, config }) => ({
    app, worker: name, configuration: relative(root, configPath), dispatchNamespace: app === "web" ? "xpro-workspaces-test" : null,
    bindings: { services: config.services, d1_databases: config.d1_databases, r2_buckets: config.r2_buckets,
      kv_namespaces: config.kv_namespaces, dispatch_namespaces: config.dispatch_namespaces, durable_objects: config.durable_objects,
      flagship: config.flagship, images: config.images, ratelimits: config.ratelimits },
    requiredSecrets: config.secrets?.required ?? [],
  })) };
}

export async function readReleaseSecrets(directory: string): Promise<{ hub: Record<string, string>; web: Record<string, string> }> {
  const prepared = parseCloudflareTestReceipt(await readPrivateSetupJson(directory, "prepared.json"));
  const hub = parseSecrets(await readPrivateSetupJson(directory, "hub.json"), ["BETTER_AUTH_SECRET", "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"]);
  const web = parseSecrets(await readPrivateSetupJson(directory, "workspace.json"), ["WORKSPACE_ID", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "WORKSPACE_SESSION_SECRET"]);
  assert.equal(web.WORKSPACE_ID, prepared.workspaceId);
  assert.equal(web.OIDC_CLIENT_ID, prepared.clientId);
  return { hub, web };
}

export function checkReleaseAccount(input: string): void {
  const user: unknown = JSON.parse(input);
  assert.ok(isRecord(user) && user.loggedIn === true && Array.isArray(user.accounts));
  assert.ok(user.accounts.some((account: unknown) => isRecord(account) && account.id === CLOUDFLARE_TEST_TARGET.accountId));
}

export function checkPackagedTarget(input: string, target: ReleaseTarget): void {
  assert.equal(readDeploymentRecord(input, target).version_id, null);
}

export function readDeployment(input: string, target: ReleaseTarget): { app: string; worker: string; versionId: string } {
  const entry = readDeploymentRecord(input, target);
  assert.ok(typeof entry.version_id === "string");
  assert.match(entry.version_id, /^(?:[a-f0-9]{32}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i);
  return { app: target.app, worker: target.name, versionId: entry.version_id };
}

function readDeploymentRecord(input: string, target: ReleaseTarget): Record<string, unknown> {
  const records: unknown[] = input.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const deployments = records.filter((entry) => isRecord(entry) && entry.type === "deploy");
  assert.equal(deployments.length, 1);
  const entry = deployments[0];
  assert.ok(isRecord(entry) && entry.worker_name === target.name);
  return entry;
}

function assertTestBindings({ app, config }: ReleaseTarget): void {
  const hubService = { binding: "HUB", service: "xpro-hub-test", remote: false };
  assert.deepEqual(config.services, app === "hub" ? [] : [hubService, { binding: app === "web" ? "HUB_ACCESS" : "HUB_PLACEMENT", service: "xpro-hub-test", entrypoint: app === "web" ? "HubAccess" : "HubPlacement", remote: false }]);
  assert.deepEqual(config.dispatch_namespaces, app === "web" ? [] : [{ binding: "DISPATCHER", namespace: "xpro-workspaces-test", remote: false }]);
  assert.deepEqual(config.d1_databases, app === "hub" ? [{ binding: "DB", database_name: "xpro-hub-test", database_id: CLOUDFLARE_TEST_TARGET.databaseId, remote: false }] : []);
  assert.deepEqual(config.r2_buckets, app === "hub" ? [{ binding: "PROFILE_PICTURES", bucket_name: "xpro-profile-pictures-test", remote: false }] : []);
  assert.deepEqual(config.kv_namespaces, app === "router" ? [{ binding: "PLACEMENTS", id: "52c196caafa54a7aa333318c8031dbba", remote: false }] : []);
  assert.deepEqual(config.flagship, app === "hub" ? [{ binding: "FLAGS", app_id: "d6054b12-d093-4d58-b5ef-7ca8e03bac3e", remote: false }] : []);
  assert.deepEqual(config.durable_objects, { bindings: app === "web" ? [{ name: "WORKSPACES", class_name: "Workspace" }] : [] });
  assert.deepEqual(config.images, app === "hub" ? { binding: "IMAGES", remote: false } : undefined);
  assert.deepEqual(config.ratelimits, app === "hub" ? [{ name: "SIGN_IN_RATE_LIMITER", namespace_id: "1004", simple: { limit: 10, period: 60 } }] : []);
  assert.deepEqual(config.vars, app === "hub" ? { BETTER_AUTH_URL: CLOUDFLARE_TEST_TARGET.hubOrigin } : { HUB_ORIGIN: CLOUDFLARE_TEST_TARGET.hubOrigin, ...(app === "web" ? { WORKSPACE_ORIGINS: JSON.stringify([CLOUDFLARE_TEST_TARGET.workspaceOrigin]) } : {}) });
}

function parseSecrets(input: unknown, keys: string[]): Record<string, string> {
  assert.ok(isRecord(input));
  assert.deepEqual(Object.keys(input).sort(), [...keys].sort());
  return Object.fromEntries(keys.map((key) => {
    const value = input[key];
    assert.ok(typeof value === "string" && value.length > 0);
    return [key, value];
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
