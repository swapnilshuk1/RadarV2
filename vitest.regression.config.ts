import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: [
      "tests/regression/**/*.test.ts",
    ],
    exclude: [
      "tests/archive/**",
      "node_modules/**",
    ],
    environment: "node",
    pool: "threads",
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
