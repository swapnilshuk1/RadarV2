import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("evaluator control worker liveness", () => {
  it("uses supervised worker heartbeat state instead of serving-process daemon state", () => {
    const panel = source("src/components/radar/EvaluatorControlPanel.tsx");
    const server = source("src/lib/intelligence/evaluation-server.ts");

    expect(server).toContain('isWorkerOnline("evaluation", { db })');
    expect(panel).toContain("snapshot.control.workerOnline");
    expect(panel).toContain('data-testid="evaluator-worker-offline"');
    expect(panel).not.toContain("localDaemonRunning");
  });
});
