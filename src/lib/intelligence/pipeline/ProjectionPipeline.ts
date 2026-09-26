import type { JsonModel } from '../../model/json-model';
/**
 * ProjectionPipeline.ts
 *
 * Resumable stage-based orchestrator for parsing candidate documents into CandidateProjections.
 * Stage Lifecycle:
 * DOCUMENT_UPLOADED -> EVIDENCE_EXTRACTED -> NORMALIZED -> ONTOLOGY_RESOLVED -> PROJECTION_BUILT -> INFERENCE_COMPLETE -> (PROFILE_READY | EVALUATED) -> COMPLETED
 */

import { createRepositories, getRepositories } from "../../../data/sqlite/provider";
import { getDatabaseAdapter, type DatabaseAdapter } from "../../../data/database";
import { versionCandidateProjection } from "../../../data/sqlite/repositories/profile-projection-version";
import type { CandidateDocumentRecord } from "../../../data/sqlite/repositories/SqliteDocumentStore";
import { EvidenceExtractionService } from "../extraction/EvidenceExtractionService";
import { EvidenceNormalizer } from "../extraction/EvidenceNormalizer";
import { OntologyResolver } from "../extraction/OntologyResolver";
import { CandidateProjectionBuilderImpl } from "../builders/CandidateProjectionBuilder";
import { OperatingLevelEngine } from "../engines/OperatingLevelEngine";
import { OpportunityService } from "../opportunity-service";
import { EvaluationCoordinator } from "../EvaluationCoordinator";
import { activateSearchPlanForIntent } from "../search-plan-activation";
import { TenantScopedPersonStore } from "../../../data/sqlite/repositories/TenantScopedPersonStore";
import type { AuthorizedPersonScope } from "../../security/auth";
import type { EvidenceGraph } from "../../../domain/evidence";

import { parseDocumentText } from "../extraction/text-parser";
import { resolveProjectionCompletionStage } from "./projection-completion-state";

export type PipelineStage =
  | "DOCUMENT_REGISTERED"
  | "TEXT_EXTRACTED"
  | "EVIDENCE_EXTRACTED"
  | "NORMALIZED"
  | "ONTOLOGY_RESOLVED"
  | "PROJECTION_BUILT"
  | "INFERENCE_COMPLETE"
  | "PROFILE_READY"
  | "EVALUATED"
  | "COMPLETED";

export interface PipelineExecutionInput {
  scope: AuthorizedPersonScope;
  documentId: string;
  filename: string;
  storageUri: string;
  mimeType: string;
  documentHash: string;
  documentText?: string;
  fileBuffer?: Buffer;
  /** Serving-policy activation is a separate explicit lifecycle action. */
  activateServingPlan?: boolean;
  /** Reject heuristic extraction when establishing an authoritative source set. */
  requireModelBackedExtraction?: boolean;
}

export function reuseEvidenceGraphForOwner(
  existingGraph: EvidenceGraph | undefined,
  personId: string,
  documentId: string,
): EvidenceGraph | undefined {
  if (!existingGraph || existingGraph.personId !== personId) return undefined;
  return {
    ...existingGraph,
    id: `ev-graph-${documentId}-dedup`,
    personId,
    provenance: { ...existingGraph.provenance, documentId },
  };
}

export class ProjectionPipeline {
  private readonly db:DatabaseAdapter;
  private readonly repos:ReturnType<typeof getRepositories>;
  private readonly extractor:EvidenceExtractionService;
  constructor(options:{db?:DatabaseAdapter;model?:JsonModel}={}){
    this.db=options.db??getDatabaseAdapter();
    this.repos=options.db?createRepositories(options.db):getRepositories();
    this.extractor=new EvidenceExtractionService(options.model);
  }
  private builder = new CandidateProjectionBuilderImpl();

