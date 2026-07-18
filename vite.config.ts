import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig((async ({ command, mode }: any) => {
  const isDevBuild = command === "build" && mode === "development";

  return {
    css: { transformer: "lightningcss" },
    resolve: {
      // No @->src alias needed: vite-tsconfig-paths reads it from tsconfig.json
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    // Preserves debuggable identifiers in `npm run build:dev`
    ...(isDevBuild
      ? {
          environments: {
            client: {
              define: { "process.env.NODE_ENV": JSON.stringify("development") },
            },
          },
          esbuild: { keepNames: true },
        }
      : {}),
    plugins: [
      // Plugin order matches the recommended standalone non-sandbox sequence
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // Redirect TanStack Start's bundled server entry to src/server.ts
        server: { entry: "server" },
        // Prevent server-only code from leaking into client bundles
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
      }),
      // Nitro only on production builds — defaultPreset allows env auto-detection
      ...(command === "build"
        ? [
            await import("nitro/vite").then(({ nitro }) =>
              nitro({ defaultPreset: "cloudflare-module" })
            ),
          ]
        : []),
      react(),
    ],
    server: { host: "::", port: 8080 },
  };
}) as any);
