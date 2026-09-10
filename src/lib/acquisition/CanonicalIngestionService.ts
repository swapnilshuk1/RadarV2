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

import crypto from "crypto";
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
import { classifyOpportunityCategories } from "@/lib/domain/category_taxonomy";
import { parseVerifiedIndeedListingUrl } from "./indeed-listing-identity";

export interface IngestOpportunityPayload {
  sourcePortal: string;
  sourceJobId: string;
  canonicalUrl: string;
  jobTitle: string;
  /** Title read from the captured detail page, if the extractor could establish one. */
  documentTitle?: string | null;
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
  enrichmentDispatch?: EnrichmentDispatchPayload;
}

export interface EnrichmentDispatchPayload {
  detailedCard?: any;
  pipelineVersion: string;
  runId?: string;
  executionPlanId?: string;
  definitionId?: string;
  familyId?: string;
  portal?: string;
  page?: number;
  catalogVersion?: string;
  plannerVersion?: string;
  ruleVersion?: string;
  searchQuery?: string;
  businessPriority?: number;
  executionPriority?: number;
  snapshotPath?: string;
}

export type IngestScope =
  | { mode: "GLOBAL_MARKET"; runId?: string }
  | {
      mode: "SCOPED";
      tenantId: string;
      personId: string;
      searchPlanId: string;
      runId: string;
    };

export interface CanonicalIngestionOptions {
  runId?: string;
  scope: IngestScope;
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
  enrichmentJobId?: string | null;
  isNewEnrichmentJob?: boolean;
  versionCreatedAt?: string;
}

export class InvalidCanonicalUrlError extends Error {
  constructor(sourcePortal: string, sourceJobId: string) {
    super(`Cannot ingest ${sourcePortal}:${sourceJobId} without a captured external posting URL.`);
    this.name = "InvalidCanonicalUrlError";
  }
}

export class UnresolvedExternalListingIdentityError extends Error {
  constructor(sourcePortal: string, sourceJobId: string, url: string) {
    super(`Cannot canonically ingest ${sourcePortal}:${sourceJobId} without a verified external listing identity (${url}).`);
  }
}

/**
 * A canonical opportunity may only represent a captured job document, or a
 * PDF payload that is explicitly pending extraction.  Failed transport and
 * non-job responses remain acquisition-lineage evidence only.
 */
export class UnusableAcquisitionDocumentError extends Error {
  constructor(sourcePortal: string, sourceJobId: string, failureClass: string | null) {
    super(`Cannot canonically ingest unusable document ${sourcePortal}:${sourceJobId} (${failureClass || "unknown"}).`);
  }
}

export { computeContentHash, computeCanonicalJobId, computeOpportunityVersionId } from "@/lib/domain/canonical_identity";

export class AcquisitionIntegrityError extends Error {
  readonly failureKind: "INTEGRITY_FAILURE" = "INTEGRITY_FAILURE";
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AcquisitionIntegrityError";
  }
}

export class CanonicalIngestionService {
  private db: DatabaseAdapter;

  constructor(customAdapter?: DatabaseAdapter, private readonly blobStore?: BlobStore) {
    this.db = customAdapter || getDatabaseAdapter();
  }

