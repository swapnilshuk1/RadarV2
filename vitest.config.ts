import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: [
      "tests/intelligence/**/*.test.ts",
      "tests/security/**/*.test.ts",
      "tests/ontology/**/*.test.ts",
      "tests/policy/**/*.test.ts",
      "tests/editorial/**/*.test.ts",
      "tests/semantic/**/*.test.ts",
      "tests/persistence/**/*.test.ts",
      "tests/scraper/**/*.test.ts",
      "tests/acquisition/**/*.test.ts",
      "tests/pipeline/**/*.test.ts",
    ],
    exclude: [
      "tests/regression/**",
      "tests/archive/**",
      "node_modules/**",
      "tests/scraper/integration.test.ts",
      "tests/scraper/scrape-progress.test.ts"
    ],
    environment: "node",
    pool: "threads",
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
