import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    https: command === "serve" ? {
      key: readFileSync(new URL("../../.certs/localhost-key.pem", import.meta.url)),
      cert: readFileSync(new URL("../../.certs/localhost.pem", import.meta.url)),
    } : undefined,
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9231, remoteBindings: false }),
    tanstackStart(),
    viteReact(),
  ],
}));
