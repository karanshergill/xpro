import { constants } from "node:fs";
import { lstat, open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

const maximumPrivateFileBytes = 16 * 1024;
type SetupFiles = { hub: FileHandle; workspace: FileHandle; receipt: FileHandle };

export async function readPrivateSetupJson(directory: string, name: "operator.json" | "prepared.json" | "hub.json" | "workspace.json"): Promise<unknown> {
  await assertPrivateDirectory(directory);
  const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await file.stat();
    if (!details.isFile() || details.size > maximumPrivateFileBytes) throw new Error("Invalid test setup file.");
    assertPrivateMode(details.mode);
    return JSON.parse(await file.readFile("utf8"));
  } finally { await file.close(); }
}

export async function reserveCloudflareTestFiles(directory: string): Promise<SetupFiles> {
  await assertPrivateDirectory(directory);
  const created: { name: string; file: FileHandle }[] = [];
  async function reserve(name: string): Promise<FileHandle> {
    const file = await open(join(directory, name), "wx", 0o600);
    created.push({ name, file });
    return file;
  }
  try {
    return { hub: await reserve("hub.json"), workspace: await reserve("workspace.json"), receipt: await reserve("prepared.json") };
  } catch (error) {
    for (const entry of created) {
      await entry.file.close();
      await rm(join(directory, entry.name));
    }
    throw error;
  }
}

async function assertPrivateDirectory(directory: string): Promise<void> {
  const details = await lstat(directory);
  if (!details.isDirectory()) throw new Error("Test setup requires its private directory.");
  assertPrivateMode(details.mode);
}

function assertPrivateMode(mode: number): void {
  if ((mode & 0o077) !== 0) throw new Error("Test setup files must be private to their owner.");
}
