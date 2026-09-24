import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("remote DB read-economics guardrails", () => {
  test("evaluator UI polls slowly while idle and never polls a hidden tab", () => {
    const panel = source("src/components/radar/EvaluatorControlPanel.tsx");
    expect(panel).toContain("? 3_000 : 30_000");
    expect(panel).toContain('document.visibilityState === "visible"');
    expect(panel).toContain("if (!pageVisible) return");
  });

  test("idle enrichment avoids dashboard aggregates on each poll", () => {
    const worker = source("scripts/enrich.ts");
    const idleStart = worker.indexOf("if (jobs.length === 0)");
    const idleLoop = worker.slice(idleStart, worker.indexOf("idleCount = 0;", idleStart));
    expect(idleLoop).not.toContain("getDashboardStats");
    expect(idleLoop).toContain("idleCount % 60 === 0");
  });

  test("run statistics retain a two-query shape", () => {
    const queue = source("scripts/scraper/persist/queue.ts");
    const method = queue.slice(queue.indexOf("public async getRunStats"), queue.indexOf("public async getGlobalPipelineStats"));
    expect(method).toContain("WITH run_jobs AS");
    expect((method.match(/this\.db\.one/g) ?? [])).toHaveLength(1);
    expect((method.match(/this\.db\.many/g) ?? [])).toHaveLength(1);
  });

  test("global evaluator recovery runs at startup and only sweeps every five minutes", () => {
    const daemon = source("src/lib/intelligence/EvaluationDaemon.ts");
    expect(daemon).toContain("GLOBAL_RECONCILIATION_INTERVAL_MS = 5 * 60_000");
    expect(daemon).toContain('this.reconcileActiveRuns("startup")');
    expect(daemon).not.toContain("lastGlobalReconcileAt >= 10_000");
  });

  test("review health is event-driven with a five-minute SLA sweep", () => {
    const reviewWorker = source("scripts/run-dossier-review-worker.ts");
    expect(reviewWorker).toContain("REVIEW_HEALTH_INTERVAL_MS = 5 * 60_000");
    expect(reviewWorker).toContain('result.status === "needs_attention"');
    expect(reviewWorker).toContain("now - lastHealthCheckAt >= REVIEW_HEALTH_INTERVAL_MS");
  });
});