  public async run(input: PipelineExecutionInput, startStage: PipelineStage = "DOCUMENT_REGISTERED"): Promise<{
    success: boolean;
    stage: PipelineStage;
    error?: string;
    deduplicated?: boolean;
    intentRequired?: boolean;
  }> {
    const { documentId, scope, filename, storageUri, mimeType, documentHash } = input;
    const { personId } = scope;
    let currentStage: PipelineStage = startStage;
    let isDeduplicated = false;

    try {
      // 1. DOCUMENT_REGISTERED
      if (currentStage === "DOCUMENT_REGISTERED") {
        const docRecord: CandidateDocumentRecord = {
          id: documentId,
          tenantId: scope.tenantId,
          personId,
          filename,
          storageUri,
          mimeType,
          documentHash,
          status: "PROCESSING",
          stage: "DOCUMENT_REGISTERED",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await this.repos.documents.saveDocument(scope, docRecord);
        currentStage = "TEXT_EXTRACTED";
      }

      // 2. TEXT_EXTRACTED
      let rawText = input.documentText || "";
      let textHash = "";

      if (currentStage === "TEXT_EXTRACTED") {
        await this.repos.documents.updateDocumentStage(scope, documentId, "TEXT_EXTRACTED", "PROCESSING");
        if (input.fileBuffer) {
          const parsed = await parseDocumentText(input.fileBuffer, mimeType);
          rawText = parsed.rawText;
          textHash = parsed.textHash;
        } else {
          const parsed = await parseDocumentText(Buffer.from(rawText, "utf-8"), "text/plain");
          textHash = parsed.textHash;
        }
        await this.repos.documents.saveDocumentContent(scope, documentId, rawText, textHash);
        currentStage = "EVIDENCE_EXTRACTED";
      } else {
        const content = await this.repos.documents.getDocumentContent(scope, documentId);
        if (content) {
          rawText = content.rawText;
          textHash = content.textHash;
        }
      }

      // 3. EVIDENCE_EXTRACTED (with text_hash deduplication)
      let evidenceGraph: EvidenceGraph | undefined;
      if (currentStage === "EVIDENCE_EXTRACTED") {
        await this.repos.documents.updateDocumentStage(scope, documentId, "EVIDENCE_EXTRACTED", "PROCESSING");

        // Content can be reused only inside the same candidate identity. A hash
        // proves identical text, never shared ownership or provenance.
        if (textHash) {
          const existingGraph = await this.repos.documents.findExistingEvidenceGraphByTextHash(scope, textHash);
          const reusableGraph = reuseEvidenceGraphForOwner(existingGraph, personId, documentId);
          if (reusableGraph) {
            console.log(`[ProjectionPipeline] Instant deduplication match for textHash ${textHash.slice(0, 8)}...!`);
            evidenceGraph = reusableGraph;
            isDeduplicated = true;
          }
        }

        if (!evidenceGraph) {
          evidenceGraph = await this.extractor.extract({
            personId,
            documentId,
            documentHash: textHash || documentHash,
            documentText: rawText
          });
        }

        if (input.requireModelBackedExtraction && evidenceGraph.provenance.model === "heuristic") {
          throw new Error("AUTHORITATIVE_SOURCE_EXTRACTION_UNAVAILABLE");
        }

        await this.repos.documents.saveEvidenceGraph(scope, evidenceGraph);
        currentStage = "NORMALIZED";
      } else {
        evidenceGraph = await this.repos.documents.getEvidenceGraphForDocument(scope, documentId);
      }

      if (!evidenceGraph) {
        throw new Error(`EvidenceGraph missing for document ${documentId}`);
      }

      // 4. NORMALIZED
      let normalizedGraph = evidenceGraph;
      if (currentStage === "NORMALIZED") {
        await this.repos.documents.updateDocumentStage(scope, documentId, "NORMALIZED", "PROCESSING");
        normalizedGraph = EvidenceNormalizer.normalize(evidenceGraph);
        currentStage = "ONTOLOGY_RESOLVED";
      }

      // 5. ONTOLOGY_RESOLVED
      let resolvedOntology;
      if (currentStage === "ONTOLOGY_RESOLVED") {
        await this.repos.documents.updateDocumentStage(scope, documentId, "ONTOLOGY_RESOLVED", "PROCESSING");
        resolvedOntology = OntologyResolver.resolve(normalizedGraph);
        currentStage = "PROJECTION_BUILT";
      } else {
        resolvedOntology = OntologyResolver.resolve(normalizedGraph);
      }

      // 6. PROJECTION_BUILT
      let baseProjection;
      if (currentStage === "PROJECTION_BUILT") {
        await this.repos.documents.updateDocumentStage(scope, documentId, "PROJECTION_BUILT", "PROCESSING");
        baseProjection = this.builder.fromEvidence(normalizedGraph, resolvedOntology);
        currentStage = "INFERENCE_COMPLETE";
      } else {
        baseProjection = this.builder.fromEvidence(normalizedGraph, resolvedOntology);
      }

      // 7. INFERENCE_COMPLETE
      let finalProjection = baseProjection;
      if (currentStage === "INFERENCE_COMPLETE") {
        await this.repos.documents.updateDocumentStage(scope, documentId, "INFERENCE_COMPLETE", "PROCESSING");
        finalProjection = versionCandidateProjection(OperatingLevelEngine.evaluate(baseProjection, rawText));
        await new TenantScopedPersonStore(this.db, scope).saveProjection(personId, finalProjection);
        // A staged evaluation requires this exact profile-to-source binding; there is no latest-document fallback.
        await this.db.execute(
          `INSERT INTO profile_projection_source_bindings (tenant_id, person_id, profile_version, document_id, evidence_graph_id, document_text_hash)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(tenant_id, person_id, profile_version, document_id) DO NOTHING`,
          [scope.tenantId, personId, finalProjection.profileVersion, documentId, evidenceGraph.id, textHash || documentHash],
        );
        // A saved CV projection is a new immutable input. It must never switch
        // the serving evaluation policy implicitly; activation is an explicit
        // action after the caller has selected the policy/context lineage.
        if (!input.activateServingPlan) {
          await this.repos.documents.updateDocumentStage(scope, documentId, "PROFILE_READY", "COMPLETED");
          return { success: true, stage: "PROFILE_READY", deduplicated: isDeduplicated };
        }
        // Explicit legacy-serving activation remains available to the caller
        // that intentionally requests it.
        const intent = await this.repos.documents.getLatestCareerIntent(scope);
        if (!intent) {
          // A projection is usable profile processing, not a recommendation
          // refresh. No target intent means no canonical evaluation lineage.
          await this.repos.documents.updateDocumentStage(scope, documentId, "PROFILE_READY", "COMPLETED");
          return { success: true, stage: "PROFILE_READY", deduplicated: isDeduplicated, intentRequired: true };
        }
        const completionStage = resolveProjectionCompletionStage(true);
        await activateSearchPlanForIntent({
          ...intent,
          personId,
          preferredLocations: intent.preferredLocations || [],
          targetTitles: intent.targetTitles || [],
          scope,
          activatedBy: "projection-refresh",
        });
        currentStage = completionStage;
      }

      // 8. EVALUATED
      if (currentStage === "EVALUATED") {
        await this.repos.documents.updateDocumentStage(scope, documentId, "EVALUATED", "PROCESSING");
        // Trigger evaluation refresh via EvaluationCoordinator
        await EvaluationCoordinator.notify({ event: "PROJECTION_UPDATED", personId });
        currentStage = "COMPLETED";
      }

      // 9. COMPLETED
      await this.repos.documents.updateDocumentStage(scope, documentId, "COMPLETED", "COMPLETED");

      return {
        success: true,
        stage: "COMPLETED",
        deduplicated: isDeduplicated
      };
    } catch (err: any) {
      console.error(`[ProjectionPipeline] Failed at stage ${currentStage}:`, err.message);
      await this.repos.documents.updateDocumentStage(scope, documentId, currentStage, "FAILED", err.message);
      return {
        success: false,
        stage: currentStage,
        error: err.message
      };
    }
  }
}

