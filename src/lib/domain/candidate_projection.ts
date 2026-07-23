// src/lib/domain/candidate_projection.ts

import { ClassifierResult, OperatingLevel, WorkNature, DecisionAuthority, CommercialScope } from "./semantic";

export interface CandidateProjection {
  operatingLevel: ClassifierResult<OperatingLevel>;
  workNature: ClassifierResult<WorkNature>;
  decisionAuthority: ClassifierResult<DecisionAuthority>;
  commercialScope: ClassifierResult<CommercialScope>;
  yearsOfExperience: number;
  coreCapabilities: string[];
  preferredLocations: string[];
  preferredWorkModel: "HYBRID" | "REMOTE" | "ON_SITE" | "ANY";
  executiveThemes: string[];
}
