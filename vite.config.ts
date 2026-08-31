import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig((async ({ command, mode }: any) => {
  const isDevBuild = command === "build" && mode === "development";

  return {
    css: { transformer: "lightningcss" },
    resolve: {
      tsconfigPaths: true,
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
              nitro({ defaultPreset: "node-server" })
            ),
          ]
        : []),
      react(),
    ],
    server: {
      host: "::",
      port: process.env.PORT ? Number(process.env.PORT) : 3000,
      watch: {
        ignored: [
          "**/.scraper-artifacts/**",
          "**/scraper-profile/**",
          "**/.scraper-artifacts",
          "**/scraper-profile",
        ],
      },
    },
  };
}) as any);
