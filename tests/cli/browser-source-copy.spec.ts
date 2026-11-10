import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyBrowserSources } from "../e2e/source-copy";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "xpro-browser-copy-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("isolated browser source copy", () => {
  it("when tracked source is removed then current replacements and links are copied without deleted or ignored files", async () => {
    const root = join(directory, "source"), work = join(directory, "work");
    await mkdir(join(root, "auth"), { recursive: true });
    await mkdir(work);
    await writeFile(join(root, ".gitignore"), "private.secret\n");
    await writeFile(join(root, "kept.ts"), "retained source");
    await writeFile(join(root, "auth/old-access.ts"), "obsolete source");
    await symlink("kept.ts", join(root, "linked.ts"));
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "--", ".gitignore", "kept.ts", "linked.ts", "auth/old-access.ts"], { cwd: root });
    await rm(join(root, "auth/old-access.ts"));
    const replacement = "replacement\naccess.ts";
    await writeFile(join(root, "auth", replacement), "new source");
    await writeFile(join(root, "private.secret"), "must not be copied");
    await copyBrowserSources({ root, work });
    expect((await readdir(work)).sort()).toEqual([".gitignore", "auth", "kept.ts", "linked.ts"]);
    expect(await readdir(join(work, "auth"))).toEqual([replacement]);
    expect(await readFile(join(work, "kept.ts"), "utf8")).toBe("retained source");
    expect(await readFile(join(work, "auth", replacement), "utf8")).toBe("new source");
    expect(await readlink(join(work, "linked.ts"))).toBe("kept.ts");
    expect(await readFile(join(root, "private.secret"), "utf8")).toBe("must not be copied");
  });
});
