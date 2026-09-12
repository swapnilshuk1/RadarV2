// src/lib/domain/job_projection.ts

import { ClassifierResult, OperatingLevel, WorkNature, DecisionAuthority, CommercialScope } from "./semantic";
import type { CanonicalSemanticEvidence } from "../intelligence/semantic/types";

export type DocumentRegion = 
  | "TITLE"
  | "SUMMARY"
  | "RESPONSIBILITIES"
  | "REQUIREMENTS"
  | "COMPANY"
  | "BENEFITS";

export type CapabilityTaxonomyTier = 
  | "CORE_MANDATE" 
  | "EXECUTION_CAPABILITY" 
  | "TECHNOLOGY_STACK" 
  | "DOMAIN_FAMILIARITY";

export interface ProjectedCapability {
  name: string;
  source: "explicit" | "inferred";
  confidence: number;
  tier?: CapabilityTaxonomyTier;
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

export type TrueExecutiveMandate = 
  | "SCALE" 
  | "TRANSFORMATION" 
  | "TURNAROUND" 
  | "GOVERNANCE" 
  | "COMMERCIAL_EXPANSION";

export type OrganizationalIntent = 
  | "REPLACE_FAILED_LEADER"
  | "BUILD_NEW_CAPABILITY"
  | "PROFESSIONALIZE_FOUNDER_COMPANY"
  | "PREPARE_IPO"
  | "INTEGRATE_ACQUISITION"
  | "REPAIR_EXECUTION"
  | "ACCELERATE_GROWTH"
  | "EXPAND_GEOGRAPHY"
  | "COMMERCIALIZE_TECHNOLOGY";

export interface ExecutiveMission {
  intent: OrganizationalIntent;
  statement: string;
  successConditions: string[];
}

export interface JobProjection {
  jobHash: string;
  role: string;
  company: string;
  
  // High-level professional identity
  executiveIdentity: ExecutiveIdentity;
  
  // Inferred True Executive Mandate & Intent
  trueExecutiveMandate?: TrueExecutiveMandate;
  executiveMission?: ExecutiveMission;

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
  // Phase 5C.2: Additive Canonical Semantic Evidence
  semanticEvidence?: readonly CanonicalSemanticEvidence[];
}
