import { assertBenchEnvironment, workerEnvironment } from "./bench-environment";
import { randomUUID } from "node:crypto";
import type { StageObserver } from "../lib/model/stage-observer";
import type { DatabaseAdapter } from "../data/database/adapter";
import type { ReasoningModel, Dossier } from "../dossier/contracts";
import type {
  ModelInvocationSink,
  ModelCallMetadata,
  ModelUsage,
} from "../lib/model/model-invocation";
import {
  createBedrockGlmResearchModel,
  GLM_STAGE_OUTPUT_TOKENS,
} from "../lib/model/bedrock-glm-research-model";
import { createDossierWriterModel } from "../lib/model/dossier-writer-model";
import { createFactualReviewModel } from "../lib/model/factual-review-model";
import { runStagedFrozenDecisionDetailed } from "../dossier/staged-decision";
import { composeStagedDossier } from "../dossier/staged-composition";
import { laneModel, operationalModel } from "./model-gateway";
import { activeRevision, revision } from "./config-store";
import type { EngineConfig, ModelLane } from "./config-contracts";
import { requirePlatformRole } from "./service";
import { benchFixtures, BENCH_FIXTURE_VERSION } from "./bench-fixtures";
import { PursuitTokenLedger } from "../pursuit/budget";
import { generateWithFallback } from "../pursuit/model";
/** Reserve the adapter's actual stage allowance, not a larger lane-wide maximum. */
export function benchOutputAllowance(
  model: { id: string },
  settings: EngineConfig[ModelLane],
  metadata?: ModelCallMetadata,
  review = false,
) {
  const stage = metadata?.stage as keyof typeof GLM_STAGE_OUTPUT_TOKENS;
  const adapterDefault =
    model.id === "bedrock-mantle"
      ? (GLM_STAGE_OUTPUT_TOKENS[stage] ??
        (settings.model === "legacy" ? 12288 : settings.maxOutputTokens))
      : review
        ? 16384
        : 12288;
  return Math.min(metadata?.maxOutputTokens ?? adapterDefault, settings.maxOutputTokens);
}
export type BenchRow = {
  id: string;
  scope: string;
  revision_id: string;
  active_revision_id: string;
  token_cap: number;
  created_by: string;
  expected_environment_json: string | null;
};
export type BenchResult = {
  fixtureVersion: string;
  safeToPublish: boolean;
  verdictsChanged: number;
  passToPursue: number;
  passToAdmitted?: number;
  screeningRelaxations?: number;
  invalidOutputs: number;
  validationRepairs?: number;
  /** Actual bounded writing-lane smoke of the model-backed Pursuit path. */
  pursuitFixture?: { modelId: string; inputTokens: number; outputTokens: number };
  cases: Record<string, unknown>[];
};
export function compareBenchCase(
  id: string,
  before: { verdict: string; screeningViability: string },
  after: { verdict: string; screeningViability: string },
  beforeMemo?: Dossier,
  afterMemo?: Dossier,
) {
  const fields = [
    "executiveThesis",
    "opportunityValue",
    "mandate",
    "candidateFit",
    "decisionConditions",
    "approach",
  ];
  const claims = (memo?: Dossier) =>
    new Map(
      [
        ...(memo?.evidence.roleClaims ?? []),
        ...(memo?.evidence.candidateClaims ?? []),
        ...(memo?.evidence.contextualClaims ?? []),
        ...(memo?.evidence.relationalClaims ?? []),
      ].map((c) => [c.id, JSON.stringify(c)]),
    );
  const oldClaims = claims(beforeMemo),
    newClaims = claims(afterMemo);
  return {
    claimsAdded: [...newClaims.keys()].filter((id) => !oldClaims.has(id)),
    claimsRemoved: [...oldClaims.keys()].filter((id) => !newClaims.has(id)),
    claimsChanged: [...newClaims.keys()].filter(
      (id) => oldClaims.has(id) && oldClaims.get(id) !== newClaims.get(id),
    ),
    fixture: id,
    beforeVerdict: before.verdict,
    afterVerdict: after.verdict,
    beforeViability: before.screeningViability,
    afterViability: after.screeningViability,
    sectionsChanged: fields.filter(
      (field) =>
        JSON.stringify(beforeMemo?.[field as keyof Dossier]) !==
        JSON.stringify(afterMemo?.[field as keyof Dossier]),
    ),
  };
}
export class BenchWorker {
  constructor(
    private db: DatabaseAdapter,
    private runCases?: (row: BenchRow, token: string) => Promise<BenchResult>,
  ) {}
  async pollOnce() {
    const token = randomUUID();
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(
        "UPDATE admin_bench_runs SET status='failed',error='BENCH_LEASE_EXPIRED; no automatic paid retry',completed_at=?,lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<=?",
        [Date.now(), Date.now()],
      );
      const next = await tx.one<BenchRow>(
        "SELECT * FROM admin_bench_runs WHERE status='queued' ORDER BY created_at LIMIT 1",
      );
      if (!next) return null;
      try {
        await requirePlatformRole(tx, next.created_by, true);
      } catch {
        await tx.execute(
          "UPDATE admin_bench_runs SET status='failed',error='OPERATOR_ACCESS_REVOKED',completed_at=? WHERE id=?",
          [Date.now(), next.id],
        );
        return null;
      }
      const active = await activeRevision(
        tx,
        next.scope === "platform" ? undefined : next.scope.slice(7),
      );
      const draft = await tx.one<{ revision_id: string }>(
        "SELECT revision_id FROM config_drafts WHERE scope=?",
        [next.scope],
      );
      if (active.id !== next.active_revision_id || draft?.revision_id !== next.revision_id) {
        await tx.execute(
          "UPDATE admin_bench_runs SET status='failed',error='BENCH_REVISION_STALE',completed_at=? WHERE id=?",
          [Date.now(), next.id],
        );
        return null;
      }
      let attestation;
      try {
        assertBenchEnvironment(next.expected_environment_json);
        attestation = workerEnvironment();
      } catch (error) {
        await tx.execute(
          "UPDATE admin_bench_runs SET status='failed',error=?,completed_at=? WHERE id=? AND status='queued'",
          [
            error instanceof Error ? error.message : "BENCH_ENVIRONMENT_INVALID",
            Date.now(),
            next.id,
          ],
        );
        return null;
      }
      await tx.execute(
        "UPDATE admin_bench_runs SET status='running',worker_environment_json=?,lease_token=?,lease_until=? WHERE id=? AND status='queued'",
        [JSON.stringify(attestation), token, Date.now() + 600000, next.id],
      );
      return next;
    });
    if (!row) return null;
    const timer = setInterval(() => {
      void this.db
        .execute(
          "UPDATE admin_bench_runs SET lease_until=? WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
          [Date.now() + 600000, row.id, token, Date.now()],
        )
        .catch(() => {});
    }, 30000);
    timer.unref();
    try {
      const result = await (this.runCases
        ? this.runCases(row, token)
        : this.executeCases(row, token));
      const invalid = await this.db.one<{ n: number }>(
        "SELECT COUNT(*) n FROM model_invocations WHERE bench_run_id=? AND status='invalid_output'",
        [row.id],
      );
      result.invalidOutputs += invalid?.n ?? 0;
      // Derive safety server-side; a callback cannot assert away a harmful flip.
      result.passToPursue = result.cases.filter(
        (c) => c.beforeVerdict === "PASS" && c.afterVerdict === "PURSUE",
      ).length;
      result.passToAdmitted = result.cases.filter(
        (c) =>
          c.beforeVerdict === "PASS" && ["PURSUE", "CONSIDER"].includes(String(c.afterVerdict)),
      ).length;
      result.screeningRelaxations = result.cases.filter(
        (c) => c.beforeViability === "BLOCKED" && c.afterViability !== "BLOCKED",
      ).length;
      result.verdictsChanged = result.cases.filter(
        (c) => c.beforeVerdict !== c.afterVerdict,
      ).length;
      result.safeToPublish =
        result.safeToPublish &&
        result.passToAdmitted === 0 &&
        result.screeningRelaxations === 0 &&
        result.invalidOutputs === 0 &&
        (result.validationRepairs ?? 0) === 0 &&
        (this.runCases !== undefined || result.pursuitFixture !== undefined) &&
        result.cases.length === benchFixtures().length &&
        result.fixtureVersion === BENCH_FIXTURE_VERSION &&
        benchFixtures().every((fixture) => {
          const matches = result.cases.filter((c) => c.fixture === fixture.opportunity.id);
          if (matches.length !== 1) return false;
          const c = matches[0];
          if (
            ![c.beforeVerdict, c.afterVerdict].every((v) =>
              ["PURSUE", "CONSIDER", "PASS"].includes(String(v)),
            ) ||
            ![c.beforeViability, c.afterViability].every((v) =>
              ["PLAUSIBLE", "BLOCKED"].includes(String(v)),
            )
          )
            return false;
          if (fixture.opportunity.id === "growth-leadership")
            return (
              [c.beforeVerdict, c.afterVerdict].every((v) =>
                ["PURSUE", "CONSIDER"].includes(String(v)),
              ) &&
              c.beforeViability === "PLAUSIBLE" &&
              c.afterViability === "PLAUSIBLE"
            );
          return (
            fixture.opportunity.id !== "mandatory-license" ||
            (c.beforeVerdict === "PASS" &&
              c.afterVerdict === "PASS" &&
              c.beforeViability === "BLOCKED" &&
              c.afterViability === "BLOCKED")
          );
        });
      await this.db.transaction(async (tx) => {
        await this.assertCurrent(tx, row, token);
        const completed = await tx.execute(
          "UPDATE admin_bench_runs SET status=?,result_json=?,completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
          [
            result.safeToPublish ? "passed" : "failed",
            JSON.stringify(result),
            Date.now(),
            row.id,
            token,
            Date.now(),
          ],
        );
        if (!completed.rowsAffected) throw new Error("BENCH_LEASE_LOST");
      });
      return { id: row.id, status: result.safeToPublish ? "passed" : "failed" };
    } catch (error) {
      // Provider messages may contain request details; store only a classified label.
      const label =
        error instanceof Error && error.message.startsWith("BENCH_")
          ? error.message.slice(0, 150)
          : "BENCH_VALIDATION_OR_PROVIDER_FAILURE";
      await this.db.execute(
        "UPDATE admin_bench_runs SET status='failed',error=?,completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running'",
        [label, Date.now(), row.id, token],
      );
      return { id: row.id, status: "failed" };
    } finally {
      clearInterval(timer);
    }
  }
  private async assertCurrent(db: DatabaseAdapter, row: BenchRow, token: string) {
    await requirePlatformRole(db, row.created_by, true);
    assertBenchEnvironment(row.expected_environment_json);
    const desired = await revision(db, row.revision_id);
    if (
      desired.inherit_revision_id &&
      (await activeRevision(db)).id !== desired.inherit_revision_id
    )
      throw new Error("BENCH_PLATFORM_CHANGED");
    const active = await activeRevision(
      db,
      row.scope === "platform" ? undefined : row.scope.slice(7),
    );
    const draft = await db.one<{ revision_id: string }>(
      "SELECT revision_id FROM config_drafts WHERE scope=?",
      [row.scope],
    );
    if (active.id !== row.active_revision_id || draft?.revision_id !== row.revision_id)
      throw new Error("BENCH_REVISION_STALE");
    if (
      !(await db.one(
        "SELECT id FROM admin_bench_runs WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
        [row.id, token, Date.now()],
      ))
    )
      throw new Error("BENCH_LEASE_LOST");
  }
  private model(
    row: BenchRow,
    token: string,
    config: EngineConfig,
    lane: ModelLane,
    side: string,
    review = false,
    pipeline: "dossier" | "pursuit" = "dossier",
  ): ReasoningModel {
    const sink: ModelInvocationSink = async (event) => {
      await this.db.execute(
        `INSERT INTO model_invocations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,request_fingerprint,started_at,completed_at,input_tokens,output_tokens,total_tokens,reasoning_tokens,status,purpose,bench_run_id,max_output_tokens,latency_ms,finish_reason,error_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'BENCH',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,total_tokens=excluded.total_tokens,reasoning_tokens=excluded.reasoning_tokens,status=excluded.status,latency_ms=excluded.latency_ms,finish_reason=excluded.finish_reason,error_code=excluded.error_code`,
        [
          event.invocationId,
          row.scope === "platform" ? "platform-bench" : row.scope.slice(7),
          "synthetic-fixture",
          `bench:${row.id}`,
          "fixture",
          side === "active" ? row.active_revision_id : row.revision_id,
          lane === "reasoning" ? "evaluation" : review ? "factual_review" : pipeline,
          event.stage,
          event.attempt,
          event.provider,
          event.modelId,
          event.modelVersion,
          event.modelConfigurationFingerprint,
          event.requestFingerprint,
          event.startedAt,
          event.completedAt ?? null,
          event.usage?.inputTokens ?? null,
          event.usage?.outputTokens ?? null,
          event.usage?.totalTokens ?? null,
          event.usage?.reasoningTokens ?? null,
          event.status,
          row.id,
          event.maxOutputTokens ?? null,
          event.completedAt === undefined ? null : Math.max(0, event.completedAt - event.startedAt),
          event.finishReason ?? null,
          event.errorCode ? "BENCH_PROVIDER_FAILURE" : null,
        ],
      );
    };
    // Recheck after waiting for a provider slot, immediately before dispatch.
    sink.beforeCall = async () => this.db.transaction((tx) => this.assertCurrent(tx, row, token));
    const model = operationalModel(
      this.db,
      laneModel(
        config,
        lane,
        () =>
          lane === "reasoning"
            ? createBedrockGlmResearchModel({ invocationSink: sink })
            : review
              ? createFactualReviewModel({ invocationSink: sink })
              : createDossierWriterModel({ invocationSink: sink }),
        sink,
        `bench:${row.scope}`,
      ),
      {
        pipeline: "evaluation",
        tenantId: row.scope === "platform" ? "platform-bench" : row.scope.slice(7),
        personId: "synthetic-fixture",
        canonicalJobId: `bench:${row.id}`,
        opportunityVersion: "fixture",
        evaluationContextFingerprint: side === "active" ? row.active_revision_id : row.revision_id,
      },
    );
    return {
      ...model,
      id: model.id,
      version: model.version,
      schemaFormat: model.schemaFormat,
      configurationFingerprint: `${model.configurationFingerprint}:${row.id}:${side}:${review}`,
      generate: async (instruction, input, schema, metadata) => {
        const maxOutput = benchOutputAllowance(model, config[lane], metadata, review);
        const reserve =
          Buffer.byteLength(JSON.stringify({ instruction, input, schema }), "utf8") +
          2048 +
          maxOutput;
        await this.db.transaction(async (tx) => {
          await requirePlatformRole(tx, row.created_by, true);
          const active = await activeRevision(
            tx,
            row.scope === "platform" ? undefined : row.scope.slice(7),
          );
          const currentDraft = await tx.one<{ revision_id: string }>(
            "SELECT revision_id FROM config_drafts WHERE scope=?",
            [row.scope],
          );
          if (currentDraft?.revision_id !== row.revision_id)
            throw new Error("BENCH_REVISION_STALE");
          if (active.id !== row.active_revision_id)
            throw new Error("BENCH_ACTIVE_REVISION_CHANGED");
          const result = await tx.execute(
            "UPDATE admin_bench_runs SET tokens_reserved=tokens_reserved+? WHERE id=? AND lease_token=? AND status='running' AND lease_until>? AND tokens_reserved+?<=token_cap",
            [reserve, row.id, token, Date.now(), reserve],
          );
          if (!result.rowsAffected) throw new Error("BENCH_TOKEN_CAP_OR_LEASE_LOST");
        });
        return model.generate(
          instruction,
          input,
          schema,
          config[lane].model === "legacy" && metadata?.maxOutputTokens === undefined
            ? metadata
            : { ...metadata, maxOutputTokens: maxOutput },
        );
      },
    };
  }
  private async executeCases(row: BenchRow, token: string): Promise<BenchResult> {
    const active = await revision(this.db, row.active_revision_id),
      draft = await revision(this.db, row.revision_id),
      cases: Record<string, unknown>[] = [];
    let validationRepairs = 0;
    const onStage: StageObserver = (_stage, event) => {
      if (event?.kind === "repair") validationRepairs++;
    };
    for (const frozen of benchFixtures()) {
      const before = await runStagedFrozenDecisionDetailed(
        frozen,
        this.model(row, token, active.config, "reasoning", "active"),
        onStage,
      );
      const after = await runStagedFrozenDecisionDetailed(
        frozen,
        this.model(row, token, draft.config, "reasoning", "draft"),
        onStage,
      );
      const beforeMemo =
        before.decision.verdict === "PASS"
          ? undefined
          : await composeStagedDossier(
              frozen,
              before,
              this.model(row, token, active.config, "writing", "active"),
              this.model(row, token, active.config, "writing", "active", true),
              onStage,
            );
      const afterMemo =
        after.decision.verdict === "PASS"
          ? undefined
          : await composeStagedDossier(
              frozen,
              after,
              this.model(row, token, draft.config, "writing", "draft"),
              this.model(row, token, draft.config, "writing", "draft", true),
              onStage,
            );
      cases.push(
        compareBenchCase(
          frozen.opportunity.id,
          before.decision,
          after.decision,
          beforeMemo,
          afterMemo,
        ),
      );
    }
    // This does not create a pursuit, artifact or candidate record. It verifies
    // that the chosen writing lane can service the model-assisted Pursuit route
    // under the same bounded package ledger used by durable preparation.
    const ledger = new PursuitTokenLedger({
      inputTokens: draft.config.pursuitInputTokens,
      outputTokens: draft.config.pursuitOutputTokens,
    });
    const pursuitModel = this.model(row, token, draft.config, "writing", "draft", false, "pursuit");
    const pursuit = await generateWithFallback<{ fixture: string }>(
      "pursuit-bench",
      "Return exactly the JSON object required by the schema. This is a synthetic RADAR configuration check.",
      { fixture: "pursuit-lane" },
      {
        type: "object",
        additionalProperties: false,
        required: ["fixture"],
        properties: { fixture: { const: "pursuit-lane" } },
      },
      (raw) => {
        if (
          !raw ||
          typeof raw !== "object" ||
          (raw as { fixture?: unknown }).fixture !== "pursuit-lane"
        )
          throw new Error("BENCH_PURSUIT_INVALID_OUTPUT");
        return raw as { fixture: string };
      },
      {
        configuredModels: [
          {
            id: `${pursuitModel.id}:${pursuitModel.version}`,
            generate: pursuitModel.generate.bind(pursuitModel),
            usage: () => (pursuitModel as { lastUsage?: ModelUsage }).lastUsage,
          },
        ],
        ledger,
        strictBudget: true,
      },
    );
    if (!pursuit) throw new Error("BENCH_PURSUIT_PROVIDER_UNAVAILABLE");
    const pursuitSpend = ledger.snapshot();
    return {
      fixtureVersion: BENCH_FIXTURE_VERSION,
      safeToPublish: true,
      verdictsChanged: 0,
      passToPursue: 0,
      invalidOutputs: 0,
      validationRepairs,
      pursuitFixture: {
        modelId: pursuit.modelId,
        inputTokens: pursuitSpend.inputTokens,
        outputTokens: pursuitSpend.outputTokens,
      },
      cases,
    };
  }
}
