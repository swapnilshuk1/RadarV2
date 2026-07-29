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
import type { EvidenceGraph } from "../../../domain/evidence";

export type PipelineStage =
  | "DOCUMENT_UPLOADED"
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
  documentText: string;
}

export class ProjectionPipeline {
  private repos = getRepositories();
  private extractor = new EvidenceExtractionService();
  private builder = new CandidateProjectionBuilderImpl();

  public async run(input: PipelineExecutionInput, startStage: PipelineStage = "DOCUMENT_UPLOADED"): Promise<{
    success: boolean;
    stage: PipelineStage;
    error?: string;
  }> {
    const { documentId, personId, filename, storageUri, mimeType, documentHash, documentText } = input;
    let currentStage: PipelineStage = startStage;

    try {
      // 1. DOCUMENT_UPLOADED
      if (currentStage === "DOCUMENT_UPLOADED") {
        const docRecord: CandidateDocumentRecord = {
          id: documentId,
          personId,
          filename,
          storageUri,
          mimeType,
          documentHash,
          status: "PROCESSING",
          stage: "DOCUMENT_UPLOADED",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await this.repos.documents.saveDocument(docRecord);
        currentStage = "EVIDENCE_EXTRACTED";
      }

      // 2. EVIDENCE_EXTRACTED
      let evidenceGraph: EvidenceGraph | undefined;
      if (currentStage === "EVIDENCE_EXTRACTED") {
        await this.repos.documents.updateDocumentStage(documentId, "EVIDENCE_EXTRACTED", "PROCESSING");
        evidenceGraph = await this.extractor.extract({
          personId,
          documentId,
          documentHash,
          documentText
        });
        await this.repos.documents.saveEvidenceGraph(evidenceGraph);
        currentStage = "NORMALIZED";
      } else {
        evidenceGraph = await this.repos.documents.getEvidenceGraphForDocument(documentId);
      }

      if (!evidenceGraph) {
        throw new Error(`EvidenceGraph missing for document ${documentId}`);
      }

      // 3. NORMALIZED
      let normalizedGraph = evidenceGraph;
      if (currentStage === "NORMALIZED") {
        await this.repos.documents.updateDocumentStage(documentId, "NORMALIZED", "PROCESSING");
        normalizedGraph = EvidenceNormalizer.normalize(evidenceGraph);
        currentStage = "ONTOLOGY_RESOLVED";
      }

      // 4. ONTOLOGY_RESOLVED
      let resolvedOntology;
      if (currentStage === "ONTOLOGY_RESOLVED") {
        await this.repos.documents.updateDocumentStage(documentId, "ONTOLOGY_RESOLVED", "PROCESSING");
        resolvedOntology = OntologyResolver.resolve(normalizedGraph);
        currentStage = "PROJECTION_BUILT";
      } else {
        resolvedOntology = OntologyResolver.resolve(normalizedGraph);
      }

      // 5. PROJECTION_BUILT
      let baseProjection;
      if (currentStage === "PROJECTION_BUILT") {
        await this.repos.documents.updateDocumentStage(documentId, "PROJECTION_BUILT", "PROCESSING");
        baseProjection = this.builder.fromEvidence(normalizedGraph, resolvedOntology);
        currentStage = "INFERENCE_COMPLETE";
      } else {
        baseProjection = this.builder.fromEvidence(normalizedGraph, resolvedOntology);
      }

      // 6. INFERENCE_COMPLETE
      let finalProjection = baseProjection;
      if (currentStage === "INFERENCE_COMPLETE") {
        await this.repos.documents.updateDocumentStage(documentId, "INFERENCE_COMPLETE", "PROCESSING");
        finalProjection = OperatingLevelEngine.evaluate(baseProjection, documentText);
        await this.repos.people.saveProjection(personId, finalProjection);
        currentStage = "EVALUATED";
      }

      // 7. EVALUATED
      if (currentStage === "EVALUATED") {
        await this.repos.documents.updateDocumentStage(documentId, "EVALUATED", "PROCESSING");
        // Trigger recommendation re-evaluation for user
        await OpportunityService.listForUser(personId);
        currentStage = "COMPLETED";
      }

      // 8. COMPLETED
      await this.repos.documents.updateDocumentStage(documentId, "COMPLETED", "COMPLETED");

      return {
        success: true,
        stage: "COMPLETED"
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
