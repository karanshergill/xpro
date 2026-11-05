import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { browserOrigins } from "./addresses";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Run browser checks through bun run test:e2e.");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: join(base, "results"),
  reporter: "list",
  use: { baseURL: "https://hub.localhost:3001", browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL, ignoreHTTPSErrors: true, screenshot: "only-on-failure",
    launchOptions: { args: ["--host-resolver-rules=" + [browserOrigins.customer, browserOrigins.missing]
      .map((origin) => "MAP " + new URL(origin).hostname + " 127.0.0.1").join(", ")] } },
});
