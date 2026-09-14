/**
 * StructuralAdmissionEngine.ts
 *
 * Layer 4 Structural Admission Engine for RADAR v2 Asymmetric Hybrid Role Extraction.
 *
 * STRICT INVARIANTS:
 * 1. Independent Admission from Semantic Entailment: A proposition may be semantically
 *    entailed in text but structurally disqualified from role authority.
 * 2. Source Evidence Grounding: 100% fail-closed on ungrounded or missing source unit IDs.
 * 3. Polarity Discipline:
 *    - NEGATED propositions are admitted as boundary constraints only (zero affirmative facts).
 *    - CONDITIONAL propositions must carry explicit condition descriptions.
 * 4. Applicability Boundary Discipline:
 *    - CANDIDATE_REQUIREMENT cannot become ROLE authority (projected solely as HARD_REQUIREMENT).
 *    - CANDIDATE_PREFERENCE cannot become ROLE authority (projected solely as PREFERRED_REQUIREMENT).
 *    - COMPANY cannot become ROLE authority (projected solely as COMPANY_CONTEXT).
 *    - RECRUITING_PROCESS cannot become ROLE authority (rejected from role intelligence).
 * 5. Canonical Types:
 *    - Retains existing 25 RoleSemanticTypes strictly. Zero additions.
 *    - COMMERCIAL_ACCOUNTABILITY is validation terminology only and must never become a canonical type.
 */

import type {
  GroundedSemanticProposition,
  PropositionApplicability,
  PropositionPolarity
} from "./RichSemanticPropositionContract";
import type { SourceUnit } from "./MechanicalSourceSegmenter";
import type { RoleSemanticType } from "./RoleIntelligenceExtractorV1";
import {
  HIGH_RISK_SEMANTIC_FAMILIES,
  type HighRiskSemanticFamily,
  type SemanticVerificationResult
} from "./HighRiskSemanticVerifier";

export type StructuralAdmissionStatus =
  | "ADMITTED_AFFIRMATIVE"
  | "ADMITTED_BOUNDARY_ONLY"
  | "ADMITTED_CONDITIONAL"
  | "REJECTED";

export interface StructuralAdmissionDecision {
  readonly propositionIndex: number;
  readonly status: StructuralAdmissionStatus;
  readonly admittedTypes: readonly RoleSemanticType[];
  readonly subject: "ROLE" | "COMPANY" | "RECRUITING_PROCESS";
  readonly polarity: PropositionPolarity;
  readonly conditionDescription: string | null;
  readonly primarySpanId: string | null;
  readonly boundaryDescription: string | null;
  readonly rejectionReason: string | null;
}

export interface StructuralAdmissionBatchResult {
  readonly admittedAffirmative: readonly StructuralAdmissionDecision[];
  readonly admittedBoundaries: readonly StructuralAdmissionDecision[];
  readonly admittedConditional: readonly StructuralAdmissionDecision[];
  readonly rejected: readonly StructuralAdmissionDecision[];
  readonly unmappedMaterialCount: number;
  readonly unknownHighRiskDimensions: readonly HighRiskSemanticFamily[];
}

const CANONICAL_ROLE_TYPES_SET = new Set<RoleSemanticType>([
  "ROLE_PURPOSE",
  "RESPONSIBILITY",
  "OUTCOME",
  "SUCCESS_METRIC",
  "HARD_REQUIREMENT",
  "PREFERRED_REQUIREMENT",
  "REPORTING_LINE",
  "FOUNDER_CEO_PROXIMITY",
  "BOARD_EXPOSURE",
  "PNL_OWNERSHIP",
  "REVENUE_ACCOUNTABILITY",
  "PROFITABILITY_ACCOUNTABILITY",
  "BUDGET_SCOPE",
  "DECISION_AUTHORITY",
  "PEOPLE_LEADERSHIP",
  "PEOPLE_SCALE",
  "GREENFIELD_BUILD",
  "TRANSFORMATION",
  "GEOGRAPHIC_SCOPE",
  "REGULATORY_SCOPE",
  "PRODUCT_SCOPE",
  "CUSTOMER_SCOPE",
  "CHANNEL_SCOPE",
  "COMPANY_CONTEXT",
  "WORK_CONDITION"
]);

