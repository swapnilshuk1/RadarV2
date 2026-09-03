// src/lib/domain/candidate_projection.ts

import { ClassifierResult, OperatingLevel, CandidateSeniorityLevel, WorkNature, DecisionAuthority, CommercialScope } from "./semantic";
import type { CanonicalSemanticEvidence } from "../intelligence/semantic/types";

export interface CandidateEvidenceReference {
  id: string;
  quote: string;
  sourceSpan?: string;
  relation: "ATTAINED_TITLE" | "SUPPORTS_INFERENCE";
}

export interface InferredCandidateCapability {
  name: string;
  confidence: number;
  evidenceIds: string[];
  supportingEvidence: CandidateEvidenceReference[];
}

export interface CandidateProjection {
  /** Source-grounded attained identity; search targets are kept separately. */
  attainedTitle?: string;
  attainedSeniority?: CandidateSeniorityLevel;
  attainedTitleEvidence?: CandidateEvidenceReference[];
  operatingLevel: ClassifierResult<OperatingLevel>;
  // P0-E: Candidate seniority level - distinct from operating level
  candidateSeniorityLevel?: ClassifierResult<CandidateSeniorityLevel>;
  workNature: ClassifierResult<WorkNature>;
  decisionAuthority: ClassifierResult<DecisionAuthority>;
  commercialScope: ClassifierResult<CommercialScope>;
  yearsOfExperience: number;
  coreCapabilities: string[];
  demonstratedCapabilities?: string[];
  inferredCapabilities?: InferredCandidateCapability[];
  preferredLocations: string[];
  preferredWorkModel: "HYBRID" | "REMOTE" | "ON_SITE" | "ANY";
  executiveThemes: string[];
  archetype?: string;
  targetTrajectory?: string[];
  profileVersion?: string;
  attentionWindow?: number;
  headspaceCapacityPerMonth?: number;
  // Phase 5C.2: Additive Canonical Semantic Evidence
  semanticEvidence?: readonly CanonicalSemanticEvidence[];
}

export interface ProjectionValidationResult {
  valid: boolean;
  missingFields: string[];
}

export function validateCandidateProjection(projection: unknown): ProjectionValidationResult {
  if (!projection || typeof projection !== "object") {
    return { valid: false, missingFields: ["projection"] };
  }
  const p = projection as Record<string, any>;
  const missingFields: string[] = [];

  if (!p.operatingLevel || typeof p.operatingLevel !== "object" || !p.operatingLevel.value || p.operatingLevel.value === "UNKNOWN") {
    missingFields.push("operatingLevel");
  }
  if (!p.workNature || typeof p.workNature !== "object" || !p.workNature.value || p.workNature.value === "UNKNOWN") {
    missingFields.push("workNature");
  }
  if (!p.decisionAuthority || typeof p.decisionAuthority !== "object" || !p.decisionAuthority.value || p.decisionAuthority.value === "UNKNOWN") {
    missingFields.push("decisionAuthority");
  }
  if (!p.commercialScope || typeof p.commercialScope !== "object" || !p.commercialScope.value || p.commercialScope.value === "UNKNOWN") {
    missingFields.push("commercialScope");
  }
  if (!Array.isArray(p.coreCapabilities) || p.coreCapabilities.length === 0) {
    missingFields.push("coreCapabilities");
  }
  if (!Array.isArray(p.preferredLocations)) {
    missingFields.push("preferredLocations");
  }
  if (!p.preferredWorkModel || typeof p.preferredWorkModel !== "string") {
    missingFields.push("preferredWorkModel");
  }
  if (!Array.isArray(p.executiveThemes)) {
    missingFields.push("executiveThemes");
  }
  if (typeof p.yearsOfExperience !== "number") {
    missingFields.push("yearsOfExperience");
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

export const DEFAULT_CANDIDATE_PROJECTION: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 0.9, evidenceIds: [] },
  workNature: { value: "STRATEGIC_WORK", confidence: 0.9, evidenceIds: [] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.9, evidenceIds: [] },
  commercialScope: { value: "ENTERPRISE", confidence: 0.9, evidenceIds: [] },
  yearsOfExperience: 20,
  coreCapabilities: ["COMMERCIAL_GROWTH", "DIGITAL_TRANSFORMATION", "GLOBAL_GTM", "STRATEGIC_LEADERSHIP"],
  preferredLocations: ["Bengaluru", "Remote", "San Francisco"],
  preferredWorkModel: "HYBRID",
  executiveThemes: ["commercial_growth", "transformation"],
  attentionWindow: 6,
  headspaceCapacityPerMonth: 4,
};


