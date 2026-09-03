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
 * 4. Enqueues evaluation jobs for CANDIDATE matches (evaluation_jobs) after
 *    the canonical write transaction has committed
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
import { validateJobDocument } from "./validator";
import { getBlobStore, type BlobStore } from "@/lib/storage/blob-store";
import { JobProjectionBuilder } from "@/lib/intelligence/builders/JobProjectionBuilder";

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
  /** Identifies a title/company fallback so it cannot masquerade as a captured JD. */
  contentOrigin?: "DETAIL_DOCUMENT" | "DISCOVERY_CARD_FALLBACK";
  /** Transport observations are evidence only; canonical validation remains authoritative. */
  httpStatus?: number;
  contentType?: string | null;
  finalUrl?: string;
  /** Original binary payload is retained out-of-row; rawContent remains extracted JD text only. */
  sourcePayload?: Uint8Array | string;
  sourcePayloadKey?: string;
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
  contentHash: string;
  sourcePayloadKey: string | null;
  sourceMediaType: string | null;
  isNewOpportunity: boolean;
  isNewVersion: boolean;
  plansEvaluated: number;
  candidatesProjected: number;
  candidateDecisions: Record<string, "CANDIDATE" | "NOT_CANDIDATE">;
  candidateEligibility: Record<string, "ELIGIBLE" | "REVIEW" | "INELIGIBLE">;
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

  constructor(customAdapter?: DatabaseAdapter, private readonly blobStore?: BlobStore) {
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

    const documentValidation = validateJobDocument({
      extractedText: rawContent,
      url: canonicalUrl,
      finalUrl: payload.finalUrl,
      sourcePortal: source,
      sourceJobId,
      httpStatus: payload.httpStatus,
      contentType: payload.contentType,
      extractedTitle: title,
      extractedCompany: companyName || undefined,
      extractedLocation: location || undefined,
      contentOrigin: payload.contentOrigin,
      provenance: "BLOB",
    });
    const document = documentValidation.document;
    // Eligibility consumes the normalized projection when the acquisition is a
    // substantive validated document. It never derives rules from query text.
    const jobProjection = document.usabilityState === "SUBSTANTIVE"
      ? JobProjectionBuilder.buildFromValidatedDocument(document)
      : undefined;
    const descLen = document.substantiveCharacterCount;
    // The caller may describe transport, but cannot promote a non-JD response.
    const acquisitionQuality: AcquisitionQuality = document.acquisitionQuality;
    const acquisitionStatus: AcquisitionStatus = document.usabilityState === "UNUSABLE"
      ? document.retryable ? "RECOVERY_PENDING" : "CAPTURE_FAILED"
      : document.usabilityState === "GENUINELY_SPARSE" ? "ACQUIRED" : "ACQUIRED";
    const lifecycleState: LifecycleState = payload.lifecycleState || "ACTIVE";
    const evidenceState: EvidenceState = document.usabilityState === "GENUINELY_SPARSE"
      ? "GENUINELY_SPARSE"
      : document.usabilityState === "SUBSTANTIVE" ? "SUFFICIENT" : "UNVERIFIED";
    const failureClass = document.failureClass;

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
    const isPdfPayload = document.failureClass === "UNEXTRACTED_PDF";
    let sourcePayloadKey: string | null = null;
    let sourceMediaType: string | null = null;
    // This key is an explicit persisted provenance field, not an implicit
    // lookup convention. A caller may provide its own key, but the persisted
    // value is always the key returned by BlobStore.
    if (isPdfPayload) {
      const sourcePayload = payload.sourcePayload ?? rawContent;
      if (!sourcePayload) {
        throw new Error(`PDF acquisition ${source}:${sourceJobId} is missing its source payload.`);
      }
      const requestedKey = payload.sourcePayloadKey || `opportunity-versions/${versionId}/source`;
      sourcePayloadKey = await (this.blobStore || getBlobStore()).put(
        requestedKey,
        sourcePayload,
        payload.contentType || "application/pdf",
      );
      sourceMediaType = payload.contentType || "application/pdf";
    }
    // PDF bytes may exist only in BlobStore; raw_content is reserved for
    // extracted readable job text and therefore remains empty pending parsing.
    const rawContentForStorage = isPdfPayload ? "" : rawContent;

    const versionRecord: OpportunityVersion = {
      id: versionId,
      canonicalJobId,
      contentHash,
      jobTitle: title,
      companyName,
      location,
      employmentType,
      rawContent: rawContentForStorage,
      acquisitionStatus,
      acquisitionQuality,
      failureClass,
      lifecycleState,
      evidenceState,
      sourcePayloadKey,
      sourceMediaType,
      documentExtractionState: document.extractionState,
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

    // 3. Perform the core canonical transaction. Evaluation-job enqueueing is
    // deliberately outside this transaction: a transient queue/database HTTP
    // failure must not close the transaction after canonical data is written.
    const candidateDecisions: Record<string, "CANDIDATE" | "NOT_CANDIDATE"> = {};
    const candidateEligibility: Record<string, "ELIGIBLE" | "REVIEW" | "INELIGIBLE"> = {};
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
           source_payload_key, source_media_type, document_extraction_state,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
          rawContentForStorage,
          acquisitionStatus,
          acquisitionQuality,
          failureClass,
          lifecycleState,
          evidenceState,
          sourcePayloadKey,
          sourceMediaType,
          document.extractionState,
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
      if (document.retryable && document.usabilityState === "UNUSABLE") {
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

        // A failed/redirected/binary response is acquisition evidence, never a
        // candidate or an evaluation input. A genuinely sparse JD is retained
        // and can later materialize as SPARSE_SPEC.
        if (document.usabilityState === "UNUSABLE") {
          candidateDecisions[plan.id] = "NOT_CANDIDATE";
          candidateEligibility[plan.id] = "INELIGIBLE";
          continue;
        }

        // Attention Gate: pure deterministic evaluation
        const gateResult = evaluateAttentionGate(versionRecord, criteria, jobProjection);
        candidateDecisions[plan.id] = gateResult.decision;
        candidateEligibility[plan.id] = gateResult.eligibility;

        // Upsert SearchPlanCandidate with authoritative effectiveVersionId
        await tx.execute(
          `INSERT INTO search_plan_candidates (
             tenant_id, person_id, search_plan_id, canonical_job_id,
             opportunity_version, attention_decision, eligibility,
             eligibility_reason_codes_json, location_policy, location_evidence, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
           DO UPDATE SET
             attention_decision = excluded.attention_decision,
             eligibility = excluded.eligibility,
             eligibility_reason_codes_json = excluded.eligibility_reason_codes_json,
             location_policy = excluded.location_policy,
             location_evidence = excluded.location_evidence`,
          [
            plan.tenant_id,
            plan.person_id,
            plan.id,
            canonicalJobId,
            effectiveVersionId,
            gateResult.decision,
            gateResult.eligibility,
            JSON.stringify(gateResult.reasonCodes),
            gateResult.locationPolicy ?? null,
            gateResult.locationEvidence ?? null,
          ]
        );
        candidatesProjected++;

      }
    });

    // Queue work only after the canonical transaction is durable. This keeps
    // a queue outage from poisoning the transaction and losing the discovered
    // opportunity. The unique key makes retries idempotent.
    for (const plan of activePlans) {
      if (candidateDecisions[plan.id] !== "CANDIDATE") continue;
      try {
        const evalContext = await this.db.one<{ context_fingerprint: string }>(
          `SELECT aec.context_fingerprint
           FROM active_evaluation_contexts aec
           JOIN evaluation_contexts ec ON ec.context_fingerprint = aec.context_fingerprint
             AND ec.tenant_id = aec.tenant_id AND ec.person_id = aec.person_id
           WHERE aec.search_plan_id = ? AND aec.tenant_id = ? AND aec.person_id = ?
           LIMIT 1`,
          [plan.id, plan.tenant_id, plan.person_id]
        );
        if (!evalContext?.context_fingerprint) continue;

        const enqueueRes = await this.db.execute(
          `INSERT INTO evaluation_jobs (
             id, tenant_id, person_id, search_plan_id, canonical_job_id,
             opportunity_version, evaluation_context_fingerprint,
             status, attempts, max_attempts, next_attempt_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
           DO NOTHING`,
          [
            `job_${crypto.randomUUID()}`,
            plan.tenant_id,
            plan.person_id,
            plan.id,
            canonicalJobId,
            effectiveVersionId,
            evalContext.context_fingerprint,
          ]
        );
        if (enqueueRes.rowsAffected > 0) jobsEnqueued++;
      } catch (err: any) {
        // Canonical rows and candidate projections are already committed. A
        // later reconciliation pass can enqueue this idempotent job again.
        console.error("[CanonicalIngestionService] Evaluation enqueue deferred:", err.message);
      }
    }

    return {
      canonicalJobId,
      opportunityVersion: effectiveVersionId,
      contentHash,
      sourcePayloadKey,
      sourceMediaType,
      isNewOpportunity,
      isNewVersion,
      plansEvaluated: activePlans.length,
      candidatesProjected,
      candidateDecisions,
      candidateEligibility,
      jobsEnqueued,
    };
  }
}
