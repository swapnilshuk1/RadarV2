import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import type { ReasoningModel } from "../dossier/contracts";
import type { StagedDecisionTrace } from "../dossier/staged-decision-contract";
import type { ModelInvocationSink } from "../lib/model/model-invocation";
import { createBedrockGlmResearchModel } from "../lib/model/bedrock-glm-research-model";
import { laneModel, operationalModel } from "./model-gateway";
import { benchOutputAllowance } from "./bench-worker";
import { activeRevision, revision as configRevision } from "./config-store";
import type { EngineConfig } from "./config-contracts";
import { requirePlatformRole } from "./service";
import { assertBenchEnvironment, workerEnvironment } from "./bench-environment";
import { activeSearchTaxonomy, revision } from "./taxonomy-store";
import { pinIntelligence } from "../evaluation/intelligence-taxonomy";
import { evaluateAttentionGate } from "../lib/intelligence/AttentionGate";
import { runStagedFrozenDecisionDetailed } from "../dossier/staged-decision";
import { contextInputFingerprint } from "../data/sqlite/repositories/SqliteStagedInputStore";
import {
  intelligenceShadowCases,
  intelligenceCohortHash,
  INTELLIGENCE_SHADOW_VERSION,
  type ShadowCase,
} from "./intelligence-shadow";
export type IntelligenceShadowRow = {
  id: string;
  scope: string;
  revision_id: string;
  active_revision_id: string;
  config_revision_id: string;
  created_by: string;
  cohort_hash: string;
  scope_json: string;
  environment_json: string;
  token_cap: number;
};
export type IntelligenceShadowResult = {
  version: string;
  safeToPublish: boolean;
  cases: Array<{
    id: string;
    beforeAdmission: string;
    afterAdmission: string;
    beforeVerdict: string;
    afterVerdict: string;
    beforeViability: string;
    afterViability: string;
    beforeDiagnostics?: Pick<
      StagedDecisionTrace,
      "requirements" | "eligibleScreeningDrivers" | "screeningConstraint"
    >;
    afterDiagnostics?: Pick<
      StagedDecisionTrace,
      "requirements" | "eligibleScreeningDrivers" | "screeningConstraint"
    >;
  }>;
  admissionsChanged: number;
  verdictsChanged: number;
  invalidOutputs: number;
  repairs: number;
  passToPursue: number;
  passToAdmitted?: number;
  repairStages?: string[];
};
export function assessIntelligenceShadow(result: IntelligenceShadowResult, expectedIds: string[]) {
  result.admissionsChanged = result.cases.filter(
    (c) => c.beforeAdmission !== c.afterAdmission,
  ).length;
  result.verdictsChanged = result.cases.filter((c) => c.beforeVerdict !== c.afterVerdict).length;
  result.passToPursue = result.cases.filter(
    (c) => c.beforeVerdict === "PASS" && c.afterVerdict === "PURSUE",
  ).length;
  result.passToAdmitted = result.cases.filter(
    (c) => c.beforeVerdict === "PASS" && ["PURSUE", "CONSIDER"].includes(c.afterVerdict),
  ).length;
  const sentinels =
    result.cases.every(
      (c) =>
        c.id !== "mandatory-license" ||
        (c.beforeVerdict === "PASS" &&
          c.afterVerdict === "PASS" &&
          c.beforeViability === "BLOCKED" &&
          c.afterViability === "BLOCKED"),
    ) &&
    result.cases.every(
      (c) =>
        c.id !== "growth-leadership" ||
        (["PURSUE", "CONSIDER"].includes(c.beforeVerdict) &&
          ["PURSUE", "CONSIDER"].includes(c.afterVerdict) &&
          c.beforeViability === "PLAUSIBLE" &&
          c.afterViability === "PLAUSIBLE"),
    );
  result.safeToPublish =
    sentinels &&
    result.version === INTELLIGENCE_SHADOW_VERSION &&
    result.cases.length === expectedIds.length &&
    expectedIds.length > 0 &&
    new Set(expectedIds).size === expectedIds.length &&
    expectedIds.every((id) => result.cases.filter((c) => c.id === id).length === 1) &&
    result.invalidOutputs === 0 &&
    result.passToAdmitted === 0 &&
    result.cases.every(
      (c) =>
        [c.beforeVerdict, c.afterVerdict].every((v) =>
          ["PASS", "CONSIDER", "PURSUE"].includes(v),
        ) &&
        [c.beforeViability, c.afterViability].every((v) => ["BLOCKED", "PLAUSIBLE"].includes(v)) &&
        [c.beforeAdmission, c.afterAdmission].every((v) =>
          ["CANDIDATE:ELIGIBLE", "CANDIDATE:REVIEW", "NOT_CANDIDATE:INELIGIBLE"].includes(v),
        ) &&
        !(c.beforeViability === "BLOCKED" && c.afterViability !== "BLOCKED"),
    );
  return result;
}
export class IntelligenceShadowWorker {
  constructor(
    private db: DatabaseAdapter,
    private runCases?: (
      row: IntelligenceShadowRow,
      cases: ShadowCase[],
    ) => Promise<IntelligenceShadowResult>,
  ) {}
  async assertCurrent(db: DatabaseAdapter, row: IntelligenceShadowRow, token: string) {
    await requirePlatformRole(db, row.created_by, true);
    assertBenchEnvironment(row.environment_json);
    const active = await activeSearchTaxonomy(db),
      draft = await db.one<{ revision_id: string }>(
        "SELECT revision_id FROM taxonomy_drafts WHERE id=1",
      );
    if (
      active.id !== row.active_revision_id ||
      draft?.revision_id !== row.revision_id ||
      (await activeRevision(db, JSON.parse(row.scope_json).tenantId)).id !== row.config_revision_id
    )
      throw new Error("INTELLIGENCE_SHADOW_STALE");
    if (
      !(await db.one(
        "SELECT id FROM intelligence_taxonomy_shadows WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
        [row.id, token, Date.now()],
      ))
    )
      throw new Error("INTELLIGENCE_SHADOW_LEASE_LOST");
  }
  async pollOnce() {
    if (
      !(await this.db.one(
        "SELECT name FROM sqlite_master WHERE name='intelligence_taxonomy_shadows'",
      ))
    )
      return null;
    const token = randomUUID(),
      row = await this.db.transaction(async (tx) => {
        await tx.execute(
          "UPDATE intelligence_taxonomy_shadows SET status='failed',error='LEASE_EXPIRED; explicit retry required',completed_at=? WHERE status='running' AND lease_until<=?",
          [Date.now(), Date.now()],
        );
        const next = await tx.one<IntelligenceShadowRow>(
          "SELECT * FROM intelligence_taxonomy_shadows WHERE status='queued' ORDER BY created_at,id LIMIT 1",
        );
        if (!next) return null;
        try {
          await requirePlatformRole(tx, next.created_by, true);
          assertBenchEnvironment(next.environment_json);
        } catch {
          await tx.execute(
            "UPDATE intelligence_taxonomy_shadows SET status='failed',error='OPERATOR_OR_ENVIRONMENT_INVALID',completed_at=? WHERE id=?",
            [Date.now(), next.id],
          );
          return null;
        }
        const claimed = await tx.execute(
          "UPDATE intelligence_taxonomy_shadows SET status='running',lease_token=?,lease_until=?,worker_environment_json=? WHERE id=? AND status='queued'",
          [token, Date.now() + 120000, JSON.stringify(workerEnvironment()), next.id],
        );
        const tenantId = JSON.parse(next.scope_json).tenantId;
        return claimed.rowsAffected
          ? { ...next, scope: tenantId ? `tenant:${tenantId}` : "platform" }
          : null;
      });
    if (!row) return null;
    const timer = setInterval(() => {
      void this.db
        .execute(
          "UPDATE intelligence_taxonomy_shadows SET lease_until=? WHERE id=? AND lease_token=? AND status='running' AND lease_until>?",
          [Date.now() + 120000, row.id, token, Date.now()],
        )
        .catch(() => {});
    }, 30000);
    try {
      await this.db.transaction((tx) => this.assertCurrent(tx, row, token));
      const scope = JSON.parse(row.scope_json),
        cases = await intelligenceShadowCases(this.db, scope.tenantId, scope.limit);
      if (intelligenceCohortHash(cases) !== row.cohort_hash)
        throw new Error("INTELLIGENCE_SHADOW_COHORT_CHANGED");
      const result = this.runCases
        ? await this.runCases(row, cases)
        : await this.execute(row, token, cases);
      const invalid = await this.db.one<{ n: number }>(
        "SELECT COUNT(*) n FROM model_invocations WHERE taxonomy_shadow_run_id=? AND status='invalid_output'",
        [row.id],
      );
      result.invalidOutputs += Number(invalid?.n ?? 0);
      assessIntelligenceShadow(
        result,
        cases.map((c) => c.id),
      );
      await this.db.transaction(async (tx) => {
        await this.assertCurrent(tx, row, token);
        if (
          intelligenceCohortHash(await intelligenceShadowCases(tx, scope.tenantId, scope.limit)) !==
          row.cohort_hash
        )
          throw new Error("INTELLIGENCE_SHADOW_COHORT_CHANGED");
        await tx.execute(
          "UPDATE intelligence_taxonomy_shadows SET status=?,result_json=?,error=?,completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running'",
          [
            result.safeToPublish ? "passed" : "failed",
            JSON.stringify(result),
            result.safeToPublish
              ? null
              : "SHADOW_POLICY_REJECTED; inspect case diagnostics and repairs",
            Date.now(),
            row.id,
            token,
          ],
        );
      });
      return { id: row.id, status: result.safeToPublish ? "passed" : "failed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const providerFailure = await this.db.one<{ n: number }>(
        "SELECT COUNT(*) n FROM model_invocations WHERE taxonomy_shadow_run_id=? AND error_code='BENCH_PROVIDER_FAILURE'",
        [row.id],
      );
      const code = message.includes("BENCH_TOKEN_CAP_OR_LEASE_LOST")
        ? "BENCH_TOKEN_CAP_OR_LEASE_LOST"
        : Number(providerFailure?.n ?? 0) > 0
          ? "BENCH_PROVIDER_FAILURE; retry creates a new bounded comparison"
          : /^(INTELLIGENCE_SHADOW_[A-Z_]+|BENCH_[A-Z_]+|STAGED_INPUT_[A-Z_]+|CANONICAL_JD_HASH_MISMATCH)$/.test(
                message,
              )
            ? message
            : "SHADOW_VALIDATION_OR_PROVIDER_FAILURE; inspect BENCH telemetry";
      await this.db.execute(
        "UPDATE intelligence_taxonomy_shadows SET status='failed',error=?,completed_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running'",
        [code, Date.now(), row.id, token],
      );
      return { id: row.id, status: "failed" };
    } finally {
      clearInterval(timer);
    }
  }
  private model(
    row: IntelligenceShadowRow,
    token: string,
    config: EngineConfig,
    side: string,
  ): ReasoningModel {
    const lane = "reasoning" as const,
      review = false;
    const sink: ModelInvocationSink = async (event) => {
      await this.db.execute(
        `INSERT INTO model_invocations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,request_fingerprint,started_at,completed_at,input_tokens,output_tokens,total_tokens,reasoning_tokens,status,purpose,taxonomy_shadow_run_id,max_output_tokens,latency_ms,finish_reason,error_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'BENCH',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,total_tokens=excluded.total_tokens,reasoning_tokens=excluded.reasoning_tokens,status=excluded.status,latency_ms=excluded.latency_ms,finish_reason=excluded.finish_reason,error_code=excluded.error_code`,
        [
          event.invocationId,
          row.scope === "platform" ? "platform-bench" : row.scope.slice(7),
          "synthetic-fixture",
          `bench:${row.id}`,
          "fixture",
          side === "active" ? row.active_revision_id : row.revision_id,
          "evaluation",
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
        "reasoning",
        () => createBedrockGlmResearchModel({ invocationSink: sink }),
        sink,
        "taxonomy-shadow",
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
      discardResponse: model.discardResponse?.bind(model),
      configurationFingerprint: `${model.configurationFingerprint}:${row.id}:${side}:${review}`,
      generate: async (instruction, input, schema, metadata) => {
        const maxOutput = benchOutputAllowance(model, config[lane], metadata, review);
        const reserve =
          Buffer.byteLength(JSON.stringify({ instruction, input, schema }), "utf8") +
          2048 +
          maxOutput;
        await this.db.transaction(async (tx) => {
          await requirePlatformRole(tx, row.created_by, true);
          await this.assertCurrent(tx, row, token);
          const result = await tx.execute(
            "UPDATE intelligence_taxonomy_shadows SET tokens_reserved=tokens_reserved+? WHERE id=? AND lease_token=? AND status='running' AND lease_until>? AND tokens_reserved+?<=token_cap",
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
  private async execute(
    row: IntelligenceShadowRow,
    token: string,
    cases: ShadowCase[],
  ): Promise<IntelligenceShadowResult> {
    const active = await revision(this.db, row.active_revision_id),
      draft = await revision(this.db, row.revision_id),
      config = (await configRevision(this.db, row.config_revision_id)).config;
    const result: IntelligenceShadowResult = {
      version: INTELLIGENCE_SHADOW_VERSION,
      safeToPublish: false,
      cases: [],
      admissionsChanged: 0,
      verdictsChanged: 0,
      passToPursue: 0,
      invalidOutputs: 0,
      repairs: 0,
    };
    for (const specimen of cases) {
      const beforePin = active.definition.intelligence
          ? pinIntelligence(active.id, active.definition.intelligence)
          : undefined,
        afterPin = draft.definition.intelligence
          ? pinIntelligence(draft.id, draft.definition.intelligence)
          : undefined;
      const beforeInput = { ...specimen.frozen, intelligenceTaxonomy: beforePin },
        afterInput = { ...specimen.frozen, intelligenceTaxonomy: afterPin };
      beforeInput.fingerprint = contextInputFingerprint(beforeInput);
      afterInput.fingerprint = contextInputFingerprint(afterInput);
      const observer = (stage: string, event?: { kind?: string }) => {
        if (event?.kind === "repair") {
          result.repairs++;
          result.repairStages = [...new Set([...(result.repairStages ?? []), stage])];
        }
      };
      const before = await runStagedFrozenDecisionDetailed(
          beforeInput,
          this.model(row, token, config, "active"),
          observer,
        ),
        after = await runStagedFrozenDecisionDetailed(
          afterInput,
          this.model(row, token, config, "draft"),
          observer,
        );
      const oldAdmission = evaluateAttentionGate(specimen.version, {
          ...specimen.criteria,
          customParameters: {
            ...specimen.criteria.customParameters,
            intelligenceTaxonomy: beforePin,
          },
        }),
        newAdmission = evaluateAttentionGate(specimen.version, {
          ...specimen.criteria,
          customParameters: {
            ...specimen.criteria.customParameters,
            intelligenceTaxonomy: afterPin,
          },
        });
      result.cases.push({
        id: specimen.id,
        beforeAdmission: `${oldAdmission.decision}:${oldAdmission.eligibility}`,
        afterAdmission: `${newAdmission.decision}:${newAdmission.eligibility}`,
        beforeVerdict: before.decision.verdict,
        afterVerdict: after.decision.verdict,
        beforeViability: before.decision.screeningViability,
        afterViability: after.decision.screeningViability,
        beforeDiagnostics: {
          requirements: before.trace.requirements,
          eligibleScreeningDrivers: before.trace.eligibleScreeningDrivers,
          screeningConstraint: before.trace.screeningConstraint,
        },
        afterDiagnostics: {
          requirements: after.trace.requirements,
          eligibleScreeningDrivers: after.trace.eligibleScreeningDrivers,
          screeningConstraint: after.trace.screeningConstraint,
        },
      });
    }
    return result;
  }
}
