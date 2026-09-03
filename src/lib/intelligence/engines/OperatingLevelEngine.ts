/**
 * OperatingLevelEngine.ts
 *
 * Dedicated inference engine that calculates candidate operating level, work nature, and strategic capacity
 * from assembled projections or evidence. Keeps builders purely as data assemblers.
 */

import type { CandidateProjection } from "../../domain/candidate_projection";
import { OperatingLevelClassifier } from "../classifiers/OperatingLevelClassifier";
import { WorkNatureClassifier } from "../classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../classifiers/CommercialScopeClassifier";
import { CommercialScope, DecisionAuthority, OperatingLevel, WorkNature } from "../../domain/semantic";
import type { DualConfidence } from "../../ontology/certification/OntologyContracts";

export class OperatingLevelEngine {
  /**
   * Evaluates and enriches a CandidateProjection with OperatingLevel, DualConfidence & Structured WorkNature.
   */
  public static evaluate(projection: CandidateProjection, textContext?: string): CandidateProjection {
    const text = textContext || [projection.attainedTitle, ...(projection.executiveThemes || []), ...(projection.coreCapabilities || [])]
      .filter((value): value is string => Boolean(value && value !== "Unknown"))
      .join("\n");
    const title = projection.attainedTitle || "Unknown";

    if (!text) {
      const unknown = { evidenceIds: [], confidence: 0 };
      return {
        ...projection,
        operatingLevel: { ...unknown, value: "UNKNOWN" as OperatingLevel },
        workNature: { ...unknown, value: "UNKNOWN" as WorkNature },
        decisionAuthority: { ...unknown, value: "UNKNOWN" as DecisionAuthority },
        commercialScope: { ...unknown, value: "UNKNOWN" as CommercialScope },
      };
    }

    const opRaw = OperatingLevelClassifier.classify(text, title);
    const workNature = WorkNatureClassifier.classify(text, title);
    const structuredWorkNature = WorkNatureClassifier.classifyStructured(text, title);
    const decisionAuthority = DecisionAuthorityClassifier.classify(text, title);
    const commercialScope = CommercialScopeClassifier.classify(text, title);

    const dualConfidence: DualConfidence = {
      evidenceConfidence: 0.95, // Fact extraction certainty
      inferenceConfidence: opRaw.confidence || 0.85 // Derived altitude inference certainty
    };

    const operatingLevel = {
      value: (opRaw.value || "UNKNOWN") as OperatingLevel,
      evidenceIds: opRaw.evidenceIds,
      confidence: dualConfidence.inferenceConfidence
    };

    return {
      ...projection,
      operatingLevel,
      workNature,
      decisionAuthority,
      commercialScope,
      ...(structuredWorkNature as any)
    };
  }
}
