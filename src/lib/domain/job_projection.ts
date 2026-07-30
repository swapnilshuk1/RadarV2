// src/lib/domain/job_projection.ts

import { ClassifierResult, OperatingLevel, WorkNature, DecisionAuthority, CommercialScope } from "./semantic";

export type DocumentRegion = 
  | "TITLE"
  | "SUMMARY"
  | "RESPONSIBILITIES"
  | "REQUIREMENTS"
  | "COMPANY"
  | "BENEFITS";

export interface ProjectedCapability {
  name: string;
  source: "explicit" | "inferred";
  confidence: number;
  evidence?: string[];
}

export interface ExecutiveIdentity {
  value: string;
  confidence: number;
  evidence: string[];
}

export interface OperatingContext {
  budgetOwnership?: boolean;
  pnlResponsibility?: boolean;
  teamSize?: string | number;
  directReports?: boolean;
  vendorManagement?: boolean;
  complianceAudit?: boolean;
  remote?: boolean;
  hybrid?: boolean;
  travel?: boolean;
}

export interface JobProjection {
  jobHash: string;
  role: string;
  company: string;
  
  // High-level professional identity
  executiveIdentity: ExecutiveIdentity;
  
  // Standard semantic classifiers
  operatingLevel: ClassifierResult<OperatingLevel>;
  workNature: ClassifierResult<WorkNature>;
  decisionAuthority: ClassifierResult<DecisionAuthority>;
  commercialScope: ClassifierResult<CommercialScope>;
  
  // Normalized capabilities
  capabilities: ProjectedCapability[];
  
  // Theme dimensions
  executiveFunction: string[];
  businessObjectives: string[];
  executionStyle: string[];
  
  // Deterministic structural metadata
  operatingContext: OperatingContext;
  
  location: string;
  workModel: "HYBRID" | "REMOTE" | "ON_SITE" | "UNKNOWN";
  capabilityExtractionStatus: "COMPLETE" | "PARTIAL" | "FAILED";
  originalOpportunity?: any;
}
