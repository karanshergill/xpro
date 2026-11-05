import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

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
    {
      name: "local-service-https",
      configureServer(server) {
        // shortcut: separate Vite service bindings lose HTTPS in their internal
        // hop. These dev servers require HTTPS. Remove when Cloudflare preserves
        // the scheme across those bindings; keep the native browser regression.
        server.middlewares.use((request, _response, next) => {
          request.headers["x-forwarded-proto"] = "https";
          next();
        });
      },
    },
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9231, remoteBindings: false }),
    tailwindcss(),
    paraglideVitePlugin({ project: "./project.inlang", outdir: "./src/paraglide", emitTsDeclarations: true, strategy: ["cookie", "baseLocale"] }),
    tanstackStart(),
    viteReact(),
  ],
}));
