/**
 * src/pursuit/preparation.ts
 *
 * Durable Pursuit preparation. The web request only records the commitment
 * (pursuit + queued job); this runs in RADAR's worker runtime under a lease,
 * so a 2-minute model call never holds a user request open and a crashed
 * worker's job is reclaimed when its lease expires.
 *
 * Boundary: like server.ts, this file touches RADAR services (opportunity
 * read model, canonical lineage tables). Everything it orchestrates is portable.
 */

import { getDatabaseAdapter } from "../data/database";
import { OpportunityService } from "@/opportunity/service";
import { createSqliteModelInvocationSink } from "../lib/model/model-invocation";
import { generateArtifactSet } from "./artifacts";
import { PursuitTokenLedger, type PursuitModelContext } from "./budget";
import { projectLedger } from "./ledger";
import { toRoleBrief, type RoleBrief } from "./role-brief";
import { STARTER_ARCHETYPES } from "./seed";
import * as store from "./store";
import { deriveDeterministicThesis, enrichThesis } from "./thesis";
import { classifyClaim } from "./semantic/engine";
import type { CandidateArchetype, PursuitLineage } from "./types";
import { pursuitProfileVersion } from "./lineage";

export async function loadBrief(userId: string, scope: store.Scope, jobHash: string): Promise<RoleBrief> {
  const details = await OpportunityService.getDetailsForUser(
    userId,
    jobHash,
    undefined,
    scope.tenantId,
    scope.personId,
  );
  if (!details.opportunity) throw new Error("OPPORTUNITY_NOT_FOUND");
  return toRoleBrief(details.opportunity);
}

/**
 * Resolves the canonical identity of the evaluation the brief came from:
 * canonical job, opportunity version and the evaluation context's profile
 * version. Read-only, indexed lookups on the staged evaluation tables.
 */
export async function resolveLineage(scope: store.Scope, brief: RoleBrief): Promise<PursuitLineage> {
  const db = getDatabaseAdapter();
  const contextFp = brief.lineage?.evaluationContextFingerprint ?? null;
  const evaluation = await db.one<{
    canonical_job_id: string;
    opportunity_version: string;
    evaluation_context_fingerprint: string;
    profile_version: string;
  }>(
    // The served jobHash is the canonical opportunity's source job id.
    `SELECT se.canonical_job_id, se.opportunity_version, se.evaluation_context_fingerprint, se.profile_version
     FROM staged_evaluations se
     JOIN canonical_opportunities co ON co.id = se.canonical_job_id
     WHERE se.tenant_id = ? AND se.person_id = ? AND (co.source_job_id = ? OR se.job_hash = ?)
       ${contextFp ? "AND se.evaluation_context_fingerprint = ?" : ""}
       ${brief.lineage?.opportunityVersion ? "AND se.opportunity_version = ?" : ""}
     ORDER BY se.evaluated_at DESC LIMIT 1`,
    [
      scope.tenantId,
      scope.personId,
      brief.jobHash,
      brief.jobHash,
      ...(contextFp ? [contextFp] : []),
      ...(brief.lineage?.opportunityVersion ? [brief.lineage.opportunityVersion] : []),
    ],
  ).catch(() => null);
  return {
    canonicalJobId: evaluation?.canonical_job_id ?? null,
    opportunityVersion: evaluation?.opportunity_version ?? brief.lineage?.opportunityVersion ?? null,
    evaluationContextFingerprint: evaluation?.evaluation_context_fingerprint ?? contextFp,
    evaluationFingerprint: brief.lineage?.evaluationFingerprint ?? null,
    profileVersion: evaluation?.profile_version ?? null,
  };
}

export async function ensureArchetypes(scope: store.Scope): Promise<CandidateArchetype[]> {
  const existing = await store.listArchetypes(scope);
  if (existing.length > 0) return existing;
  for (const archetype of STARTER_ARCHETYPES) await store.saveArchetype(scope, archetype);
  return store.listArchetypes(scope);
}

export async function candidateIdentity(scope: store.Scope) {
  const row = await getDatabaseAdapter().one<{ name: string | null; email: string | null }>(
    "SELECT name, email FROM people WHERE tenant_id = ? AND id = ?",
    [scope.tenantId, scope.personId],
  );
  return { fullName: row?.name?.trim() || "Candidate", contactLine: row?.email?.trim() || "" };
}

