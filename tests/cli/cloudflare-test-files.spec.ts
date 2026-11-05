import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPrivateSetupJson, reserveCloudflareTestFiles } from "../../apps/hub/scripts/cloudflare-test-files";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "xpro-setup-files-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("protected operator files", () => {
  it("when input is an owner-only JSON file then it is read unchanged", async () => {
    const values = { secret: crypto.randomUUID() };
    await writeFile(join(directory, "operator.json"), JSON.stringify(values), { mode: 0o600 });
    expect(await readPrivateSetupJson(directory, "operator.json")).toEqual(values);
  });
  it.each([0o640, 0o644, 0o666])("when input is readable by another user with mode %o then it is refused", async (mode) => {
    await writeFile(join(directory, "operator.json"), "{}", { mode });
    await chmod(join(directory, "operator.json"), mode);
    await expect(readPrivateSetupJson(directory, "operator.json")).rejects.toThrow("must be private");
  });
  it("when the directory allows access to another user then reading and reserving outputs are refused", async () => {
    await writeFile(join(directory, "operator.json"), "{}", { mode: 0o600 });
    await chmod(directory, 0o755);
    await expect(readPrivateSetupJson(directory, "operator.json")).rejects.toThrow("must be private");
    await expect(reserveCloudflareTestFiles(directory)).rejects.toThrow("must be private");
  });
  it("when input is a symlink then its target is never read", async () => {
    await writeFile(join(directory, "outside.json"), "{}", { mode: 0o600 });
    await symlink(join(directory, "outside.json"), join(directory, "operator.json"));
    await expect(readPrivateSetupJson(directory, "operator.json")).rejects.toThrow();
  });
  it("when the private directory is a symlink then it is refused", async () => {
    const link = join(directory, "linked");
    await symlink(directory, link);
    await expect(readPrivateSetupJson(link, "operator.json")).rejects.toThrow("private directory");
    await expect(reserveCloudflareTestFiles(link)).rejects.toThrow("private directory");
  });
  it("when input is a directory or exceeds the file bound then it is refused", async () => {
    const path = join(directory, "operator.json");
    await mkdir(path, { mode: 0o700 });
    await expect(readPrivateSetupJson(directory, "operator.json")).rejects.toThrow("Invalid test setup file.");
    await rm(path, { recursive: true });
    await writeFile(path, " ".repeat(16 * 1024 + 1), { mode: 0o600 });
    await expect(readPrivateSetupJson(directory, "operator.json")).rejects.toThrow("Invalid test setup file.");
  });
});

describe("deployment secret output", () => {
  it("when output files are new then they are owner-only and accept the supplied JSON unchanged", async () => {
    const files = await reserveCloudflareTestFiles(directory), secret = crypto.randomUUID();
    try { await files.workspace.writeFile(JSON.stringify({ secret })); }
    finally { await Promise.all([files.hub.close(), files.workspace.close(), files.receipt.close()]); }
    expect((await readdir(directory)).sort()).toEqual(["hub.json", "prepared.json", "workspace.json"]);
    for (const name of ["hub.json", "workspace.json", "prepared.json"]) expect((await lstat(join(directory, name))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(directory, "workspace.json"), "utf8"))).toEqual({ secret });
  });
  it.each(["hub.json", "workspace.json", "prepared.json"])("when %s already exists then it is preserved and newly reserved files are removed", async (name) => {
    const original = JSON.stringify({ secret: crypto.randomUUID() });
    await writeFile(join(directory, name), original, { mode: 0o600 });
    await expect(reserveCloudflareTestFiles(directory)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readdir(directory)).toEqual([name]);
    expect(await readFile(join(directory, name), "utf8")).toBe(original);
  });
  it("when an output path is a symlink then its target is never overwritten", async () => {
    const target = join(directory, "outside.json");
    await writeFile(target, "original", { mode: 0o600 });
    await symlink(target, join(directory, "workspace.json"));
    await expect(reserveCloudflareTestFiles(directory)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(target, "utf8")).toBe("original");
    expect((await readdir(directory)).sort()).toEqual(["outside.json", "workspace.json"]);
  });
});
