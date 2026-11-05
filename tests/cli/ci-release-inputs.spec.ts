import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareCiReleaseInputs } from "../../scripts/ci-release-inputs.ts";
import { readReleaseSecrets } from "../../scripts/release-config.ts";
import { CLOUDFLARE_TEST_TARGET } from "../../apps/hub/scripts/cloudflare-test-settings.ts";

const source = fileURLToPath(new URL("../../", import.meta.url));
const secret = "synthetic-ci-secret-never-printed-123456789";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "xpro-ci-inputs-test-"));
  await writeFile(join(root, "unrelated.txt"), "unchanged");
});
afterEach(async () => {
  try { expect(await readFile(join(root, "unrelated.txt"), "utf8")).toBe("unchanged"); }
  finally { await rm(root, { recursive: true, force: true }); }
});
function inputs(): Record<string, string | undefined> {
  const prepared = { ...CLOUDFLARE_TEST_TARGET, loginId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), clientId: "synthetic-ci-client" };
  return {
    XPRO_TEST_PREPARED_JSON: JSON.stringify(prepared),
    XPRO_TEST_HUB_JSON: JSON.stringify({ BETTER_AUTH_SECRET: secret, TURNSTILE_SECRET_KEY: secret, TURNSTILE_SITE_KEY: "synthetic-site" }),
    XPRO_TEST_WORKSPACE_JSON: JSON.stringify({ WORKSPACE_ID: prepared.workspaceId, OIDC_CLIENT_ID: prepared.clientId, OIDC_CLIENT_SECRET: secret, WORKSPACE_SESSION_SECRET: secret }),
  };
}

describe("CI test release input preparation", () => {
  it("when all three secrets match the prepared test target then only owner-only files are created", async () => {
    const environment = inputs(), directory = join(root, ".cloudflare-test.local");
    await prepareCiReleaseInputs({ root, environment });
    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    expect((await readdir(directory)).sort()).toEqual(["hub.json", "prepared.json", "workspace.json"]);
    for (const [name, key] of [["hub.json", "XPRO_TEST_HUB_JSON"], ["prepared.json", "XPRO_TEST_PREPARED_JSON"], ["workspace.json", "XPRO_TEST_WORKSPACE_JSON"]]) {
      expect((await lstat(join(directory, name))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(directory, name), "utf8")).toBe(environment[key]);
    }
    expect(await readReleaseSecrets(directory)).toEqual({ hub: JSON.parse(environment.XPRO_TEST_HUB_JSON ?? "{}"), web: JSON.parse(environment.XPRO_TEST_WORKSPACE_JSON ?? "{}") });
  });
  it.each(["XPRO_TEST_PREPARED_JSON", "XPRO_TEST_HUB_JSON", "XPRO_TEST_WORKSPACE_JSON"])("when %s is missing then nothing is created", async (key) => {
    const environment = inputs(); delete environment[key];
    await expect(prepareCiReleaseInputs({ root, environment })).rejects.toThrow("three CI test input secrets");
    expect((await readdir(root)).sort()).toEqual(["unrelated.txt"]);
  });
  it.each(["json", "account", "workspace", "client"])("when the %s input is invalid then created files are removed and private values stay out of the error", async (kind) => {
    const environment = inputs();
    if (kind === "json") environment.XPRO_TEST_HUB_JSON = '{"private":"' + secret;
    else if (kind === "account") {
      const prepared = JSON.parse(environment.XPRO_TEST_PREPARED_JSON ?? "{}"); prepared.accountId = "0".repeat(32); environment.XPRO_TEST_PREPARED_JSON = JSON.stringify(prepared);
    } else {
      const workspace = JSON.parse(environment.XPRO_TEST_WORKSPACE_JSON ?? "{}");
      if (kind === "workspace") workspace.WORKSPACE_ID = crypto.randomUUID();
      else workspace.OIDC_CLIENT_ID = "another-client";
      environment.XPRO_TEST_WORKSPACE_JSON = JSON.stringify(workspace);
    }
    await expect(prepareCiReleaseInputs({ root, environment })).rejects.toThrow("The CI test release inputs are invalid.");
    expect((await readdir(root)).sort()).toEqual(["unrelated.txt"]);
  });
  it("when a private operator directory already exists then it and its contents are preserved", async () => {
    const directory = join(root, ".cloudflare-test.local"); await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, "hub.json"), secret, { mode: 0o600 });
    await expect(prepareCiReleaseInputs({ root, environment: inputs() })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(directory, "hub.json"), "utf8")).toBe(secret);
    expect(await readdir(directory)).toEqual(["hub.json"]);
  });
  it("when the input directory is a symlink then its target remains untouched", async () => {
    const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "hub.json"), secret);
    await symlink(outside, join(root, ".cloudflare-test.local"));
    await expect(prepareCiReleaseInputs({ root, environment: inputs() })).rejects.toMatchObject({ code: "EEXIST" });
    expect((await lstat(join(root, ".cloudflare-test.local"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(outside, "hub.json"), "utf8")).toBe(secret);
  });
  it("when the actual Node launcher receives malformed input then it fails without logging private values", async () => {
    await symlink(join(source, "node_modules"), join(root, "node_modules"), "dir");
    for (const name of ["package.json", "scripts/ci-release-inputs.ts", "scripts/release-config.ts", "apps/hub/scripts/cloudflare-test-files.ts", "apps/hub/scripts/cloudflare-test-settings.ts"]) {
      const target = join(root, name); await mkdir(join(target, ".."), { recursive: true }); await copyFile(join(source, name), target);
    }
    const result = spawnSync("node", ["--import", "tsx", "scripts/ci-release-inputs.ts"], { cwd: root, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, ...inputs(), XPRO_TEST_HUB_JSON: '{"private":"' + secret, TSX_DISABLE_CACHE: "1" } });
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
    expect(result.stdout).toBe(""); expect(result.stderr.trim()).toBe("CI test release inputs could not be prepared.");
    expect(result.stdout + result.stderr).not.toContain(secret);
    await expect(lstat(join(root, ".cloudflare-test.local"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
