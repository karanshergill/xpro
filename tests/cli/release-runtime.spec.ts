import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "xpro-release-launcher-test-"));
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  for (const name of ["package.json", "apps/web/package.json", "scripts/release.ts", "scripts/release-config.ts", "apps/hub/scripts/cloudflare-test-files.ts", "apps/hub/scripts/cloudflare-test-settings.ts"]) {
    const target = join(directory, name);
    await mkdir(join(target, ".."), { recursive: true });
    await copyFile(join(root, name), target);
  }
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("shared release launchers", () => {
  it("when an actual child command fails then the CLI exposes numeric error codes without its private output", async () => {
    for (const app of ["hub", "web", "router"]) {
      await mkdir(join(directory, "apps", app), { recursive: true });
      await copyFile(join(root, "apps", app, "wrangler.jsonc"), join(directory, "apps", app, "wrangler.jsonc"));
    }
    const bin = join(directory, "bin"), secret = "synthetic-private-command-output";
    await mkdir(bin);
    await writeFile(join(bin, "bun"), "#!/bin/sh\nprintf '%s\\n' '" + secret + "'\nprintf '%s\\n' '" + secret + " [code: 10000]' >&2\nexit 17\n", { mode: 0o700 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ""), TSX_DISABLE_CACHE: "1" };
    delete env.CLOUDFLARE_ACCOUNT_ID;
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/release.ts", "--env", "test"], {
      cwd: directory, encoding: "utf8", timeout: 10_000, env });
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
    const line = result.stdout.split("\n").find((line) => line.includes('{"status":'));
    expect(JSON.parse(line ?? "null")).toEqual({ status: "failed", environment: "test", stage: "build_hub",
      plan: expect.objectContaining({ accountId: expect.any(String) }), deployments: [], receipt: null,
      failure: { exitCode: 17, cloudflareCodes: [10000] } });
    expect(result.stdout + result.stderr).not.toContain(secret);
  });
  it.each([
    { name: "root release", args: ["run", "release", "--env", "production"] },
    { name: "root deploy", args: ["run", "deploy", "--env", "production"] },
    { name: "workspace deploy", args: ["--filter", "@xpro/web", "deploy", "--env", "production"] },
  ])("when $name is invoked with an unconfigured environment then the actual CLI refuses before reading app configuration", ({ args }) => {
    const result = spawnSync("bun", args, { cwd: directory, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, TSX_DISABLE_CACHE: "1" } });
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
    const line = result.stdout.split("\n").find((line) => line.includes('{"status":'));
    expect(line).toBeDefined();
    expect(JSON.parse(line?.slice(line.indexOf("{")) ?? "null")).toEqual({ status: "failed", environment: "test", stage: "options", plan: null, deployments: [], receipt: null });
    expect(result.stdout + result.stderr).toContain("Use bun run release --env test");
  });
});