  public async ingestOpportunity(
    payload: IngestOpportunityPayload,
    scopeOrOptions?: IngestScope | CanonicalIngestionOptions
  ): Promise<CanonicalIngestionResult> {
    const options: CanonicalIngestionOptions = (scopeOrOptions && "scope" in scopeOrOptions && (scopeOrOptions as any).scope)
      ? (scopeOrOptions as CanonicalIngestionOptions)
      : { runId: (scopeOrOptions as any)?.runId, scope: scopeOrOptions as IngestScope };

    if (!options.scope) {
      throw new AcquisitionIntegrityError("MISSING_SCOPE_REJECTED: Canonical ingestion requires an explicit IngestScope.");
    }

    if (options.scope.mode !== "GLOBAL_MARKET" && options.scope.mode !== "SCOPED") {
      throw new AcquisitionIntegrityError(
        `MALFORMED_SCOPE_REJECTED: Scope mode must be 'GLOBAL_MARKET' or 'SCOPED', received '${(options.scope as any).mode}'.`
      );
    }

    let effectiveScope: { mode: "GLOBAL_MARKET"; runId?: string } | { mode: "SCOPED"; tenantId: string; personId: string; searchPlanId: string; runId: string };

    if (options.scope.mode === "GLOBAL_MARKET") {
      if ((options.scope as any).tenantId || (options.scope as any).personId || (options.scope as any).searchPlanId) {
        throw new AcquisitionIntegrityError(
          "MALFORMED_SCOPE_REJECTED: GLOBAL_MARKET scope must not include tenantId, personId, or searchPlanId."
        );
      }
      effectiveScope = { mode: "GLOBAL_MARKET", runId: options.scope.runId || options.runId };
    } else if (options.scope.mode === "SCOPED") {
      const runId = options.scope.runId || options.runId;
      if (!options.scope.tenantId || !options.scope.personId || !options.scope.searchPlanId || !runId) {
        throw new AcquisitionIntegrityError(
          "MALFORMED_SCOPE_REJECTED (PARTIAL_SCOPE_REJECTED): SCOPED mode requires tenantId, personId, searchPlanId, and runId (runId is required)."
        );
      }
      effectiveScope = {
        mode: "SCOPED",
        tenantId: options.scope.tenantId,
        personId: options.scope.personId,
        searchPlanId: options.scope.searchPlanId,
        runId,
      };
    } else {
      throw new AcquisitionIntegrityError(
        `MALFORMED_SCOPE_REJECTED: Invalid scope mode '${(options.scope as any).mode}'.`
      );
    }

    const source = payload.sourcePortal.trim();
    let sourceJobId = payload.sourceJobId.trim();
    const title = payload.jobTitle.trim();
    const companyName = payload.companyName?.trim() || null;
    const location = payload.location || null;
    const employmentType = payload.employmentType || null;
    const postedAt = payload.postedAt || null;
    const rawContent = payload.rawContent.trim();
    let canonicalUrl = payload.canonicalUrl.trim();
    if (source.toLowerCase() === "indeed") {
      const identity = parseVerifiedIndeedListingUrl(canonicalUrl) || (payload.finalUrl ? parseVerifiedIndeedListingUrl(payload.finalUrl) : null);
      if (!identity) throw new UnresolvedExternalListingIdentityError(source, sourceJobId, canonicalUrl);
      sourceJobId = identity.sourceJobId;
      canonicalUrl = identity.canonicalUrl;
    }
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
      documentTitle: payload.documentTitle || undefined,
      expectedTitle: title,
      extractedCompany: companyName || undefined,
      extractedLocation: location || undefined,
      contentOrigin: payload.contentOrigin,
      provenance: "BLOB",
    });
    const document = documentValidation.document;
    if (document.usabilityState === "UNUSABLE" && document.failureClass !== "UNEXTRACTED_PDF") {
      throw new UnusableAcquisitionDocumentError(source, sourceJobId, document.failureClass);
    }
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

    const isUsableDocument = document.usabilityState !== "UNUSABLE";
    if (isUsableDocument && !isPdfPayload) {
      if (!payload.enrichmentDispatch?.detailedCard) {
        throw new AcquisitionIntegrityError("MISSING_ENRICHMENT_PAYLOAD: Usable canonical opportunity requires an enrichment detailedCard.");
      }
      if (!payload.enrichmentDispatch?.pipelineVersion) {
        throw new AcquisitionIntegrityError("MISSING_PIPELINE_VERSION: Usable canonical opportunity requires an explicit enrichment pipelineVersion.");
      }

      const snapshot: any = JSON.parse(
        JSON.stringify(payload.enrichmentDispatch.detailedCard)
      );

      const canonicalMaterial = {
        title: snapshot.canonicalMaterial?.title ?? snapshot.title ?? snapshot.jobTitle ?? "",
        companyName: snapshot.canonicalMaterial?.companyName ?? snapshot.canonicalMaterial?.company ?? snapshot.companyName ?? snapshot.company ?? null,
        location: snapshot.canonicalMaterial?.location ?? snapshot.location ?? null,
        employmentType: snapshot.canonicalMaterial?.employmentType ?? snapshot.employmentType ?? null,
        rawContent: snapshot.canonicalMaterial?.rawContent ?? snapshot.detail?.rawText ?? snapshot.rawText ?? "",
      };
      snapshot.canonicalMaterial = canonicalMaterial;

      const computedSnapshotHash = computeContentHash(snapshot.canonicalMaterial);
      if (computedSnapshotHash !== contentHash) {
        throw new AcquisitionIntegrityError(
          `CANONICAL_ENRICHMENT_PAYLOAD_MISMATCH: Snapshot material content hash (${computedSnapshotHash}) does not match canonical document hash (${contentHash})`
        );
      }

      if (snapshot.evaluationEvidence?.contentHash && snapshot.evaluationEvidence.contentHash !== contentHash) {
        throw new AcquisitionIntegrityError(
          `IMMUTABLE_ENRICHMENT_PAYLOAD_CONFLICT: detailedCard.evaluationEvidence.contentHash (${snapshot.evaluationEvidence.contentHash}) does not match computed content hash (${contentHash})`
        );
      }

      // Ensure the snapshot payload is explicitly bound to the authoritative canonical material
      if (snapshot.detail) {
        snapshot.detail.rawText = rawContent;
      }
      snapshot.title = title;
      if (companyName) snapshot.company = companyName;
      if (location) snapshot.location = location;
      if (employmentType) snapshot.employmentType = employmentType;
      snapshot.canonicalJobId = canonicalJobId;
      snapshot.opportunityVersion = versionId;
      const enrichmentPayloadKey = `acquisition/${canonicalJobId}/${versionId}/snapshot.json`;
      snapshot.evaluationEvidence = {
        canonicalJobId,
        opportunityVersion: versionId,
        contentHash,
        sourcePayloadKey: enrichmentPayloadKey,
        sourceMediaType: "application/json",
      };

      // Fail-safe sequencing: BlobStore write occurs BEFORE the DB transaction.
      // If BlobStore write fails, nothing durable is admitted in the database.
      // Immutable payload protection: verify existing snapshot content identity; fail closed on conflict.
      const store = this.blobStore || getBlobStore();
      try {
        const exists = await store.exists(enrichmentPayloadKey);
        if (exists) {
          const existingBytes = await store.get(enrichmentPayloadKey);
          if (!existingBytes) {
            throw new AcquisitionIntegrityError(`Existing snapshot payload key '${enrichmentPayloadKey}' exists but returned null content`);
          }
          let parsed: any;
          try {
            parsed = JSON.parse(existingBytes.toString("utf-8"));
          } catch (e: any) {
            throw new AcquisitionIntegrityError(`Existing BlobStore payload at ${enrichmentPayloadKey} is not valid JSON`);
          }
          if (!parsed.canonicalMaterial) {
            throw new AcquisitionIntegrityError(
              `IMMUTABLE_ENRICHMENT_PAYLOAD_CONFLICT: Existing BlobStore payload at ${enrichmentPayloadKey} lacks required canonicalMaterial`
            );
          }
          const existingMaterialHash = computeContentHash(parsed.canonicalMaterial);
          if (existingMaterialHash !== contentHash) {
            throw new AcquisitionIntegrityError(
              `IMMUTABLE_ENRICHMENT_PAYLOAD_CONFLICT: Existing BlobStore payload at ${enrichmentPayloadKey} canonicalMaterial hash (${existingMaterialHash}) does not match incoming content hash (${contentHash})`
            );
          }
          // Matching => reuse, never overwrite!
        } else {
          await store.put(
            enrichmentPayloadKey,
            JSON.stringify(snapshot),
            "application/json"
          );
        }
      } catch (err) {
        if (err instanceof AcquisitionIntegrityError) throw err;
        throw new AcquisitionIntegrityError(
          `Failed to write immutable enrichment snapshot to BlobStore for ${canonicalJobId}/${versionId}: ${(err as Error).message}`,
          err
        );
      }
    }
    // This key is an explicit persisted provenance field, not an implicit
    // lookup convention. A caller may provide its own key, but the persisted
    // value is always the key returned by BlobStore.
    if (isPdfPayload) {
      const sourcePayload = payload.sourcePayload ?? rawContent;
      if (!sourcePayload) {
        throw new AcquisitionIntegrityError(`PDF acquisition ${source}:${sourceJobId} is missing its source payload.`);
      }
      const requestedKey = payload.sourcePayloadKey || `opportunity-versions/${versionId}/source`;
      try {
        sourcePayloadKey = await (this.blobStore || getBlobStore()).put(
          requestedKey,
          sourcePayload,
          payload.contentType || "application/pdf",
        );
        sourceMediaType = payload.contentType || "application/pdf";
      } catch (err) {
        throw new AcquisitionIntegrityError(
          `Failed to write source payload to BlobStore for ${canonicalJobId}/${versionId}: ${(err as Error).message}`,
          err
        );
      }
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

    let activePlans: Array<{
      id: string;
      tenant_id: string;
      person_id: string;
      criteria_json: string | null;
    }> = [];
    let effectiveVersionCreatedAt: string = versionRecord.createdAt;

    // 3. Perform the core canonical persistence envelope. Evaluation-job enqueueing is
    // deliberately outside this transaction: a transient queue/database HTTP
    // failure must not close the transaction after canonical data is written.
    const candidateDecisions: Record<string, "CANDIDATE" | "NOT_CANDIDATE"> = {};
    const candidateEligibility: Record<string, "ELIGIBLE" | "REVIEW" | "INELIGIBLE"> = {};
    let candidatesProjected = 0;
    let jobsEnqueued = 0;
    let isNewOpportunity = false;
    let isNewVersion = false;
    let effectiveVersionId = versionId;
    let enrichmentJobId: string | null = null;
    let isNewEnrichmentJob = false;
    const categoryIds = JSON.stringify(classifyOpportunityCategories({
      role: title,
      description: rawContentForStorage,
    }));



      try {
        if (effectiveScope.mode === "GLOBAL_MARKET") {
          activePlans = [];
        } else {
          activePlans = await this.db.many<{
            id: string;
            tenant_id: string;
            person_id: string;
            criteria_json: string | null;
          }>(
            `SELECT sp.id, sp.tenant_id, sp.person_id, sp.criteria_json 
             FROM search_plans sp
             JOIN people p ON sp.person_id = p.id AND sp.tenant_id = p.tenant_id
             JOIN tenants t ON sp.tenant_id = t.id
             WHERE sp.status = 'active' AND sp.tenant_id = ? AND sp.person_id = ? AND sp.id = ?`,
            [effectiveScope.tenantId, effectiveScope.personId, effectiveScope.searchPlanId]
          );
          if (activePlans.length === 0) {
            throw new AcquisitionIntegrityError(
              `SCOPED_PLAN_NOT_ACTIVE: Search plan ${effectiveScope.searchPlanId} is not active for person ${effectiveScope.personId}`
            );
          }
        }

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
           category_ids,
           acquisition_status, acquisition_quality, failure_class, lifecycle_state, evidence_state,
           source_payload_key, source_media_type, document_extraction_state,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
          categoryIds,
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

      // 3.2.1 Resolve Authoritative Version ID & persisted creation timestamp:
      // Whether newly inserted or pre-existing from an earlier run, fetch the canonical ID that exists in the database
      const existingVersion = await tx.one<{ id: string; created_at: string }>(
        `SELECT id, created_at FROM opportunity_versions WHERE canonical_job_id = ? AND content_hash = ?`,
        [canonicalJobId, contentHash]
      );
      effectiveVersionId = existingVersion?.id || versionId;
      effectiveVersionCreatedAt = existingVersion?.created_at || versionRecord.createdAt;

      // 3.2.2 Derive single trusted verifiedRunId for all canonical run references
      let verifiedRunId: string | null = null;
      if (effectiveScope.mode === "SCOPED" && effectiveScope.runId) {
        const runRow = await tx.one<{ id: string; status: string }>(
          `SELECT id, status FROM scrape_runs
           WHERE id = ? AND tenant_id = ? AND person_id = ? AND search_plan_id = ?`,
          [effectiveScope.runId, effectiveScope.tenantId, effectiveScope.personId, effectiveScope.searchPlanId]
        );
        if (!runRow) {
          throw new AcquisitionIntegrityError(
            `RUN_SCOPE_MISMATCH: Scrape run '${effectiveScope.runId}' does not belong to scope (${effectiveScope.tenantId}, ${effectiveScope.personId}, ${effectiveScope.searchPlanId})`
          );
        }
        if (runRow.status !== "running") {
          throw new AcquisitionIntegrityError(
            `RUN_NOT_RUNNING_REJECTED: Scrape run '${effectiveScope.runId}' is in status '${runRow.status}', but canonical admission status must be 'running'.`
          );
        }
        verifiedRunId = runRow.id;
      }

      enrichmentJobId = null;
      isNewEnrichmentJob = false;
      let enrichmentJobStatus: string | null = null;

      if (payload.enrichmentDispatch) {
        const pipelineVersion = payload.enrichmentDispatch.pipelineVersion;
        const payloadKey = `acquisition/${canonicalJobId}/${effectiveVersionId}/snapshot.json`;

        const existingJob = await tx.one<{ id: string; status: string }>(
          `SELECT id, status FROM enrichment_jobs 
           WHERE canonical_job_id = ? AND opportunity_version = ? AND pipeline_version = ? 
           LIMIT 1`,
          [canonicalJobId, effectiveVersionId, pipelineVersion]
        );

        if (existingJob) {
          enrichmentJobId = existingJob.id;
          enrichmentJobStatus = existingJob.status;
          // Note: historical run_id on existingJob is preserved; never overwritten on global or different run reuse
        } else {
          const newJobId = `enrich_${crypto.createHash("sha256").update(`${canonicalJobId}:${effectiveVersionId}:${pipelineVersion}`).digest("hex").slice(0, 24)}`;
          enrichmentJobId = newJobId;
          enrichmentJobStatus = "PENDING";
          isNewEnrichmentJob = true;

          await tx.execute(
            `INSERT INTO enrichment_jobs (
               id, job_hash, canonical_job_id, opportunity_version, pipeline_version, snapshot_path, payload_key,
               run_id, execution_plan_id, definition_id, family_id, portal, page,
               catalog_version, planner_version, rule_version, search_query,
               status, business_priority, execution_priority, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(canonical_job_id, opportunity_version, pipeline_version) WHERE canonical_job_id IS NOT NULL DO NOTHING`,
            [
              newJobId,
              payload.enrichmentDispatch.detailedCard?.cardHash || `${canonicalJobId}:${effectiveVersionId}`,
              canonicalJobId,
              effectiveVersionId,
              pipelineVersion,
              payload.enrichmentDispatch.snapshotPath || "",
              payloadKey,
              verifiedRunId,
              payload.enrichmentDispatch.executionPlanId || null,
              payload.enrichmentDispatch.definitionId || null,
              payload.enrichmentDispatch.familyId || null,
              payload.enrichmentDispatch.portal || source,
              payload.enrichmentDispatch.page || null,
              payload.enrichmentDispatch.catalogVersion || null,
              payload.enrichmentDispatch.plannerVersion || null,
              payload.enrichmentDispatch.ruleVersion || null,
              payload.enrichmentDispatch.searchQuery || null,
              payload.enrichmentDispatch.businessPriority ?? 10,
              payload.enrichmentDispatch.executionPriority ?? 0,
            ]
          );
        }

        if (verifiedRunId && enrichmentJobId) {
          await tx.execute(
            `INSERT OR IGNORE INTO scrape_run_enrichment_requirements (run_id, enrichment_job_id)
             VALUES (?, ?)`,
            [verifiedRunId, enrichmentJobId]
          );
        }
      }

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

        // Persist evaluation obligations atomically with candidate projection.
        // Invariant: Every Attention-Gate CANDIDATE creates a durable evaluation obligation.
        // Candidate and requirement commit together or roll back together.
        if (gateResult.decision === "CANDIDATE") {
          const evalContext = await tx.one<{ context_fingerprint: string }>(
            `SELECT aec.context_fingerprint
             FROM active_evaluation_contexts aec
             JOIN evaluation_contexts ec ON ec.context_fingerprint = aec.context_fingerprint
               AND ec.tenant_id = aec.tenant_id AND ec.person_id = aec.person_id
             WHERE aec.search_plan_id = ? AND aec.tenant_id = ? AND aec.person_id = ?
             LIMIT 1`,
            [plan.id, plan.tenant_id, plan.person_id]
          );

          if (!evalContext?.context_fingerprint) {
            throw new AcquisitionIntegrityError(
              `MISSING_EVALUATION_CONTEXT: candidate ${canonicalJobId}/${effectiveVersionId} ` +
              `for plan ${plan.id} cannot create durable evaluation obligation`
            );
          }

          const reqId = `evalreq_${crypto.createHash("sha256").update(`${plan.tenant_id}:${plan.person_id}:${plan.id}:${canonicalJobId}:${effectiveVersionId}:${evalContext.context_fingerprint}`).digest("hex").slice(0, 16)}`;
          const pipelineVersion = payload.enrichmentDispatch?.pipelineVersion || "1.0.0";
          const initialReqStatus = (enrichmentJobStatus === "COMPLETE") ? "READY" : "WAITING_ENRICHMENT";

          await tx.execute(
            `INSERT INTO evaluation_requirements (
               id, tenant_id, person_id, search_plan_id, canonical_job_id,
               opportunity_version, required_enrichment_pipeline_version,
               evaluation_context_fingerprint, status, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
             DO UPDATE SET status = CASE 
               WHEN evaluation_requirements.status = 'SATISFIED' THEN 'SATISFIED'
               WHEN ? = 'READY' AND evaluation_requirements.status = 'WAITING_ENRICHMENT' THEN 'READY'
               ELSE evaluation_requirements.status 
             END`,
            [
              reqId,
              plan.tenant_id,
              plan.person_id,
              plan.id,
              canonicalJobId,
              effectiveVersionId,
              pipelineVersion,
              evalContext.context_fingerprint,
              initialReqStatus,
              initialReqStatus,
            ]
          );

          if (verifiedRunId) {
            await tx.execute(
              `INSERT INTO scrape_run_evaluation_requirements (run_id, evaluation_requirement_id)
               VALUES (?, ?)
               ON CONFLICT(run_id, evaluation_requirement_id) DO NOTHING`,
              [verifiedRunId, reqId]
            );
          }
          jobsEnqueued++;
        }
      }
    });
    } catch (err) {
      // Invariant: Do NOT delete the shared BlobStore payload on database failure.
      // In a distributed environment with concurrent admissions of the same canonical/version,
      // deleting the shared blob upon one node's DB failure risks destroying a payload
      // successfully referenced by another node's committed job.
      // An orphan blob is harmless; deleting a blob referenced by another transaction is catastrophic.
      // Bounded orphan-storage leak is accepted until decoupled listing/indexing sweep runs.
      if (err instanceof AcquisitionIntegrityError) {
        throw err;
      }
      throw new AcquisitionIntegrityError(
        `Canonical ingestion failed for ${canonicalJobId}/${versionId}: ${(err as Error).message}`,
        err
      );
    }

    return {
      canonicalJobId,
      opportunityVersion: effectiveVersionId,
      versionCreatedAt: effectiveVersionCreatedAt,
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
      enrichmentJobId,
      isNewEnrichmentJob,
    };
  }
}
