/**
 * src/lib/acquisition/CanonicalIngestionService.ts
 *
 * Phase M9: Canonical Acquisition & Projection Interceptor
 *
 * Ingests validated raw job opportunities from the scraper pipeline directly into
 * the canonical storage layer:
 * 1. Resolves canonical identity (canonical_opportunities)
 * 2. Computes material content version (opportunity_versions)
 * 3. Evaluates Attention Gate across active Search Plans (search_plan_candidates)
 * 4. Enqueues evaluation jobs for CANDIDATE matches (evaluation_jobs)
 *
 * INVARIANTS:
 * 1. Strict Idempotency: Duplicate calls on the same (source, source_job_id, content)
 *    produce zero duplicate rows and zero duplicate evaluation jobs.
 * 2. Tenant / Person Scoping: SearchPlanCandidate projections and EvaluationJobs
 *    are strictly bound to their respective (tenant_id, person_id, search_plan_id).
 * 3. Zero In-Memory Serving Fallback: Once materialized, canonical serving reads
 *    directly from Turso/SQLite without intermediate JSON files.
 */

import { DatabaseAdapter, getDatabaseAdapter } from "@/data/database";
import {
  computeCanonicalJobId,
  computeContentHash,
  computeOpportunityVersionId,
} from "@/lib/domain/canonical_identity";
import { evaluateAttentionGate } from "@/lib/intelligence/AttentionGate";
import type {
  OpportunityVersion,
  AcquisitionStatus,
  AcquisitionQuality,
  LifecycleState,
  EvidenceState,
} from "@/lib/domain/canonical_acquisition";
import type { SearchCriteriaPayload } from "@/lib/domain/evaluation_context";
import { isExternalPostingUrl } from "./external-posting-url";

export interface IngestOpportunityPayload {
  sourcePortal: string;
  sourceJobId: string;
  canonicalUrl: string;
  jobTitle: string;
  companyName: string | null;
  location: string | null;
  employmentType?: string | null;
  postedAt?: string | null;
  postedPrecision?: "EXACT" | "RELATIVE_ESTIMATE" | "LOWER_BOUND" | "UNKNOWN" | null;
  rawContent: string;
  acquisitionStatus?: AcquisitionStatus;
  acquisitionQuality?: AcquisitionQuality;
  failureClass?: string | null;
  lifecycleState?: LifecycleState;
  evidenceState?: EvidenceState;
}

export interface IngestScopeFilter {
  tenantId?: string;
  personId?: string;
}

export interface CanonicalIngestionResult {
  canonicalJobId: string;
  opportunityVersion: string;
  isNewOpportunity: boolean;
  isNewVersion: boolean;
  plansEvaluated: number;
  candidatesProjected: number;
  candidateDecisions: Record<string, "CANDIDATE" | "NOT_CANDIDATE">;
  jobsEnqueued: number;
}

export class InvalidCanonicalUrlError extends Error {
  constructor(sourcePortal: string, sourceJobId: string) {
    super(`Cannot ingest ${sourcePortal}:${sourceJobId} without a captured external posting URL.`);
    this.name = "InvalidCanonicalUrlError";
  }
}

export class CanonicalIngestionService {
  private db: DatabaseAdapter;

  constructor(customAdapter?: DatabaseAdapter) {
    this.db = customAdapter || getDatabaseAdapter();
  }

