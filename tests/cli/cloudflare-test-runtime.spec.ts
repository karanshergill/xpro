import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const launchTimeout = 10_000;
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "xpro-setup-runtime-test-"));
  const scripts = join(directory, "apps/hub/scripts");
  await mkdir(scripts, { recursive: true });
  await copyFile(join(root, "package.json"), join(directory, "package.json"));
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
  // Exercise the launcher with TypeScript and extensionless imports, without application code or credentials.
  await writeFile(join(scripts, "runtime-value.ts"), 'export const value: string = "loaded";\n');
  await writeFile(join(scripts, "cloudflare-test.ts"), 'import { value } from "./runtime-value"; process.stdout.write(JSON.stringify({ value, node: process.versions.node, bun: process.versions.bun ?? null }));\n');
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("hosted setup command runtime", () => {
  it("when setup is launched through Bun then Node loads TypeScript and its extensionless imports", () => {
    const launched = spawnSync("bun", ["run", "setup:cloudflare-test"], {
      cwd: directory, encoding: "utf8", timeout: launchTimeout,
      env: { ...process.env, TSX_DISABLE_CACHE: "1" },
    });
    expect(launched.error).toBeUndefined();
    expect(launched.signal).toBeNull();
    expect(launched.status).toBe(0);
    expect(JSON.parse(launched.stdout)).toEqual({
      value: "loaded", node: expect.stringMatching(/^\d+\.\d+\.\d+/), bun: null,
    });
  });
});

