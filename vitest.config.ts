import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "#test": fileURLToPath(new URL("./tests/support", import.meta.url)) } },
  plugins: [cloudflareTest({ wrangler: { configPath: "./tests/wrangler.jsonc" }, remoteBindings: false })],
  test: {
    include: ["tests/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}", "apps/*/{src,scripts}/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/support/setup.ts"],
    coverage: {
      provider: "istanbul",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.server.ts", "apps/*/src/**/*.db.ts", "tests/support/runtime.ts"],
      exclude: ["**/*.test.{ts,tsx}"],
    },
  },
});
