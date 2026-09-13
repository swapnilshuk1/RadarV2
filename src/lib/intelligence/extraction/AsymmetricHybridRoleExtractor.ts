/**
 * AsymmetricHybridRoleExtractor.ts
 *
 * RADAR v2 Asymmetric Hybrid Role Extraction Architecture (Layers 1-5).
 * Selected in Batch 05, Certified in Batch 06.
 *
 * ARCHITECTURAL LAYERS:
 * Layer 1: Deterministic Provenance (MechanicalSourceSegmenter)
 * Layer 2: Rich Grounded Semantic Propositions (RichPropositionProvider)
 * Layer 3: High-Risk Semantic Verifier (HighRiskSemanticVerifier)
 * Layer 4: Structural Admission (StructuralAdmissionEngine)
 * Layer 5: Deterministic Canonical Projection (ProjectedCanonicalAtom)
 *
 * STRICT INVARIANTS:
 * 1. Read-only text slices: rawSourceText.slice(startOffset, endOffset) === exactText.
 * 2. 25 Canonical RoleSemanticTypes strictly preserved.
 * 3. COMMERCIAL_ACCOUNTABILITY is validation terminology only and never a canonical type.
 * 4. Structural admission is independent from semantic entailment.
 * 5. High-risk verifier fails closed to INSUFFICIENT; INSUFFICIENT never becomes affirmative truth.
 * 6. NEGATED propositions project zero affirmative canonical facts.
 * 7. CANDIDATE_REQUIREMENT/PREFERENCE never projects active ROLE authority.
 * 8. Zero modification to deterministic Extraction V1 baseline.
 * 9. Production extraction authority remains untouched.
 */

import { segmentSourceText, type SourceUnit } from "./MechanicalSourceSegmenter";
import {
  type GroundedSemanticProposition,
  type ProjectedCanonicalAtom,
  type PropositionPolarity,
  type PropositionApplicability
} from "./RichSemanticPropositionContract";
import type { RoleSemanticType } from "./RoleIntelligenceExtractorV1";
import {
  HighRiskSemanticVerifier,
  type SemanticVerificationResult,
  type SemanticVerifier
} from "./HighRiskSemanticVerifier";
import {
  StructuralAdmissionEngine,
  type StructuralAdmissionDecision,
  type StructuralAdmissionBatchResult
} from "./StructuralAdmissionEngine";

export const HYBRID_ROLE_ARCHITECTURE_VERSION = "asymmetric-hybrid-role/v1";

export interface RichPropositionProvider {
  extractPropositions(
    units: readonly SourceUnit[],
    options?: {
      title?: string;
      companyName?: string;
    }
  ): Promise<readonly GroundedSemanticProposition[]>;
}

export interface HybridRoleExtractionMetrics {
  readonly charLength: number;
  readonly unitCount: number;
  readonly totalPropositions: number;
  readonly admittedAffirmativeCount: number;
  readonly admittedBoundariesCount: number;
  readonly admittedConditionalCount: number;
  readonly rejectedCount: number;
  readonly unmappedMaterialCount: number;
  readonly highRiskEntailedCount: number;
  readonly highRiskInsufficientCount: number;
  readonly highRiskContradictedCount: number;
  readonly projectedFactCount: number;
}

export interface HybridRoleExtractionResult {
  readonly architectureVersion: string;
  readonly sourceUnits: readonly SourceUnit[];
  readonly unitMap: ReadonlyMap<string, SourceUnit>;
  readonly propositions: readonly GroundedSemanticProposition[];
  readonly verificationResults: readonly SemanticVerificationResult[];
  readonly admissionDecisions: readonly StructuralAdmissionDecision[];
  readonly canonicalFacts: readonly ProjectedCanonicalAtom[];
  readonly negativeBoundaries: readonly string[];
  readonly unmappedConcepts: readonly string[];
  readonly metrics: HybridRoleExtractionMetrics;
}

export class AsymmetricHybridRoleExtractor {
  private readonly verifier: SemanticVerifier;
  private readonly admissionEngine: StructuralAdmissionEngine;

  constructor(customVerifier?: SemanticVerifier) {
    this.verifier = customVerifier ?? new HighRiskSemanticVerifier();
    this.admissionEngine = new StructuralAdmissionEngine();
  }

