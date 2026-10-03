import { defineConfig } from "vitest/config";
import path from "node:path";
import { regressionTestFiles } from "./scripts/certification/registry";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: regressionTestFiles,
    exclude: ["node_modules/**"],
    environment: "node",
    pool: "threads",
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
