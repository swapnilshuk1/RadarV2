/**
 * Operator-only live benchmark for the PURSUE opportunity memo composition stage.
 *
 * IMPORTANT:
 * - This is NOT the staged evaluation/model-decision comparison.
 * - This is NOT the post-decision Pursuit Cockpit thesis/artifact generator.
 * - It holds five real persisted PURSUE evaluations and their frozen inputs fixed,
 *   then swaps only the Mantle model used by composeStagedDraft().
 *
 * Normal certification runs only the static configuration assertion below.
 * Live execution requires RADAR_RUN_LIVE_MEMO_COMPOSITION_BENCHMARK=true and a
 * production database + Mantle credential.
 */

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getDatabaseAdapter } from "../../src/data/database";
import { validateSnapshot } from "../../src/data/sqlite/repositories/SqliteStagedInputStore";
import { compositionSchema, type Dossier } from "../../src/dossier/contracts";
import { memoWordCounts } from "../../src/dossier/composition";
import { allPassages } from "../../src/dossier/grounding";
import { composeStagedDraft } from "../../src/dossier/staged-composition";
import { parseCanonicalStagedDecisionResult } from "../../src/dossier/staged-decision-integrity";
import { loadMantleCredentials } from "../../src/lib/model/bedrock-credentials";
import {
  createBedrockGlmResearchModel,
  GLM_STAGE_OUTPUT_TOKENS,
  GLM_STAGE_TIMEOUT_MS,
} from "../../src/lib/model/bedrock-glm-research-model";
import { BedrockMantleJsonModel } from "../../src/lib/model/bedrock-mantle-model";
import type {
  ModelInvocationEvent,
  ModelInvocationSink,
  ModelUsage,
} from "../../src/lib/model/model-invocation";

const RUN_LIVE = process.env.RADAR_RUN_LIVE_MEMO_COMPOSITION_BENCHMARK === "true";

const MODELS = [
  {
    id: "zai.glm-5",
    label: "GLM-5 (deployed)",
    inputUsdPerMillion: 1.0,
    outputUsdPerMillion: 3.2,
  },
  {
    id: "deepseek.v3.2",
    label: "DeepSeek V3.2",
    inputUsdPerMillion: 0.62,
    outputUsdPerMillion: 1.85,
  },
  {
    id: "moonshotai.kimi-k2.5",
    label: "Kimi K2.5",
    inputUsdPerMillion: 0.6,
    outputUsdPerMillion: 3.0,
  },
] as const;

type ModelSpec = (typeof MODELS)[number];

interface BenchmarkSourceRow {
  tenant_id: string;
  person_id: string;
  canonical_job_id: string;
  opportunity_version: string;
  job_hash: string;
  evaluation_context_fingerprint: string;
  input_fingerprint: string;
  evaluation_json: string;
  input_json: string;
  evaluated_at: string;
}

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  calls: number;
  repairCalls: number;
  invalidOutputCalls: number;
  providerErrorCalls: number;
}

