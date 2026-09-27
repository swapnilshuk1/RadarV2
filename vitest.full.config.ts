import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      // Opt-in live operator audit; reads live production identity data from external Turso DB
      "tests/intelligence/canonical-identity.test.ts",
      "node_modules/**",
    ],
    environment: "node",
    pool: "threads",
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
