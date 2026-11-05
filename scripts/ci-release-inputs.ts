import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reserveCloudflareTestFiles } from "../apps/hub/scripts/cloudflare-test-files.ts";
import { readReleaseSecrets } from "./release-config.ts";

export async function prepareCiReleaseInputs({ root, environment }: { root: string; environment: Record<string, string | undefined> }): Promise<void> {
  const hub = environment.XPRO_TEST_HUB_JSON, workspace = environment.XPRO_TEST_WORKSPACE_JSON, prepared = environment.XPRO_TEST_PREPARED_JSON;
  if (!hub || !workspace || !prepared) throw new Error("The three CI test input secrets are required.");
  const directory = join(root, ".cloudflare-test.local");
  await mkdir(directory, { mode: 0o700 });
  try {
    const files = await reserveCloudflareTestFiles(directory);
    try {
      await files.hub.writeFile(hub);
      await files.workspace.writeFile(workspace);
      await files.receipt.writeFile(prepared);
    } finally { await Promise.all([files.hub.close(), files.workspace.close(), files.receipt.close()]); }
    await readReleaseSecrets(directory);
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error("The CI test release inputs are invalid.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await prepareCiReleaseInputs({ root: fileURLToPath(new URL("../", import.meta.url)), environment: process.env }); }
  catch { console.error("CI test release inputs could not be prepared."); process.exitCode = 1; }
}
