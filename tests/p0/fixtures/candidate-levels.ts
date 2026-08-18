/**
 * P0 Fixture: Candidate Levels
 * 
 * Purpose: Three canonical candidate projections at different operating levels.
 * Tests that classifier output is respected, not hardcoded to "STRATEGIC".
 */

import type { CandidateProjection } from "@/src/domain/candidate_projection";
import type { OperatingLevel } from "@/src/domain/semantic";

const BASE_CANDIDATE: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC" as OperatingLevel, confidence: 0.9, evidenceIds: [] },
  workNature: { value: "HYBRID", confidence: 0.9, evidenceIds: [] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.9, evidenceIds: [] },
  commercialScope: { value: "ENTERPRISE", confidence: 0.9, evidenceIds: [] },
  yearsOfExperience: 15,
  coreCapabilities: [
    "CRM Governance",
    "Performance Marketing",
    "GTM Strategy",
    "Digital Transformation"
  ],
  preferredLocations: ["Gurugram", "Mumbai", "Delhi NCR"],
  preferredWorkModel: "HYBRID",
  executiveThemes: [
    "Growth Marketing",
    "Digital Transformation",
    "CRM Strategy"
  ]
};

export const CANDIDATE_DIRECTOR: CandidateProjection = {
  ...BASE_CANDIDATE,
  operatingLevel: { value: "DIRECTOR" as OperatingLevel, confidence: 0.85, evidenceIds: ["title:director"] },
  coreCapabilities: [
    "Performance Marketing",
    "GTM Execution",
    "Team Leadership"
  ],
  yearsOfExperience: 8
};

export const CANDIDATE_VP: CandidateProjection = {
  ...BASE_CANDIDATE,
  operatingLevel: { value: "VP_FUNCTIONAL" as OperatingLevel, confidence: 0.9, evidenceIds: ["title:vp"] },
  coreCapabilities: [
    "CRM Governance",
    "Performance Marketing",
    "Revenue Operations",
    "Team Building"
  ],
  yearsOfExperience: 12
};

export const CANDIDATE_C_SUITE: CandidateProjection = {
  ...BASE_CANDIDATE,
  operatingLevel: { value: "C_SUITE" as OperatingLevel, confidence: 0.95, evidenceIds: ["title:cfo", "title:cgo", "title:cmo"] },
  coreCapabilities: [
    "Enterprise P&L",
    "Board Governance",
    "Digital Transformation",
    "M&A Strategy",
    "Executive Leadership"
  ],
  yearsOfExperience: 18,
  decisionAuthority: { value: "BOARD", confidence: 0.95, evidenceIds: ["evidence:board_exposure"] }
};

/**
 * Factory: Returns candidate at specified level
 */
export function createCandidateAtLevel(
  level: "DIRECTOR" | "VP" | "C_SUITE"
): CandidateProjection {
  switch (level) {
    case "DIRECTOR":
      return JSON.parse(JSON.stringify(CANDIDATE_DIRECTOR));
    case "VP":
      return JSON.parse(JSON.stringify(CANDIDATE_VP));
    case "C_SUITE":
      return JSON.parse(JSON.stringify(CANDIDATE_C_SUITE));
    default:
      throw new Error(`Unknown candidate level: ${level}`);
  }
}

// Expected: Scoring should differ based on candidate level
// VP evaluating CMO role → different score than C-Suite evaluating same role
// (P0-E: Candidate level classifier output respected)
