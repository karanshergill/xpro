import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["tests/cli/**/*.spec.ts"], environment: "node" } });
