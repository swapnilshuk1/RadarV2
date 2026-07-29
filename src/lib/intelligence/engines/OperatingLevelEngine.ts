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
import { OperatingLevel } from "../../domain/semantic";

export class OperatingLevelEngine {
  /**
   * Evaluates and enriches a CandidateProjection with accurate OperatingLevel & WorkNature classifications.
   */
  public static evaluate(projection: CandidateProjection, textContext?: string): CandidateProjection {
    const text = textContext || projection.executiveThemes.join("\n") || "Executive";
    const title = "Executive";

    const opRaw = OperatingLevelClassifier.classify(text, title);
    const workNature = WorkNatureClassifier.classify(text, title);
    const decisionAuthority = DecisionAuthorityClassifier.classify(text, title);
    const commercialScope = CommercialScopeClassifier.classify(text, title);

    const operatingLevel = {
      value: (opRaw.value || "STRATEGIC") as OperatingLevel,
      evidenceIds: opRaw.evidenceIds || ["op_derived"],
      confidence: opRaw.confidence || 0.85
    };

    return {
      ...projection,
      operatingLevel,
      workNature,
      decisionAuthority,
      commercialScope
    };
  }
}
