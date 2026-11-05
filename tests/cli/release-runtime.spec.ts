import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