  public async ingestOpportunity(
    payload: IngestOpportunityPayload,
    scopeFilter?: IngestScopeFilter
  ): Promise<CanonicalIngestionResult> {
    const source = payload.sourcePortal.trim();
    const sourceJobId = payload.sourceJobId.trim();
    const title = payload.jobTitle.trim();
    const companyName = payload.companyName?.trim() || null;
    const location = payload.location || null;
    const employmentType = payload.employmentType || null;
    const postedAt = payload.postedAt || null;
    const rawContent = payload.rawContent.trim();
    const canonicalUrl = payload.canonicalUrl.trim();
    if (!isExternalPostingUrl(canonicalUrl)) {
      throw new InvalidCanonicalUrlError(source, sourceJobId);
    }

    const descLen = rawContent.length;
    const acquisitionQuality: AcquisitionQuality = payload.acquisitionQuality || (
      descLen >= 500 ? "COMPLETE" :
      descLen >= 200 ? "PARTIAL" :
      descLen > 0 ? "MINIMAL" :
      "INVALID"
    );
    const acquisitionStatus: AcquisitionStatus = payload.acquisitionStatus || (
      (acquisitionQuality === "COMPLETE" || acquisitionQuality === "PARTIAL") ? "ACQUIRED" :
      acquisitionQuality === "MINIMAL" ? "RECOVERY_PENDING" :
      "CAPTURE_FAILED"
    );
    const lifecycleState: LifecycleState = payload.lifecycleState || "ACTIVE";
    const evidenceState: EvidenceState = payload.evidenceState || "UNVERIFIED";
    const failureClass = payload.failureClass || (
      acquisitionQuality === "MINIMAL" ? "PARTIAL_CONTENT" :
      acquisitionQuality === "INVALID" ? "EMPTY_CONTENT" : null
    );

    // 1. Compute Deterministic Canonical Identities
    const canonicalJobId = computeCanonicalJobId({ source, sourceJobId });
    const contentHash = computeContentHash({
      title,
      companyName,
      location,
      employmentType,
      rawContent,
    });
    const versionId = computeOpportunityVersionId(canonicalJobId, contentHash);

    const versionRecord: OpportunityVersion = {
      id: versionId,
      canonicalJobId,
      contentHash,
      jobTitle: title,
      companyName,
      location,
      employmentType,
      rawContent,
      acquisitionStatus,
      acquisitionQuality,
      failureClass,
      lifecycleState,
      evidenceState,
      createdAt: new Date().toISOString(),
    };

    // 2. Fetch Active Search Plans (strictly joined to verified people & tenants to enforce referential integrity)
    let planQuery = `
      SELECT sp.id, sp.tenant_id, sp.person_id, sp.criteria_json 
      FROM search_plans sp
      JOIN people p ON sp.person_id = p.id AND sp.tenant_id = p.tenant_id
      JOIN tenants t ON sp.tenant_id = t.id
      WHERE sp.status = 'active'
    `;
    const planParams: unknown[] = [];

    if (scopeFilter?.tenantId) {
      planQuery += ` AND sp.tenant_id = ?`;
      planParams.push(scopeFilter.tenantId);
    }
    if (scopeFilter?.personId) {
      planQuery += ` AND sp.person_id = ?`;
      planParams.push(scopeFilter.personId);
    }

    const activePlans = await this.db.many<{
      id: string;
      tenant_id: string;
      person_id: string;
      criteria_json: string | null;
    }>(planQuery, planParams);

    // 3. Perform Atomic Transaction: Opportunities + Versions + SearchPlanCandidates + EvaluationJobs + RecoveryQueue
    const candidateDecisions: Record<string, "CANDIDATE" | "NOT_CANDIDATE"> = {};
    let candidatesProjected = 0;
    let jobsEnqueued = 0;
    let isNewOpportunity = false;
    let isNewVersion = false;
    let effectiveVersionId = versionId;

    await this.db.transaction(async (tx) => {
      // 3.0 Check if canonical opportunity already exists
      const existingOpp = await tx.one<{ id: string }>(
        `SELECT id FROM canonical_opportunities WHERE source = ? AND source_job_id = ?`,
        [source, sourceJobId]
      );
      isNewOpportunity = !existingOpp;

      // 3.1 Upsert Canonical Opportunity
      await tx.execute(
        `INSERT INTO canonical_opportunities (
           id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(source, source_job_id) DO UPDATE SET
           last_seen_at = CURRENT_TIMESTAMP`,
        [canonicalJobId, source, sourceJobId, canonicalUrl, companyName]
      );

      // 3.2 Insert Opportunity Version (idempotent ON CONFLICT DO NOTHING)
      const versionRes = await tx.execute(
        `INSERT INTO opportunity_versions (
           id, canonical_job_id, content_hash, job_title, company_name,
           location, employment_type, posted_at, posted_precision, raw_content,
           acquisition_status, acquisition_quality, failure_class, lifecycle_state, evidence_state,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(canonical_job_id, content_hash) DO NOTHING`,
        [
          versionId,
          canonicalJobId,
          contentHash,
          title,
          companyName,
          location,
          employmentType,
          postedAt,
          payload.postedPrecision || "UNKNOWN",
          rawContent,
          acquisitionStatus,
          acquisitionQuality,
          failureClass,
          lifecycleState,
          evidenceState,
        ]
      );
      isNewVersion = versionRes.rowsAffected > 0;

      // 3.2.1 Resolve Authoritative Version ID:
      // Whether newly inserted or pre-existing from an earlier run, fetch the canonical ID that exists in the database
      const existingVersion = await tx.one<{ id: string }>(
        `SELECT id FROM opportunity_versions WHERE canonical_job_id = ? AND content_hash = ?`,
        [canonicalJobId, contentHash]
      );
      effectiveVersionId = existingVersion?.id || versionId;

      // 3.3 Recovery Queue Enqueue if capture is MINIMAL / RECOVERY_PENDING
      if (acquisitionStatus === "RECOVERY_PENDING" || acquisitionQuality === "MINIMAL") {
        const recoveryId = `rec_${effectiveVersionId.slice(0, 16)}`;
        for (const plan of activePlans) {
          try {
            await tx.execute(
              `INSERT INTO recovery_queue (
                 id, tenant_id, canonical_job_id, opportunity_version_id, source, canonical_url,
                 reason, failure_class, attempt_count, status, next_attempt_at, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [
                recoveryId,
                plan.tenant_id,
                canonicalJobId,
                effectiveVersionId,
                source,
                canonicalUrl,
                `Sparse or incomplete content capture (${descLen} chars)`,
                failureClass || "PARTIAL_CONTENT",
              ]
            );
          } catch {
            // Handled if duplicate active recovery exists
          }
        }
      }

      // 3.4 Project Candidates & Enqueue Evaluation Jobs for each Active Search Plan
      for (const plan of activePlans) {
        let criteria: SearchCriteriaPayload = {
          targetSeniority: [],
          targetRoles: [],
          targetLocations: [],
        };

        if (plan.criteria_json) {
          try {
            criteria = typeof plan.criteria_json === "string"
              ? JSON.parse(plan.criteria_json)
              : plan.criteria_json;
          } catch {
            criteria = { targetSeniority: [], targetRoles: [], targetLocations: [] };
          }
        }

        // Attention Gate: pure deterministic evaluation
        const gateResult = evaluateAttentionGate(versionRecord, criteria);
        candidateDecisions[plan.id] = gateResult.decision;

        // Upsert SearchPlanCandidate with authoritative effectiveVersionId
        await tx.execute(
          `INSERT INTO search_plan_candidates (
             tenant_id, person_id, search_plan_id, canonical_job_id,
             opportunity_version, attention_decision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
           DO UPDATE SET attention_decision = excluded.attention_decision`,
          [
            plan.tenant_id,
            plan.person_id,
            plan.id,
            canonicalJobId,
            effectiveVersionId,
            gateResult.decision,
          ]
        );
        candidatesProjected++;

        // If CANDIDATE match, enqueue evaluation job if context exists
        if (gateResult.decision === "CANDIDATE") {
          try {
            // Resolve latest active evaluation context fingerprint for this tenant/person/plan
            const evalContext = await tx.one<{ context_fingerprint: string }>(
              `SELECT ec.context_fingerprint 
               FROM evaluation_contexts ec
               JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
               WHERE sps.search_plan_id = ? AND sps.tenant_id = ? AND sps.person_id = ?
               ORDER BY ec.created_at DESC, ec.rowid DESC LIMIT 1`,
              [plan.id, plan.tenant_id, plan.person_id]
            );

            if (evalContext?.context_fingerprint) {
              const fingerprint = evalContext.context_fingerprint;
              const jobId = `job_${crypto.randomUUID()}`;

              const enqueueRes = await tx.execute(
                `INSERT INTO evaluation_jobs (
                   id, tenant_id, person_id, search_plan_id, canonical_job_id,
                   opportunity_version, evaluation_context_fingerprint,
                   status, attempts, max_attempts, next_attempt_at, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
                 DO NOTHING`,
                [
                  jobId,
                  plan.tenant_id,
                  plan.person_id,
                  plan.id,
                  canonicalJobId,
                  effectiveVersionId,
                  fingerprint,
                ]
              );

              if (enqueueRes.rowsAffected > 0) {
                jobsEnqueued++;
              }
            }
          } catch (err: any) {
            console.error("[CanonicalIngestionService] Enqueue error:", err.message);
          }
        }
      }
    });

    return {
      canonicalJobId,
      opportunityVersion: effectiveVersionId,
      isNewOpportunity,
      isNewVersion,
      plansEvaluated: activePlans.length,
      candidatesProjected,
      candidateDecisions,
      jobsEnqueued,
    };
  }
}
