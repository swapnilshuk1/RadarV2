import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: ["tests/pursuit/memo-model-benchmark.test.ts"],
    environment: "node",
    pool: "threads",
    maxWorkers: 5,
    testTimeout: 30 * 60_000,
    hookTimeout: 30 * 60_000,
  },
});