export class StructuralAdmissionEngine {
  admitProposition(
    index: number,
    proposition: GroundedSemanticProposition,
    unitMap: ReadonlyMap<string, SourceUnit>,
    verificationResult?: SemanticVerificationResult
  ): StructuralAdmissionDecision {
    // 1. Source Evidence Grounding
    if (!proposition.sourceEvidence || proposition.sourceEvidence.length === 0) {
      return {
        propositionIndex: index,
        status: "REJECTED",
        admittedTypes: [],
        subject: "ROLE",
        polarity: proposition.polarity,
        conditionDescription: null,
        primarySpanId: null,
        boundaryDescription: null,
        rejectionReason: "REJECTED_UNGROUNDED: No source unit IDs cited"
      };
    }

    const missingUnits = proposition.sourceEvidence.filter(id => !unitMap.has(id));
    if (missingUnits.length > 0) {
      return {
        propositionIndex: index,
        status: "REJECTED",
        admittedTypes: [],
        subject: "ROLE",
        polarity: proposition.polarity,
        conditionDescription: null,
        primarySpanId: null,
        boundaryDescription: null,
        rejectionReason: `REJECTED_UNGROUNDED: Cited source units do not exist: ${missingUnits.join(", ")}`
      };
    }

    const primarySpanId = proposition.sourceEvidence[0];

    // 2. High-Risk Semantic Verification Gate:
    // If proposition is high-risk, fail closed if contradicted or insufficient
    if (verificationResult && verificationResult.isHighRisk) {
      if (verificationResult.verdict === "CONTRADICTED") {
        if (proposition.polarity === "AFFIRMED") {
          return {
            propositionIndex: index,
            status: "REJECTED",
            admittedTypes: [],
            subject: "ROLE",
            polarity: proposition.polarity,
            conditionDescription: null,
            primarySpanId,
            boundaryDescription: null,
            rejectionReason: `REJECTED_CONTRADICTED: ${verificationResult.reason}`
          };
        }
      } else if (verificationResult.verdict === "INSUFFICIENT") {
        // INSUFFICIENT must never become affirmative canonical truth
        return {
          propositionIndex: index,
          status: "REJECTED",
          admittedTypes: [],
          subject: "ROLE",
          polarity: proposition.polarity,
          conditionDescription: null,
          primarySpanId,
          boundaryDescription: null,
          rejectionReason: `REJECTED_INSUFFICIENT_EVIDENCE: ${verificationResult.reason}`
        };
      }
    }

    // 3. Polarity Discipline:
    // NEGATED propositions are admitted as boundary constraints ONLY
    if (proposition.polarity === "NEGATED") {
      return {
        propositionIndex: index,
        status: "ADMITTED_BOUNDARY_ONLY",
        admittedTypes: [], // Zero affirmative canonical facts!
        subject: "ROLE",
        polarity: "NEGATED",
        conditionDescription: null,
        primarySpanId,
        boundaryDescription: proposition.proposition,
        rejectionReason: null
      };
    }

    // CONDITIONAL propositions must carry explicit condition description
    if (proposition.polarity === "CONDITIONAL") {
      const condition = proposition.conditionDescription?.trim();
      if (!condition) {
        return {
          propositionIndex: index,
          status: "REJECTED",
          admittedTypes: [],
          subject: "ROLE",
          polarity: "CONDITIONAL",
          conditionDescription: null,
          primarySpanId,
          boundaryDescription: null,
          rejectionReason: "REJECTED_CONDITIONAL_UNSPECIFIED: CONDITIONAL proposition lacks explicit condition description"
        };
      }
    }

    // 4. Applicability Boundary Discipline:
    let subject: "ROLE" | "COMPANY" | "RECRUITING_PROCESS" = "ROLE";
    let admittedTypes: RoleSemanticType[] = [];

    switch (proposition.appliesTo) {
      case "RECRUITING_PROCESS":
        return {
          propositionIndex: index,
          status: "REJECTED",
          admittedTypes: [],
          subject: "RECRUITING_PROCESS",
          polarity: proposition.polarity,
          conditionDescription: null,
          primarySpanId,
          boundaryDescription: null,
          rejectionReason: "REJECTED_APPLICABILITY: RECRUITING_PROCESS excluded from role intelligence taxonomy"
        };

      case "COMPANY":
        subject = "COMPANY";
        admittedTypes = ["COMPANY_CONTEXT"];
        break;

      case "CANDIDATE_REQUIREMENT":
        // CANDIDATE_REQUIREMENT cannot become ROLE authority (e.g. past P&L experience is NOT role P&L)
        subject = "ROLE";
        admittedTypes = ["HARD_REQUIREMENT"];
        break;

      case "CANDIDATE_PREFERENCE":
        // CANDIDATE_PREFERENCE cannot become ROLE authority
        subject = "ROLE";
        admittedTypes = ["PREFERRED_REQUIREMENT"];
        break;

      case "ROLE":
      default: {
        subject = "ROLE";
        // Filter canonical types to the valid 25 types, stripping any invalid types
        admittedTypes = proposition.canonicalTypes.filter(t => {
          // COMMERCIAL_ACCOUNTABILITY is validation terminology only and must never become a canonical type
          if ((t as string) === "COMMERCIAL_ACCOUNTABILITY") return false;
          return CANONICAL_ROLE_TYPES_SET.has(t);
        });

        if (admittedTypes.length === 0 && proposition.ontologyDisposition === "MAPPED") {
          return {
            propositionIndex: index,
            status: "REJECTED",
            admittedTypes: [],
            subject,
            polarity: proposition.polarity,
            conditionDescription: null,
            primarySpanId,
            boundaryDescription: null,
            rejectionReason: "REJECTED_NO_CANONICAL_TYPE: MAPPED proposition did not supply a recognized canonical type"
          };
        }
        break;
      }
    }

    const finalStatus: StructuralAdmissionStatus =
      proposition.polarity === "CONDITIONAL" ? "ADMITTED_CONDITIONAL" : "ADMITTED_AFFIRMATIVE";

    return {
      propositionIndex: index,
      status: finalStatus,
      admittedTypes,
      subject,
      polarity: proposition.polarity,
      conditionDescription: proposition.conditionDescription?.trim() ?? null,
      primarySpanId,
      boundaryDescription: null,
      rejectionReason: null
    };
  }

