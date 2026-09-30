// src/domain/candidate.ts

export interface CandidateIdentity {
  name: string;
  currentTitle: string;
}

export interface CandidateExecutiveIdentity {
  archetype: string;
  valueProposition: string;
  executiveThemes: string[];
}

export interface CandidateExperience {
  yearsExperience: number;
  teamSizeManaged: number;
  feeBookScale?: string;
  plOwnership: boolean;
  boardInteraction: boolean;
  achievements: string[];
  largestTeam?: number;
  globalMarkets?: number;
  regions?: string[];
  budgetResponsibility?: string;
  commercialOwnership?: boolean;
  boardExposure?: boolean;
  globalPrograms?: boolean;
  peopleLeadership?: boolean;
  matrixLeadership?: boolean;
  vendorManagement?: boolean;
  clientLeadership?: boolean;
}

export interface CandidateEvidence {
  type: string;
  proof: string;
}

export interface CandidatePreferences {
  locations?: string[];
  remote?: string;
  targetMinSalary?: string;
  industries?: string[];
  [key: string]: any;
}

export interface CandidateIndustryExperience {
  primary?: string[];
  secondary?: string[];
  agency?: string[];
  enterprise?: string[];
  [key: string]: any;
}

export interface CandidateStrategy {
  targetTitles?: string[];
  ceoPathway?: boolean;
  boardReadiness?: boolean;
}

export interface CandidateResume {
  rawText: string;
  sourceResumeVersion?: string;
}

export interface CandidateProfile {
  userId?: string;
  email?: string;
  session?: any;
  identity: CandidateIdentity;
  executiveIdentity: CandidateExecutiveIdentity;
  experience: CandidateExperience;
  leadershipProfile?: Record<string, any>;
  evidence: CandidateEvidence[];
  capabilities?: Record<string, string[]>;
  executiveCompetencies?: string[];
  semanticAliases?: Record<string, string[]>;
  preferences?: CandidatePreferences;
  industryExperience?: CandidateIndustryExperience;
  strategy?: CandidateStrategy;
  resume?: CandidateResume;
  platforms?: string[];
  skills?: string[];
  functions?: string[];
  domains?: string[];
  leadership?: string[];
}