  /**
   * Executes the full 5-layer extraction pipeline on raw JD text.
   */
  async extract(
    rawSourceText: string,
    propositionProvider: RichPropositionProvider,
    context?: {
      title?: string;
      companyName?: string;
    }
  ): Promise<HybridRoleExtractionResult> {
    // ---------------------------------------------------------
    // Layer 1: Deterministic Source Segmentation & Indexing
    // ---------------------------------------------------------
    const sourceUnits = segmentSourceText(rawSourceText);
    const unitMap = new Map<string, SourceUnit>();
    for (const unit of sourceUnits) {
      unitMap.set(unit.spanId, unit);
    }

    // ---------------------------------------------------------
    // Layer 2: Rich Grounded Semantic Propositions
    // ---------------------------------------------------------
    const propositions = await propositionProvider.extractPropositions(sourceUnits, {
      title: context?.title,
      companyName: context?.companyName
    });

    // ---------------------------------------------------------
    // Layer 3: High-Risk Semantic Verifier
    // ---------------------------------------------------------
    const verificationResults: SemanticVerificationResult[] = [];
    let highRiskEntailedCount = 0;
    let highRiskInsufficientCount = 0;
    let highRiskContradictedCount = 0;

    for (const prop of propositions) {
      const v = this.verifier.verifyProposition(prop, sourceUnits, {
        roleTitle: context?.title,
        companyName: context?.companyName
      });
      verificationResults.push(v);

      if (v.isHighRisk) {
        if (v.verdict === "ENTAILED") highRiskEntailedCount++;
        else if (v.verdict === "INSUFFICIENT") highRiskInsufficientCount++;
        else if (v.verdict === "CONTRADICTED") highRiskContradictedCount++;
      }
    }

    // ---------------------------------------------------------
    // Layer 4: Structural Admission Engine
    // ---------------------------------------------------------
    const admissionBatch: StructuralAdmissionBatchResult = this.admissionEngine.evaluateBatch(
      propositions,
      unitMap,
      verificationResults
    );

    // ---------------------------------------------------------
    // Layer 5: Deterministic Canonical Projection
    // ---------------------------------------------------------
    const canonicalFacts: ProjectedCanonicalAtom[] = [];
    const negativeBoundaries: string[] = [];
    const unmappedConcepts: string[] = [];

    // Collect negative boundaries from admitted boundaries
    for (const boundary of admissionBatch.admittedBoundaries) {
      if (boundary.boundaryDescription) {
        negativeBoundaries.push(boundary.boundaryDescription);
      }
    }

    // Project affirmative and conditional admitted decisions to canonical facts
    const eligibleDecisions = [
      ...admissionBatch.admittedAffirmative,
      ...admissionBatch.admittedConditional
    ];

    for (const decision of eligibleDecisions) {
      const prop = propositions[decision.propositionIndex];
      const primaryUnit = decision.primarySpanId ? unitMap.get(decision.primarySpanId) : undefined;

      if (!primaryUnit) continue;

      if (prop.ontologyDisposition === "UNMAPPED_MATERIAL" && prop.unmappedConceptDescription) {
        unmappedConcepts.push(prop.unmappedConceptDescription);
      }

      for (const canonicalType of decision.admittedTypes) {
        canonicalFacts.push({
          propositionIndex: decision.propositionIndex,
          canonicalType,
          subject: decision.subject,
          exactText: primaryUnit.exactText,
          startOffset: primaryUnit.startOffset,
          endOffset: primaryUnit.endOffset,
          spanId: primaryUnit.spanId,
          polarity: decision.polarity,
          conditionDescription: decision.conditionDescription,
          propositionText: prop.proposition
        });
      }
    }

    const allDecisions = [
      ...admissionBatch.admittedAffirmative,
      ...admissionBatch.admittedBoundaries,
      ...admissionBatch.admittedConditional,
      ...admissionBatch.rejected
    ].sort((a, b) => a.propositionIndex - b.propositionIndex);

    const metrics: HybridRoleExtractionMetrics = {
      charLength: rawSourceText.length,
      unitCount: sourceUnits.length,
      totalPropositions: propositions.length,
      admittedAffirmativeCount: admissionBatch.admittedAffirmative.length,
      admittedBoundariesCount: admissionBatch.admittedBoundaries.length,
      admittedConditionalCount: admissionBatch.admittedConditional.length,
      rejectedCount: admissionBatch.rejected.length,
      unmappedMaterialCount: admissionBatch.unmappedMaterialCount,
      highRiskEntailedCount,
      highRiskInsufficientCount,
      highRiskContradictedCount,
      projectedFactCount: canonicalFacts.length
    };

    return {
      architectureVersion: HYBRID_ROLE_ARCHITECTURE_VERSION,
      sourceUnits,
      unitMap,
      propositions,
      verificationResults,
      admissionDecisions: allDecisions,
      canonicalFacts,
      negativeBoundaries,
      unmappedConcepts,
      metrics
    };
  }
}
