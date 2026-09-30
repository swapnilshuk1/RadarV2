import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: ["tests/intelligence/memo-composition-model-benchmark.test.ts"],
    environment: "node",
    pool: "threads",
    maxWorkers: 1,
    testTimeout: 60 * 60_000,
    hookTimeout: 60 * 60_000,
  },
});
