import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, readlink, symlink } from "node:fs/promises";
import { join } from "node:path";

export async function copyBrowserSources(input: { root: string; work: string }): Promise<void> {
  const { root, work } = input;
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root })
    .toString().split("\0").filter(Boolean);
  const deleted = new Set(execFileSync("git", ["ls-files", "--deleted", "-z"], { cwd: root })
    .toString().split("\0").filter(Boolean));
  for (const name of new Set(names)) {
    // The index includes unstaged deletions; the browser must exercise the current worktree.
    if (deleted.has(name)) continue;
    const source = join(root, name), target = join(work, name);
    // Git selection excludes private files and local data without changing the user's index.
    await mkdir(join(target, ".."), { recursive: true });
    if ((await lstat(source)).isSymbolicLink()) await symlink(await readlink(source), target);
    else await copyFile(source, target);
  }
}
