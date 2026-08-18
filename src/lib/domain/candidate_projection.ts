// src/lib/domain/candidate_projection.ts

import { ClassifierResult, OperatingLevel, CandidateSeniorityLevel, WorkNature, DecisionAuthority, CommercialScope } from "./semantic";

export interface CandidateProjection {
  operatingLevel: ClassifierResult<OperatingLevel>;
  // P0-E: Candidate seniority level - distinct from operating level
  candidateSeniorityLevel?: ClassifierResult<CandidateSeniorityLevel>;
  workNature: ClassifierResult<WorkNature>;
  decisionAuthority: ClassifierResult<DecisionAuthority>;
  commercialScope: ClassifierResult<CommercialScope>;
  yearsOfExperience: number;
  coreCapabilities: string[];
  preferredLocations: string[];
  preferredWorkModel: "HYBRID" | "REMOTE" | "ON_SITE" | "ANY";
  executiveThemes: string[];
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
  if (!Array.isArray(p.executiveThemes) || p.executiveThemes.length === 0) {
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

