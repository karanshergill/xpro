import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { browserOrigins } from "./addresses";

const root = fileURLToPath(new URL("../../", import.meta.url));
const children = new Set<ChildProcess>();
let isInterrupted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  isInterrupted = true;
  for (const child of children) signalChild(child, signal);
});

async function main(): Promise<void> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "xpro-browser-"))), work = join(base, "work");
  try {
    for (const port of [3000, 3001, 3002, 9230, 9231, 9232]) await ensureFreePort(port);
    await mkdir(work);
    const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root })
      .toString().split("\0").filter(Boolean);
    for (const name of new Set(names)) {
      const source = join(root, name), target = join(work, name);
      // Only source files selected by Git are copied; secret files and local data stay out.
      await mkdir(join(target, ".."), { recursive: true });
      if ((await lstat(source)).isSymbolicLink()) await symlink(await readlink(source), target);
      else await copyFile(source, target);
    }
    await mkdir(join(work, ".certs"));
    const caRoot = execFileSync("mkcert", ["-CAROOT"], { encoding: "utf8" }).trim();
    const ca = await readFile(join(caRoot, "rootCA.pem"));
    execFileSync("mkcert", ["-cert-file", join(work, ".certs/localhost.pem"), "-key-file", join(work, ".certs/localhost-key.pem"),
      "localhost", "127.0.0.1", ...new Set(Object.values(browserOrigins).map((origin) => new URL(origin).hostname))], { stdio: "pipe" });
    const secret = crypto.randomUUID() + crypto.randomUUID();
    await writeFile(join(work, "apps/hub/.dev.vars"),
      "BETTER_AUTH_URL=https://hub.localhost:3001\nBETTER_AUTH_SECRET=" + secret + "\nTURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\nTURNSTILE_SITE_KEY=1x00000000000000000000AA\n", { mode: 0o600 });
    // Only the guarded copy receives loopback transports for native provider HTTP calls.
    const configPath = join(work, "apps/hub/wrangler.jsonc");
    const hubConfig = JSON.parse(await readFile(configPath, "utf8"));
    hubConfig.env.local.services.push({ binding: "BROWSER_HUB", service: "xpro-hub", remote: false },
      { binding: "BROWSER_ROUTER", service: "xpro-router", remote: false });
    await writeFile(configPath, JSON.stringify(hubConfig, null, 2) + "\n");
    await writeFile(join(work, "tests/e2e/network.private.ts"),
      'import { env } from "cloudflare:workers";\n'
      + 'import { enableBrowserNetwork } from "./network";\n'
      + 'import { browserOrigins } from "./addresses";\n'
      + 'if (env.BETTER_AUTH_URL !== browserOrigins.hub || env.BETTER_AUTH_SECRET !== ' + JSON.stringify(secret) + ') throw new Error("Browser network fixtures require their isolated Hub.");\n'
      + 'enableBrowserNetwork({ hub: env.BROWSER_HUB, router: env.BROWSER_ROUTER, hubOrigin: browserOrigins.hub, customerOrigin: browserOrigins.customer });\n', { mode: 0o600 });
    const hubEntry = join(work, "apps/hub/src/server.ts");
    await copyFile(hubEntry, join(work, "apps/hub/src/server.native.server.ts"));
    await writeFile(hubEntry, 'import "../../../tests/e2e/network.private";\n'
      + 'import native from "./server.native.server";\n'
      + 'import { readBrowserLogoutCount } from "../../../tests/e2e/network";\n'
      + 'export { HubAccess, HubPlacement } from "./server.native.server";\n'
      + 'export default { async fetch(request: Request, env: Parameters<typeof native.fetch>[1]) {\n'
      + ' const response = await native.fetch(request, env), headers = new Headers(response.headers);\n'
      + ' headers.set("x-test-backchannel-deliveries", String(readBrowserLogoutCount()));\n'
      + ' return new Response(response.body, { status: response.status, statusText: response.statusText, headers });\n'
      + '} };\n');
    // This UI-only route exercises mounted React state against the real gate.
    await writeFile(join(work, "apps/web/src/routes/draft-check.tsx"),
      'import { createFileRoute } from "@tanstack/react-router";\n'
      + 'import { WorkspaceDraftHarness } from "../../../../tests/e2e/workspace-harness";\n'
      + 'export const Route = createFileRoute("/draft-check")({ component: WorkspaceDraftHarness });\n');
    await writeFile(join(work, "apps/hub/src/routes/reset-check.tsx"),
      'import { createFileRoute } from "@tanstack/react-router";\n'
      + 'import { ResetPassword } from "../components/stms/reset-password";\n'
      + 'import { ResetPasswordHarness, readResetHarnessSearch } from "../../../../tests/e2e/reset-password-harness";\n'
      + 'export const Route = createFileRoute("/reset-check")({ validateSearch: readResetHarnessSearch, component: ResetCheck });\n'
      + 'function ResetCheck() { return <ResetPasswordHarness initial={Route.useSearch()} control={ResetPassword} />; }\n');
    await writeFile(join(work, "apps/hub/src/routes/profile-policy-check.tsx"),
      'import { createFileRoute } from "@tanstack/react-router";\n'
      + 'import { ProfilePolicyHarness } from "../../../../tests/e2e/profile-policy-harness";\n'
      + 'import cropCss from "react-image-crop/dist/ReactCrop.css?url";\n'
      + 'import { loadProfile } from "../features/profile/profile.data";\n'
      + 'import { ProfileError, ProfilePending, ProfileScreen } from "../features/profile/profile-screen";\n'
      + 'export const Route = createFileRoute("/profile-policy-check")({ component: ProfileCheck, head: () => ({ links: [{ rel: "stylesheet", href: cropCss }] }) });\n'
      + 'function ProfileCheck() { return <ProfilePolicyHarness loadProfile={loadProfile} screen={ProfileScreen} pending={ProfilePending} error={ProfileError} />; }\n');

    await writeFile(join(base, "guard.json"), JSON.stringify({ root: work }));
    const env = { ...process.env, XPRO_BROWSER_ROOT: work, XPRO_BROWSER_TEMP: base,
      WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(base, "wrangler-logs"), NODE_EXTRA_CA_CERTS: join(caRoot, "rootCA.pem") };
    await run({ command: "bun", args: ["install", "--frozen-lockfile"], cwd: work, env });
    await run({ command: "bun", args: ["run", "tests/e2e/seed.ts"], cwd: work, env });
    const serverLogs = new Map<string, string>();
    await startApp({ script: "dev:hub", port: 3001, hostname: "hub.localhost", path: "/complete-profile" });
    await startApp({ script: "dev", port: 3000, hostname: "web.localhost", path: "/" });
    await startApp({ script: "dev:router", port: 3002, hostname: "router.localhost", path: "/" });
    async function startApp(input: { script: string; port: number; hostname: string; path: string }): Promise<void> {
      const server = start({ command: "bun", args: ["run", input.script], cwd: work, env, stdio: "pipe" });
      let serverLog = "";
      server.stdout?.on("data", (chunk: Buffer) => { serverLog = (serverLog + chunk.toString()).slice(-12000); serverLogs.set(input.hostname, serverLog); });
      server.stderr?.on("data", (chunk: Buffer) => { serverLog = (serverLog + chunk.toString()).slice(-12000); serverLogs.set(input.hostname, serverLog); });
      const deadline = Date.now() + 60_000;
      while (!await isReady({ ca, ...input })) {
        if (server.exitCode !== null || server.signalCode !== null || isInterrupted || Date.now() > deadline) {
          throw new Error("The isolated HTTPS " + input.hostname + " did not start.\n" + serverLog);
        }
        await setTimeout(100);
      }
    }
    try { await run({ command: "node", args: [fileURLToPath(import.meta.resolve("@playwright/test/cli")), "test", "--config", join(root, "tests/e2e/playwright.config.ts"),
      ...process.argv.slice(2)], cwd: root, env }); }
    catch (error) { throw new Error(String(error) + "\n" + [...serverLogs].map(([host, log]) => host + "\n" + log.slice(-6000)).join("\n")); }
  } finally {
    try {
      for (const child of children) {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          signalChild(child, "SIGTERM");
          for (let attempt = 0; attempt < 50 && child.exitCode === null && child.signalCode === null; attempt++) await setTimeout(100);
          if (child.exitCode === null && child.signalCode === null) signalChild(child, "SIGKILL");
        }
      }
    } finally { await rm(base, { recursive: true, force: true }); }
  }
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, signal); }
  catch (error) {
    // The group can exit after the status check but before the signal arrives.
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

type ChildOptions = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; stdio?: "pipe" | "inherit" };

function start(input: ChildOptions): ChildProcess {
  const { command, args, ...options } = input;
  if (isInterrupted) throw new Error("Browser checks were interrupted.");
  const child = spawn(command, args, { ...options, stdio: options.stdio ?? "inherit", detached: true });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function run(input: ChildOptions): Promise<void> {
  const child = start(input);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(input.command + " exited with code " + code)));
  });
}

async function ensureFreePort(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error("Port " + port + " is in use. Stop that development server before running browser checks.")));
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
}

async function isReady(input: { ca: Buffer; port: number; hostname: string; path: string }): Promise<boolean> {
  return await new Promise((resolve) => {
    const request = get({ hostname: "127.0.0.1", port: input.port, path: input.path, servername: input.hostname,
      headers: { host: input.hostname + ":" + input.port }, ca: input.ca }, (response) => {
      response.resume();
      resolve(response.statusCode !== undefined);
    });
    request.setTimeout(2000, () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : "Browser checks failed."); process.exitCode = 1; }
