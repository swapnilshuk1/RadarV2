/**
 * Opt-in live model benchmark for the Pursuit Strategy memo.
 *
 * IMPORTANT: this is NOT the staged dossier memo/composition test. It exercises
 * src/pursuit/thesis.ts -> enrichThesis(), which feeds the Strategy surface in
 * the Pursuit Cockpit.
 *
 * Run only with an explicit operator opt-in:
 *   RADAR_RUN_LIVE_PURSUIT_MEMO_BENCHMARK=true \
 *     npx vitest run tests/pursuit/memo-model-benchmark.test.ts
 *
 * Mantle credentials are loaded through the same credential loader as the
 * deployed Pursuit worker. The benchmark uses the exact production prompt,
 * schema, sanitizers and deterministic fallback boundary.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadMantleCredentials } from "../../src/lib/model/bedrock-credentials";
import { extractFigures } from "../../src/pursuit/approval";
import { PursuitTokenLedger } from "../../src/pursuit/budget";
import { pursuitMantleModelIds } from "../../src/pursuit/model";
import type { RoleBrief } from "../../src/pursuit/role-brief";
import {
  findLeakage,
  findSemanticInflation,
  hasOverclaim,
} from "../../src/pursuit/semantic/validate";
import {
  deriveDeterministicThesis,
  enrichThesis,
  type DerivedThesis,
} from "../../src/pursuit/thesis";
import type { CandidateArchetype, CandidateClaim, StyleProfile } from "../../src/pursuit/types";

const RUN_LIVE = process.env.RADAR_RUN_LIVE_PURSUIT_MEMO_BENCHMARK === "true";
const liveIt = RUN_LIVE ? it : it.skip;

const FIXTURES = path.join(__dirname, "../fixtures/pursuit");
const load = <T>(p: string): T => JSON.parse(readFileSync(path.join(FIXTURES, p), "utf-8")) as T;

const claims = load<CandidateClaim[]>("candidate-claims.json");
const archetypes = load<CandidateArchetype[]>("archetypes.json");
const style: StyleProfile = {
  preferredPhrasings: [],
  promotedClaimIds: [],
  rejectedClaimIds: [],
  archetypeOverrides: [],
  observedEditCount: 0,
};

interface BenchmarkCase {
  id: string;
  brief: RoleBrief;
  /** Role-specific concepts a useful memo should surface somewhere. */
  signals: RegExp[];
  /** The central sceptical question this role should not hand-wave away. */
  gap: RegExp;
}

const CASES: BenchmarkCase[] = [
  {
    id: "globallogic-data-ai",
    brief: load<RoleBrief>("globallogic-data-ai/role.json"),
    signals: [/data\s*(?:&|and)\s*ai/i, /practice/i, /technical|engineering|generative ai/i],
    gap: /technical|data engineering|generative ai/i,
  },
  {
    id: "wpp-client-services",
    brief: load<RoleBrief>("wpp-client-services/role.json"),
    signals: [/client/i, /commercial|revenue|fee book/i, /measurement|360|integrated/i],
    gap: /scope|title|authority|team/i,
  },
  {
    id: "antal-managing-partner",
    brief: load<RoleBrief>("antal-managing-partner/role.json"),
    signals: [
      /executive search|recruitment/i,
      /franchise|practice/i,
      /business development|revenue/i,
    ],
    gap: /executive search|recruitment|franchise/i,
  },
  {
    id: "msm-unify-csto",
    brief: load<RoleBrief>("msm-unify-csto/role.json"),
    signals: [/founder/i, /transformation|operating model/i, /ai|automation|governance/i],
    gap: /enterprise|founder|finance|operations|ai/i,
  },
  {
    id: "weber-shandwick-vp-digital",
    brief: load<RoleBrief>("weber-shandwick-vp-digital/role.json"),
    signals: [/digital/i, /integrated|communications/i, /commercial|profitability|practice/i],
    gap: /earned|communications|pr|practice/i,
  },
];

/**
 * us-east-1 Standard on-demand rates, USD per 1M tokens.
 * Snapshot: 2026-10-01. This is intentionally explicit so historical benchmark
 * reports remain reproducible even after AWS changes list prices.
 */