/** The full derivation, executed by the worker for one claimed job. */
export async function preparePursuit(job: store.PreparationJob): Promise<void> {
  const scope: store.Scope = { tenantId: job.tenantId, personId: job.personId };
  const pursuit = await store.getPursuit(scope, job.jobHash);
  if (!pursuit || pursuit.id !== job.pursuitId) throw new Error("PURSUIT_NOT_FOUND");
  await store.updatePursuit(scope, pursuit.id, { preparationState: "DERIVING", preparationError: null });

  const brief = await loadBrief(job.requestedBy, scope, job.jobHash);
  const currentLineage = await resolveLineage(scope, brief);
  const activeThesis = pursuit.activeThesisId ? await store.getThesis(pursuit.activeThesisId) : null;
  const profileVersion = pursuitProfileVersion(pursuit, activeThesis);
  const lineage = { ...currentLineage, ...pursuit.lineage, profileVersion };
  // Ledger is projected from the exact profile version the evaluation used.
  const ledger = await projectLedger(scope, { profileVersion });
  await store.backfillClaimClassifications(scope, classifyClaim).catch(() => 0);
  const [claims, archetypes, style, identity] = await Promise.all([
    store.listClaimsForProfile(scope, profileVersion),
    ensureArchetypes(scope),
    store.loadStyleProfile(scope),
    candidateIdentity(scope),
  ]);
  const sourceDocumentIds = [
    ...new Set(claims.map((claim) => claim.sourceDocumentId).filter((id): id is string => Boolean(id))),
  ];
  const sourceTextByDocument = await store.loadSourceDocumentTexts(scope, sourceDocumentIds);

  const deterministic = deriveDeterministicThesis({
    brief,
    claims,
    archetypes,
    style,
    preferredArchetypeId: job.preferredArchetypeId ?? pursuit.activeArchetypeId,
    seed: pursuit.id,
  });
  const archetype = archetypes.find((a) => a.id === deterministic.archetypeId) ?? null;

  // One token ledger and one telemetry sink for the whole package, so pursuit
  // cost is visible alongside the other model lanes and is capped per pursuit.
  const model: PursuitModelContext = {
    ledger: new PursuitTokenLedger(),
    invocationSink: createSqliteModelInvocationSink(getDatabaseAdapter(), {
      pipeline: "pursuit",
      tenantId: scope.tenantId,
      personId: scope.personId,
      canonicalJobId: lineage.canonicalJobId ?? job.jobHash,
      opportunityVersion: lineage.opportunityVersion ?? "unknown",
      evaluationContextFingerprint: lineage.evaluationContextFingerprint ?? "unbound",
      pursuitId: pursuit.id,
      pursuitPreparationJobId: job.id,
    }),
  };

  // Stage checkpoints: a retried job reuses every stage already paid for.
  // The persisted thesis row is checkpointed too, so a retry never inserts a
  // second strategy version for the same job.
  type InsertedThesis = Awaited<ReturnType<typeof store.insertThesis>>;
  let thesis = (await store.readCheckpoint(job, "thesis_row")) as InsertedThesis | null;
  if (!thesis) {
    let enriched = (await store.readCheckpoint(job, "thesis_enriched")) as typeof deterministic | null;
    if (!enriched) {
      enriched = await enrichThesis(deterministic, { brief, claims, archetype, style, model });
      await store.writeCheckpoint(job, "thesis_enriched", enriched);
    }
    thesis = await store.insertThesis(pursuit.id, {
      ...enriched,
      lineage: {
        ...lineage,
        profileVersion: ledger.profileVersion ?? lineage.profileVersion,
        ledgerBindingFingerprint: ledger.fingerprint,
        anchorDocumentId: archetype?.anchorDocumentIds[0] ?? null,
      },
    }, job);
  }

  type Generated = Awaited<ReturnType<typeof generateArtifactSet>>;
  let generated = (await store.readCheckpoint(job, "artifacts_generated")) as Generated | null;
  if (!generated) {
    generated = await generateArtifactSet({
      identity,
      thesis,
      brief,
      claims,
      archetype,
      style,
      model,
      sourceTextByDocument,
    });
    await store.writeCheckpoint(job, "artifacts_generated", generated);
  }
  const spend = model.ledger?.snapshot();
  await store.publishPreparation(job, thesis, generated,
      `Pursuit strategy v${thesis.version} derived (${thesis.derivation.toLowerCase()}) with ${generated.length} artifacts` +
      (spend
        ? ` — ${spend.calls} model call${spend.calls === 1 ? "" : "s"}, ${spend.inputTokens} in / ${spend.outputTokens} out tokens${spend.exhausted ? " (token budget reached; remaining sections derived deterministically)" : ""}.`
        : "."));
  if (job.preferredArchetypeId && job.preferredArchetypeId !== deterministic.archetypeId) {
    await store.recordLearningSignals(scope, { pursuitId: pursuit.id }, [
      {
        signalType: "ARCHETYPE_OVERRIDDEN",
        subject: job.jobHash,
        originalValue: deterministic.archetypeScores[0]?.archetypeId ?? null,
        newValue: job.preferredArchetypeId,
      },
    ]);
  }
}

/** One poll: claim, run, fence-complete. Returns null when idle. */
export class PursuitPreparationWorker {
  constructor(
    private readonly workerId: string,
    private readonly leaseMs = 5 * 60_000,
  ) {}

  async pollOnce(): Promise<{
    jobId: string;
    status: "completed" | "retry" | "failed" | "lease_lost";
  } | null> {
    const job = await store.claimPreparation(this.workerId, this.leaseMs);
    if (!job) return null;
    const scope: store.Scope = { tenantId: job.tenantId, personId: job.personId };

    // A model-backed derivation can outlive a fixed lease. Renewing while the
    // work runs stops a second worker from claiming the same job and paying for
    // the same model calls twice.
    let leaseLost = false;
    const renew = setInterval(() => {
      void store
        .heartbeatPreparation(job, this.leaseMs)
        .then((held) => {
          if (!held) leaseLost = true;
        })
        .catch(() => undefined);
    }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
    if (typeof renew.unref === "function") renew.unref();

    try {
      await preparePursuit(job);
      if (leaseLost) {
        // Another worker owns this job now; do not write a completion that
        // would contradict the current owner.
        return { jobId: job.id, status: "lease_lost" };
      }
      return { jobId: job.id, status: "completed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preparation failed";
      if (leaseLost || message === "LEASE_LOST") return { jobId: job.id, status: "lease_lost" };
      const permanent = /NOT_FOUND|SCOPE/.test(message);
      const retry = !permanent && job.attempts < job.maxAttempts;
      const fenced = await store.finishPreparation(job, { ok: false, error: message, retry });
      if (!fenced) return { jobId: job.id, status: "lease_lost" };
      await store.updatePursuit(scope, job.pursuitId, {
        preparationState: retry ? "QUEUED" : "FAILED",
        preparationError: retry ? null : message,
      });
      return { jobId: job.id, status: retry ? "retry" : "failed" };
    } finally {
      clearInterval(renew);
    }
  }
}
