import { defineConfig } from "vitest/config";
import path from "node:path";
import { certificationTestFiles } from "./scripts/certification/manifest";

const configuredWorkers = Number(process.env.CERTIFY_MAX_WORKERS ?? "4");
const maxWorkers = Number.isSafeInteger(configuredWorkers) && configuredWorkers > 0
  ? configuredWorkers
  : 4;

/**
 * The production certification suite. Its exact inclusion set is derived from
 * the manifest so the gate, reporting, and integrity checks cannot drift.
 */
export default defineConfig({
  cacheDir: "node_modules/.cache/radar/vite-certification",
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    include: certificationTestFiles,
    exclude: ["tests/archive/**", "node_modules/**"],
    environment: "node",
    pool: "threads",
    // Measured baseline: the host-default pool starved the integrity suite's
    // deliberate child-process failure check. Override only for benchmarks.
    maxWorkers,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