function number(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function usageTotals(events: readonly ModelInvocationEvent[]): UsageTotals {
  const terminal = events.filter((event) => event.status !== "running");
  const sum = (pick: (usage: ModelUsage) => number | undefined) =>
    terminal.reduce((total, event) => total + number(event.usage ? pick(event.usage) : undefined), 0);
  return {
    inputTokens: sum((usage) => usage.inputTokens),
    outputTokens: sum((usage) => usage.outputTokens),
    cachedInputTokens: sum((usage) => usage.cachedInputTokens),
    reasoningTokens: sum((usage) => usage.reasoningTokens),
    totalTokens: sum((usage) => usage.totalTokens),
    calls: terminal.length,
    repairCalls: terminal.filter((event) => event.stage === "memo-repair").length,
    invalidOutputCalls: terminal.filter((event) => event.status === "invalid_output").length,
    providerErrorCalls: terminal.filter((event) => event.status === "provider_error").length,
  };
}

function estimatedCostUsd(usage: UsageTotals, model: ModelSpec): number {
  return (
    (usage.inputTokens / 1_000_000) * model.inputUsdPerMillion +
    (usage.outputTokens / 1_000_000) * model.outputUsdPerMillion
  );
}

function createBenchmarkModel(spec: ModelSpec, sink: ModelInvocationSink) {
  if (spec.id === "zai.glm-5") {
    // Use the same production factory/configuration for the deployed baseline.
    return createBedrockGlmResearchModel({
      invocationSink: sink,
      providerConcurrencyLimit: 1,
    });
  }

  loadMantleCredentials();
  return new BedrockMantleJsonModel(
    spec.id,
    async () => {
      loadMantleCredentials();
      const key = process.env.BEDROCK_MANTLE_API_KEY?.trim();
      if (!key) throw new Error("BEDROCK_MANTLE_CREDENTIAL_UNAVAILABLE");
      return key;
    },
    fetch,
    {
      region: "us-east-1",
      timeoutMs: 120_000,
      stageTimeoutMs: GLM_STAGE_TIMEOUT_MS,
      maxOutputTokens: 12_288,
      stageOutputTokens: GLM_STAGE_OUTPUT_TOKENS,
      invocationSink: sink,
      providerConcurrencyLimit: 1,
    },
  );
}

function compositionOnly(dossier: Dossier) {
  return compositionSchema.parse(dossier);
}

function memoText(dossier: Dossier): string {
  const memo = compositionOnly(dossier);
  return [
    "EXECUTIVE THESIS",
    memo.executiveThesis.text,
    "",
    "OPPORTUNITY VALUE",
    ...memo.opportunityValue.map((item) => `- ${item.text}`),
    "",
    "MANDATE",
    ...memo.mandate.priorities.map((item) => `- ${item.text}`),
    ...memo.mandate.outcomes.map((item) => `- Outcome: ${item.text}`),
    "",
    "CANDIDATE FIT",
    ...memo.candidateFit.map((item) => `- ${item.label}: ${item.assessment.text}`),
    "",
    "DECISION CONDITIONS",
    ...memo.decisionConditions.flatMap((item) => [
      `- Q: ${item.question.text}`,
      `  Why it matters: ${item.consequence.text}`,
    ]),
    "",
    "APPROACH",
    `- Opening: ${memo.approach.opening.text}`,
    ...memo.approach.nextSteps.map((item) => `- Next: ${item.text}`),
    ...memo.approach.resumeNarrative.map((item) => `- Resume: ${item.text}`),
    ...memo.approach.linkedinStrategy.map((item) => `- LinkedIn: ${item.text}`),
    ...memo.approach.screening.map((item) => `- Screening: ${item.text}`),
    ...memo.approach.interview.map((item) => `- Interview: ${item.text}`),
  ].join("\n");
}

function memoDiagnostics(dossier: Dossier) {
  const memo = compositionOnly(dossier);
  const passages = allPassages(memo);
  const counts = memoWordCounts(memo);
  const normalized = passages.map((passage) =>
    passage.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  );
  return {
    mainWords: counts.main,
    preparationWords: counts.preparation,
    passageCount: passages.length,
    uniqueEvidenceRefs: new Set(passages.flatMap((passage) => passage.evidenceRefs)).size,
    repeatedExactPassages: normalized.length - new Set(normalized).size,
    candidateVoiceViolations: passages.filter((passage) => /\bthe candidate\b/i.test(passage.text)).length,
    internalIdLeaks: passages.filter((passage) => /\b(?:REQ|CANDIDATE|ROLE|CONTEXT)-[A-Z0-9_-]+\b/i.test(passage.text)).length,
    candidateFitRows: memo.candidateFit.length,
    decisionConditionRows: memo.decisionConditions.length,
    opportunityValueRows: memo.opportunityValue.length,
  };
}

async function realPursueCases(): Promise<BenchmarkSourceRow[]> {
  const db = getDatabaseAdapter();
  const rows = await db.many<BenchmarkSourceRow>(
    `WITH ranked AS (
       SELECT
         se.*,
         ROW_NUMBER() OVER (
           PARTITION BY se.canonical_job_id
           ORDER BY se.evaluated_at DESC
         ) AS rn
       FROM staged_evaluations se
       WHERE se.evaluation_state='COMPLETED'
         AND se.decision='PURSUE'
     )
     SELECT
       ranked.tenant_id,
       ranked.person_id,
       ranked.canonical_job_id,
       ranked.opportunity_version,
       ranked.job_hash,
       ranked.evaluation_context_fingerprint,
       ranked.input_fingerprint,
       ranked.evaluation_json,
       ranked.evaluated_at,
       (
         SELECT sfi.input_json
         FROM staged_frozen_inputs sfi
         WHERE sfi.tenant_id=ranked.tenant_id
           AND sfi.person_id=ranked.person_id
           AND sfi.canonical_job_id=ranked.canonical_job_id
           AND sfi.opportunity_version=ranked.opportunity_version
           AND sfi.evaluation_context_fingerprint=ranked.evaluation_context_fingerprint
           AND sfi.input_fingerprint=ranked.input_fingerprint
         ORDER BY sfi.created_at DESC
         LIMIT 1
       ) AS input_json
     FROM ranked
     WHERE ranked.rn=1
       AND EXISTS (
         SELECT 1
         FROM staged_frozen_inputs sfi
         WHERE sfi.tenant_id=ranked.tenant_id
           AND sfi.person_id=ranked.person_id
           AND sfi.canonical_job_id=ranked.canonical_job_id
           AND sfi.opportunity_version=ranked.opportunity_version
           AND sfi.evaluation_context_fingerprint=ranked.evaluation_context_fingerprint
           AND sfi.input_fingerprint=ranked.input_fingerprint
       )
     ORDER BY ranked.evaluated_at DESC
     LIMIT 5`,
  );
  return rows;
}

describe("memo composition model benchmark configuration", () => {
  it("targets the memo writer only and pins the intended Mantle candidates", () => {
    expect(MODELS.map((model) => model.id)).toEqual([
      "zai.glm-5",
      "deepseek.v3.2",
      "moonshotai.kimi-k2.5",
    ]);
    expect(GLM_STAGE_OUTPUT_TOKENS["memo-draft"]).toBe(6144);
    expect(GLM_STAGE_TIMEOUT_MS["memo-draft"]).toBe(120_000);
  });

  if (RUN_LIVE) {
    it(
      "compares memo quality/cost across five real persisted PURSUE evaluations",
      async () => {
        loadMantleCredentials();
        const sources = await realPursueCases();
        expect(
          sources.length,
          "Production must contain five distinct persisted PURSUE evaluations with exact frozen inputs.",
        ).toBe(5);

        const cases = sources.map((row) => {
          const frozen = validateSnapshot(JSON.parse(row.input_json));
          const staged = parseCanonicalStagedDecisionResult(JSON.parse(row.evaluation_json));
          if (frozen.fingerprint !== row.input_fingerprint) {
            throw new Error(`BENCHMARK_FROZEN_INPUT_MISMATCH:${row.canonical_job_id}`);
          }
          if (staged.decision.verdict !== "PURSUE") {
            throw new Error(`BENCHMARK_NOT_PURSUE:${row.canonical_job_id}`);
          }
          return { row, frozen, staged };
        });

        const reportRows: Array<Record<string, unknown>> = [];

        for (const spec of MODELS) {
          for (const source of cases) {
            const events: ModelInvocationEvent[] = [];
            const sink: ModelInvocationSink = async (event) => {
              events.push(structuredClone(event));
            };
            const model = createBenchmarkModel(spec, sink);
            const started = performance.now();

            try {
              const dossier = await composeStagedDraft(
                source.frozen,
                source.staged,
                model,
              );
              const elapsedMs = Math.round(performance.now() - started);
              const usage = usageTotals(events);
              reportRows.push({
                model: spec.id,
                label: spec.label,
                deployed: spec.id === "zai.glm-5",
                success: true,
                company: source.frozen.opportunity.company,
                role: source.frozen.opportunity.title,
                canonicalJobId: source.row.canonical_job_id,
                evaluatedAt: source.row.evaluated_at,
                latencyMs: elapsedMs,
                usage,
                estimatedCostUsd: Number(estimatedCostUsd(usage, spec).toFixed(6)),
                diagnostics: memoDiagnostics(dossier),
                memoText: memoText(dossier),
                memo: compositionOnly(dossier),
              });
            } catch (error) {
              const elapsedMs = Math.round(performance.now() - started);
              const usage = usageTotals(events);
              reportRows.push({
                model: spec.id,
                label: spec.label,
                deployed: spec.id === "zai.glm-5",
                success: false,
                company: source.frozen.opportunity.company,
                role: source.frozen.opportunity.title,
                canonicalJobId: source.row.canonical_job_id,
                evaluatedAt: source.row.evaluated_at,
                latencyMs: elapsedMs,
                usage,
                estimatedCostUsd: Number(estimatedCostUsd(usage, spec).toFixed(6)),
                error: error instanceof Error ? error.message.slice(0, 1000) : String(error),
              });
            }
          }
        }

        const summary = MODELS.map((spec) => {
          const rows = reportRows.filter((row) => row.model === spec.id);
          const successes = rows.filter((row) => row.success === true);
          const total = (key: string) =>
            rows.reduce((sum, row) => sum + Number((row.usage as Record<string, unknown>)?.[key] ?? 0), 0);
          return {
            model: spec.id,
            label: spec.label,
            successfulMemos: successes.length,
            attemptedMemos: rows.length,
            totalCostUsd: Number(
              rows.reduce((sum, row) => sum + Number(row.estimatedCostUsd ?? 0), 0).toFixed(6),
            ),
            avgCostUsd: Number(
              (
                rows.reduce((sum, row) => sum + Number(row.estimatedCostUsd ?? 0), 0) /
                Math.max(1, rows.length)
              ).toFixed(6),
            ),
            avgLatencyMs: Math.round(
              rows.reduce((sum, row) => sum + Number(row.latencyMs ?? 0), 0) /
                Math.max(1, rows.length),
            ),
            inputTokens: total("inputTokens"),
            outputTokens: total("outputTokens"),
            calls: total("calls"),
            repairCalls: total("repairCalls"),
            invalidOutputCalls: total("invalidOutputCalls"),
            providerErrorCalls: total("providerErrorCalls"),
          };
        });

        const payload = {
          benchmark: "memo-composition-only",
          source: "five real persisted PURSUE evaluations",
          sourceReleaseSha: process.env.RADAR_MEMO_BENCHMARK_SOURCE_SHA?.trim() || null,
          pricing: {
            region: "us-east-1",
            tier: "standard",
            asOf: "2026-10-01",
            models: MODELS,
          },
          rubricForManualReview: {
            executiveUsefulness: 25,
            specificityAndGrounding: 25,
            decisionClarityAndTension: 20,
            concisionAndNonRepetition: 15,
            actionability: 15,
          },
          summary,
          rows: reportRows,
        };

        console.table(summary);
        console.log("\nMEMO_COMPOSITION_BENCHMARK_REPORT");
        console.log(JSON.stringify(payload, null, 2));

        const outputPath = process.env.RADAR_MEMO_COMPOSITION_BENCHMARK_REPORT?.trim();
        if (outputPath) {
          writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf-8");
        }

        expect(reportRows).toHaveLength(15);
        expect(
          reportRows.filter((row) => row.model === "zai.glm-5" && row.success === true),
          "The deployed GLM-5 baseline must successfully compose all five memos.",
        ).toHaveLength(5);
      },
      60 * 60_000,
    );
  }
});