  evaluateBatch(
    propositions: readonly GroundedSemanticProposition[],
    unitMap: ReadonlyMap<string, SourceUnit>,
    verificationResults?: readonly SemanticVerificationResult[]
  ): StructuralAdmissionBatchResult {
    const admittedAffirmative: StructuralAdmissionDecision[] = [];
    const admittedBoundaries: StructuralAdmissionDecision[] = [];
    const admittedConditional: StructuralAdmissionDecision[] = [];
    const rejected: StructuralAdmissionDecision[] = [];
    let unmappedMaterialCount = 0;

    for (let i = 0; i < propositions.length; i++) {
      const p = propositions[i];
      const v = verificationResults ? verificationResults[i] : undefined;
      const decision = this.admitProposition(i, p, unitMap, v);

      if (p.ontologyDisposition === "UNMAPPED_MATERIAL") {
        unmappedMaterialCount++;
      }

      switch (decision.status) {
        case "ADMITTED_AFFIRMATIVE":
          admittedAffirmative.push(decision);
          break;
        case "ADMITTED_BOUNDARY_ONLY":
          admittedBoundaries.push(decision);
          break;
        case "ADMITTED_CONDITIONAL":
          admittedConditional.push(decision);
          break;
        case "REJECTED":
          rejected.push(decision);
          break;
      }
    }

    // Collect all high-risk families covered by admitted affirmative or boundary decisions
    const coveredFamilies = new Set<string>();
    for (const d of admittedAffirmative) {
      for (const t of d.admittedTypes) {
        if (HIGH_RISK_SEMANTIC_FAMILIES.includes(t as HighRiskSemanticFamily)) {
          coveredFamilies.add(t);
        }
      }
    }
    for (const d of admittedBoundaries) {
      for (const t of d.admittedTypes) {
        if (HIGH_RISK_SEMANTIC_FAMILIES.includes(t as HighRiskSemanticFamily)) {
          coveredFamilies.add(t);
        }
      }
    }

    // Explicit post-admission UNKNOWN set: any high-risk family with zero admitted affirmative or boundary assertions
    const unknownHighRiskDimensions = HIGH_RISK_SEMANTIC_FAMILIES.filter(
      f => !coveredFamilies.has(f)
    );

    return {
      admittedAffirmative,
      admittedBoundaries,
      admittedConditional,
      rejected,
      unmappedMaterialCount,
      unknownHighRiskDimensions
    };
  }
}