const MODELS = [
  {
    id: "zai.glm-5",
    label: "GLM-5",
    inputUsdPerMillion: 1.0,
    outputUsdPerMillion: 3.2,
  },
  {
    id: "deepseek.v3.2",
    label: "DeepSeek V3.2 (deployed default)",
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

const CLICHES =
  /results-driven|proven track record|passionate|synergy|dynamic professional|uniquely positioned|perfect fit/i;
const INTERNAL_DIRECTIVE =
  /present through|lead with|this lens|candidate should|positioning:|avoid saying|anchor the answer/i;

function memoText(thesis: DerivedThesis): string {
  return [
    thesis.targetMandate,
    thesis.winTheme,
    thesis.recommendedPositioning,
    ...thesis.primaryProof.flatMap((p) => [p.headline, p.whyItMatters]),
    ...thesis.objections.flatMap((o) => [o.objection, o.counterPosition]),
    ...thesis.narrativesToAvoid,
  ].join("\n");
}

function candidateAssertionText(thesis: DerivedThesis): string {
  return [
    thesis.winTheme,
    ...thesis.primaryProof.map((p) => p.whyItMatters),
    ...thesis.objections.map((o) => o.counterPosition),
  ].join("\n");
}

function changedFields(before: DerivedThesis, after: DerivedThesis) {
  return {
    targetMandate: before.targetMandate !== after.targetMandate,
    winTheme: before.winTheme !== after.winTheme,
    narrativesToAvoid:
      JSON.stringify(before.narrativesToAvoid) !== JSON.stringify(after.narrativesToAvoid),
    proofWhyItMatters: after.primaryProof.filter(
      (p, i) => p.whyItMatters !== before.primaryProof[i]?.whyItMatters,
    ).length,
    objectionCounters: after.objections.filter(
      (o, i) => o.counterPosition !== before.objections[i]?.counterPosition,
    ).length,
  };
}

function qualityProxy(
  spec: BenchmarkCase,
  deterministic: DerivedThesis,
  enriched: DerivedThesis,
): {
  score: number;
  grounding: number;
  specificity: number;
  scepticism: number;
  writing: number;
  utility: number;
  unsupportedFigures: string[];
  leakage: string[];
  overclaim: boolean;
  semanticInflation: string[];
  signalHits: number;
} {
  const text = memoText(enriched);
  const assertionText = candidateAssertionText(enriched);
  const allowedFigures = new Set(
    extractFigures(
      [
        JSON.stringify(spec.brief),
        ...claims.flatMap((c) => [
          c.statement,
          c.sourceLocator ?? "",
          c.metricBaseline ?? "",
          c.metricResult ?? "",
        ]),
      ].join("\n"),
    ),
  );
  const unsupportedFigures = [
    ...new Set(extractFigures(text).filter((f) => !allowedFigures.has(f))),
  ];
  const leakage = findLeakage(assertionText);
  const strongest =
    deterministic.semantic?.positioning.mode === "DIRECT_DOMAIN" ? "DIRECT" : "ANALOGOUS";
  const overclaim = hasOverclaim(assertionText, strongest);
  const semanticInflation = findSemanticInflation(assertionText, claims);
  const allowedProofIds = new Set(deterministic.primaryProof.map((p) => p.claimId).filter(Boolean));
  const proofIntegrity = enriched.primaryProof.every(
    (p) => !p.claimId || allowedProofIds.has(p.claimId),
  );

  let grounding = 30;
  if (unsupportedFigures.length) grounding -= 10;
  if (leakage.length) grounding -= 8;
  if (overclaim) grounding -= 8;
  if (semanticInflation.length) grounding -= 10;
  if (!proofIntegrity) grounding -= 10;
  grounding = Math.max(0, grounding);

  const signalHits = spec.signals.filter((signal) => signal.test(text)).length;
  const specificity =
    Math.round((signalHits / spec.signals.length) * 18) +
    (extractFigures(text).length > 0 ? 4 : 0) +
    (new RegExp(spec.brief.company.replace(/[.*+?^$()|[\]\\]/g, "\\$&"), "i").test(text) ? 3 : 0);

  const objectionText = enriched.objections
    .flatMap((o) => [o.objection, o.counterPosition])
    .join("\n");
  const scepticism =
    (spec.gap.test(objectionText) ? 10 : 0) +
    (enriched.objections.some((o) => o.severity === "MATERIAL" || o.severity === "MODERATE")
      ? 5
      : 0) +
    (enriched.objections.some((o) => extractFigures(o.counterPosition).length > 0) ? 5 : 0);

  const writing =
    (!CLICHES.test(text) ? 5 : 0) +
    (!INTERNAL_DIRECTIVE.test(assertionText) ? 5 : 0) +
    (enriched.winTheme.length >= 60 && enriched.winTheme.length <= 650 ? 5 : 0);

  const utility =
    (enriched.primaryProof.length >= 2 ? 3 : 0) +
    (enriched.objections.length >= 1 ? 3 : 0) +
    (enriched.narrativesToAvoid.length >= 2 ? 2 : 0) +
    (enriched.targetMandate.trim().length >= 40 ? 2 : 0);

  return {
    score: grounding + specificity + scepticism + writing + utility,
    grounding,
    specificity,
    scepticism,
    writing,
    utility,
    unsupportedFigures,
    leakage,
    overclaim,
    semanticInflation,
    signalHits,
  };
}

function estimatedCost(
  inputTokens: number,
  outputTokens: number,
  model: (typeof MODELS)[number],
): number {
  return (
    (inputTokens / 1_000_000) * model.inputUsdPerMillion +
    (outputTokens / 1_000_000) * model.outputUsdPerMillion
  );
}

describe("Pursuit memo benchmark configuration", () => {
  it("pins five real roles and three Mantle candidates without touching dossier composition", () => {
    expect(CASES.map((c) => c.id)).toEqual([
      "globallogic-data-ai",
      "wpp-client-services",
      "antal-managing-partner",
      "msm-unify-csto",
      "weber-shandwick-vp-digital",
    ]);
    expect(MODELS.map((m) => m.id)).toEqual(["zai.glm-5", "deepseek.v3.2", "moonshotai.kimi-k2.5"]);
    expect(CASES).toHaveLength(5);

    const original = process.env.RADAR_PURSUIT_MANTLE_MODEL;
    try {
      delete process.env.RADAR_PURSUIT_MANTLE_MODEL;
      expect(pursuitMantleModelIds()).toEqual(["deepseek.v3.2", "zai.glm-5"]);
      process.env.RADAR_PURSUIT_MANTLE_MODEL = "moonshotai.kimi-k2.5";
      expect(pursuitMantleModelIds()).toEqual(["moonshotai.kimi-k2.5", "zai.glm-5"]);
    } finally {
      if (original === undefined) delete process.env.RADAR_PURSUIT_MANTLE_MODEL;
      else process.env.RADAR_PURSUIT_MANTLE_MODEL = original;
    }
  });
  it("reserves a bounded Pursuit package across parallel model calls", () => {
    const ledger = new PursuitTokenLedger({ inputTokens: 10_000, outputTokens: 1_000 });
    const reservations = [1, 2, 3, 4].map(() => ledger.reserve(2_000));
    expect(reservations.every(Boolean)).toBe(true);
    expect(ledger.reserve(1)).toBeNull();
    for (const reservation of reservations)
      ledger.settle(reservation!, { inputTokens: 1_500, outputTokens: 200 });
    expect(ledger.snapshot()).toMatchObject({ inputTokens: 6_000, outputTokens: 800, calls: 4 });
    const finalReservation = ledger.reserve(2_000);
    expect(finalReservation).toEqual({ input: 2_000, output: 200 });
    ledger.settle(finalReservation!, { inputTokens: 2_000, outputTokens: 200 });
    expect(ledger.exhausted()).toBe(true);
    expect(ledger.reserve(1)).toBeNull();
  });
});

describe("Pursuit memo model quality/cost benchmark — Mantle", () => {
  liveIt(
    "compares GLM-5, DeepSeek V3.2 and Kimi K2.5 across five real captured roles",
    async () => {
      loadMantleCredentials();

      const originalModel = process.env.RADAR_PURSUIT_MANTLE_MODEL;
      const originalGemini = process.env.RADAR_PURSUIT_ENABLE_GEMINI;
      process.env.RADAR_PURSUIT_ENABLE_GEMINI = "false";

      const report: Array<Record<string, unknown>> = [];

      try {
        for (const model of MODELS) {
          process.env.RADAR_PURSUIT_MANTLE_MODEL = model.id;

          const rows = await Promise.all(
            CASES.map(async (spec) => {
              const deterministic = deriveDeterministicThesis({
                brief: spec.brief,
                claims,
                archetypes,
                style,
                seed: `memo-benchmark|${spec.id}`,
              });
              const archetype =
                archetypes.find((candidate) => candidate.id === deterministic.archetypeId) ?? null;
              const ledger = new PursuitTokenLedger({
                inputTokens: 100_000,
                outputTokens: 25_000,
              });
              const started = performance.now();
              const enriched = await enrichThesis(deterministic, {
                brief: spec.brief,
                claims,
                archetype,
                style,
                model: { ledger },
              });
              const latencyMs = Math.round(performance.now() - started);
              const spend = ledger.snapshot();
              const quality = qualityProxy(spec, deterministic, enriched);
              const changes = changedFields(deterministic, enriched);

              const modelAnswered =
                enriched.derivation === "MODEL" &&
                enriched.modelId === `bedrock-mantle:${model.id}`;

              return {
                case: spec.id,
                company: spec.brief.company,
                role: spec.brief.roleTitle,
                model: model.id,
                label: model.label,
                deployed: model.id === "deepseek.v3.2",
                modelAnswered,
                qualityProxy: quality.score,
                qualityBreakdown: {
                  grounding: quality.grounding,
                  specificity: quality.specificity,
                  scepticism: quality.scepticism,
                  writing: quality.writing,
                  utility: quality.utility,
                },
                signalHits: `${quality.signalHits}/${spec.signals.length}`,
                acceptedChanges: changes,
                latencyMs,
                inputTokens: spend.inputTokens,
                outputTokens: spend.outputTokens,
                estimatedCostUsd: Number(
                  estimatedCost(spend.inputTokens, spend.outputTokens, model).toFixed(6),
                ),
                safety: {
                  unsupportedFigures: quality.unsupportedFigures,
                  leakage: quality.leakage,
                  overclaim: quality.overclaim,
                  semanticInflation: quality.semanticInflation,
                },
                thesis: {
                  targetMandate: enriched.targetMandate,
                  winTheme: enriched.winTheme,
                  proof: enriched.primaryProof,
                  objections: enriched.objections,
                  narrativesToAvoid: enriched.narrativesToAvoid,
                },
              };
            }),
          );
          report.push(...rows);
        }
      } finally {
        if (originalModel === undefined) delete process.env.RADAR_PURSUIT_MANTLE_MODEL;
        else process.env.RADAR_PURSUIT_MANTLE_MODEL = originalModel;
        if (originalGemini === undefined) delete process.env.RADAR_PURSUIT_ENABLE_GEMINI;
        else process.env.RADAR_PURSUIT_ENABLE_GEMINI = originalGemini;
      }

      expect(report).toHaveLength(MODELS.length * CASES.length);

      const summary = MODELS.map((model) => {
        const rows = report.filter((row) => row.model === model.id);
        return {
          model: model.id,
          deployed: model.id === "deepseek.v3.2",
          avgQualityProxy: Number(
            (rows.reduce((sum, row) => sum + Number(row.qualityProxy), 0) / rows.length).toFixed(1),
          ),
          totalCostUsd: Number(
            rows.reduce((sum, row) => sum + Number(row.estimatedCostUsd), 0).toFixed(6),
          ),
          avgLatencyMs: Math.round(
            rows.reduce((sum, row) => sum + Number(row.latencyMs), 0) / rows.length,
          ),
          inputTokens: rows.reduce((sum, row) => sum + Number(row.inputTokens), 0),
          outputTokens: rows.reduce((sum, row) => sum + Number(row.outputTokens), 0),
          answeredCases: rows.filter((row) => row.modelAnswered === true).length,
          safetyFailures: rows.filter((row) => {
            const safety = row.safety as {
              unsupportedFigures: string[];
              leakage: string[];
              overclaim: boolean;
              semanticInflation: string[];
            };
            return (
              safety.unsupportedFigures.length > 0 ||
              safety.leakage.length > 0 ||
              safety.overclaim ||
              safety.semanticInflation.length > 0
            );
          }).length,
        };
      });

      const payload = {
        pricingRegion: "us-east-1",
        pricingAsOf: "2026-10-01",
        sourceRuntime: "Oracle production dependencies with certified Pursuit source overlay",
        sourceReleaseSha: process.env.RADAR_PURSUIT_BENCHMARK_SOURCE_SHA?.trim() || null,
        benchmarkCodeSha: process.env.RADAR_PURSUIT_BENCHMARK_CODE_SHA?.trim() || null,
        configuredMantleOverride: originalModel?.trim() || null,
        summary,
        rows: report,
      };

      console.table(summary);
      console.log("\nPURSUIT_MEMO_BENCHMARK_REPORT");
      console.log(JSON.stringify(payload, null, 2));

      const outputPath = process.env.RADAR_PURSUIT_MEMO_BENCHMARK_REPORT?.trim();
      if (outputPath) writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf-8");

      const unanswered = report.filter((row) => row.modelAnswered !== true);
      const unsafe = report.filter((row) => {
        const safety = row.safety as {
          unsupportedFigures: string[];
          leakage: string[];
          overclaim: boolean;
          semanticInflation: string[];
        };
        return (
          safety.unsupportedFigures.length > 0 ||
          safety.leakage.length > 0 ||
          safety.overclaim ||
          safety.semanticInflation.length > 0
        );
      });
      expect(
        unanswered.map((row) => `${row.model}/${row.case}`),
        "Every model/case must complete through Mantle; deterministic fallbacks are not benchmark results.",
      ).toEqual([]);
      expect(
        unsafe.map((row) => ({ model: row.model, case: row.case, safety: row.safety })),
        "No benchmarked memo may hallucinate figures, leak internal instructions, or overclaim direct experience.",
      ).toEqual([]);
    },
    30 * 60_000,
  );
});
