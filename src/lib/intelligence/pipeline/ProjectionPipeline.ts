/**
 * ProjectionPipeline.ts
 *
 * Resumable stage-based orchestrator for parsing candidate documents into CandidateProjections.
 * Stage Lifecycle:
 * DOCUMENT_UPLOADED -> EVIDENCE_EXTRACTED -> NORMALIZED -> ONTOLOGY_RESOLVED -> PROJECTION_BUILT -> INFERENCE_COMPLETE -> EVALUATED -> COMPLETED
 */

import { getRepositories } from "../../../data/sqlite/provider";
import type { CandidateDocumentRecord } from "../../../data/sqlite/repositories/SqliteDocumentStore";
import { EvidenceExtractionService } from "../extraction/EvidenceExtractionService";
import { EvidenceNormalizer } from "../extraction/EvidenceNormalizer";
import { OntologyResolver } from "../extraction/OntologyResolver";
import { CandidateProjectionBuilderImpl } from "../builders/CandidateProjectionBuilder";
import { OperatingLevelEngine } from "../engines/OperatingLevelEngine";
import { OpportunityService } from "../opportunity-service";
import { EvaluationCoordinator } from "../EvaluationCoordinator";
import type { EvidenceGraph } from "../../../domain/evidence";

import { parseDocumentText } from "../extraction/text-parser";

export type PipelineStage =
  | "DOCUMENT_REGISTERED"
  | "TEXT_EXTRACTED"
  | "EVIDENCE_EXTRACTED"
  | "NORMALIZED"
  | "ONTOLOGY_RESOLVED"
  | "PROJECTION_BUILT"
  | "INFERENCE_COMPLETE"
  | "EVALUATED"
  | "COMPLETED";

export interface PipelineExecutionInput {
  documentId: string;
  personId: string;
  filename: string;
  storageUri: string;
  mimeType: string;
  documentHash: string;
  documentText?: string;
  fileBuffer?: Buffer;
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
  private repos = getRepositories();
  private extractor = new EvidenceExtractionService();
  private builder = new CandidateProjectionBuilderImpl();

  public async run(input: PipelineExecutionInput, startStage: PipelineStage = "DOCUMENT_REGISTERED"): Promise<{
    success: boolean;
    stage: PipelineStage;
    error?: string;
    deduplicated?: boolean;
  }> {
    const { documentId, personId, filename, storageUri, mimeType, documentHash } = input;
    let currentStage: PipelineStage = startStage;
    let isDeduplicated = false;

    try {
      // 1. DOCUMENT_REGISTERED
      if (currentStage === "DOCUMENT_REGISTERED") {
        const docRecord: CandidateDocumentRecord = {
          id: documentId,
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
        await this.repos.documents.saveDocument(docRecord);
        currentStage = "TEXT_EXTRACTED";
      }

      // 2. TEXT_EXTRACTED
      let rawText = input.documentText || "";
      let textHash = "";

      if (currentStage === "TEXT_EXTRACTED") {
        await this.repos.documents.updateDocumentStage(documentId, "TEXT_EXTRACTED", "PROCESSING");
        if (input.fileBuffer) {
          const parsed = await parseDocumentText(input.fileBuffer, mimeType);
          rawText = parsed.rawText;
          textHash = parsed.textHash;
        } else {
          const parsed = await parseDocumentText(Buffer.from(rawText, "utf-8"), "text/plain");
          textHash = parsed.textHash;
        }
        await this.repos.documents.saveDocumentContent(documentId, rawText, textHash);
        currentStage = "EVIDENCE_EXTRACTED";
      } else {
        const content = await this.repos.documents.getDocumentContent(documentId);
        if (content) {
          rawText = content.rawText;
          textHash = content.textHash;
        }
      }

      // 3. EVIDENCE_EXTRACTED (with text_hash deduplication)
      let evidenceGraph: EvidenceGraph | undefined;
      if (currentStage === "EVIDENCE_EXTRACTED") {
        await this.repos.documents.updateDocumentStage(documentId, "EVIDENCE_EXTRACTED", "PROCESSING");

        // Content can be reused only inside the same candidate identity. A hash
        // proves identical text, never shared ownership or provenance.
        if (textHash) {
          const existingGraph = await this.repos.documents.findExistingEvidenceGraphByTextHash(textHash);
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

        await this.repos.documents.saveEvidenceGraph(evidenceGraph);
        currentStage = "NORMALIZED";
      } else {
        evidenceGraph = await this.repos.documents.getEvidenceGraphForDocument(documentId);
      }

      if (!evidenceGraph) {
        throw new Error(`EvidenceGraph missing for document ${documentId}`);
      }

      // 4. NORMALIZED
      let normalizedGraph = evidenceGraph;
      if (currentStage === "NORMALIZED") {
        await this.repos.documents.updateDocumentStage(documentId, "NORMALIZED", "PROCESSING");
        normalizedGraph = EvidenceNormalizer.normalize(evidenceGraph);
        currentStage = "ONTOLOGY_RESOLVED";
      }

      // 5. ONTOLOGY_RESOLVED
      let resolvedOntology;
      if (currentStage === "ONTOLOGY_RESOLVED") {
        await this.repos.documents.updateDocumentStage(documentId, "ONTOLOGY_RESOLVED", "PROCESSING");
        resolvedOntology = OntologyResolver.resolve(normalizedGraph);
        currentStage = "PROJECTION_BUILT";
      } else {
        resolvedOntology = OntologyResolver.resolve(normalizedGraph);
      }

      // 6. PROJECTION_BUILT
      let baseProjection;
      if (currentStage === "PROJECTION_BUILT") {
        await this.repos.documents.updateDocumentStage(documentId, "PROJECTION_BUILT", "PROCESSING");
        baseProjection = this.builder.fromEvidence(normalizedGraph, resolvedOntology);
        currentStage = "INFERENCE_COMPLETE";
      } else {
        baseProjection = this.builder.fromEvidence(normalizedGraph, resolvedOntology);
      }

      // 7. INFERENCE_COMPLETE
      let finalProjection = baseProjection;
      if (currentStage === "INFERENCE_COMPLETE") {
        await this.repos.documents.updateDocumentStage(documentId, "INFERENCE_COMPLETE", "PROCESSING");
        finalProjection = OperatingLevelEngine.evaluate(baseProjection, rawText);
        await this.repos.people.saveProjection(personId, finalProjection);
        currentStage = "EVALUATED";
      }

      // 8. EVALUATED
      if (currentStage === "EVALUATED") {
        await this.repos.documents.updateDocumentStage(documentId, "EVALUATED", "PROCESSING");
        // Trigger evaluation refresh via EvaluationCoordinator
        await EvaluationCoordinator.notify({ event: "PROJECTION_UPDATED", personId });
        currentStage = "COMPLETED";
      }

      // 9. COMPLETED
      await this.repos.documents.updateDocumentStage(documentId, "COMPLETED", "COMPLETED");

      return {
        success: true,
        stage: "COMPLETED",
        deduplicated: isDeduplicated
      };
    } catch (err: any) {
      console.error(`[ProjectionPipeline] Failed at stage ${currentStage}:`, err.message);
      await this.repos.documents.updateDocumentStage(documentId, currentStage, "FAILED", err.message);
      return {
        success: false,
        stage: currentStage,
        error: err.message
      };
    }
  }
}
