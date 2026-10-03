import type { PinnedIntelligence } from '../evaluation/intelligence-taxonomy';
import {z} from 'zod';
import {candidateConflictSchema, type AcquisitionAttempt, type Claim, type EvidenceSource, type SliceInput} from './contracts';

export interface CandidateDecisionProfile {
  projection: {
    currentTitle?: string;
    yearsExperience?: number;
    archetype?: string;
    operatingLevel?: unknown;
    candidateSeniorityLevel?: unknown;
    workNature?: unknown;
    decisionAuthority?: unknown;
    commercialScope?: unknown;
    coreCapabilities?: string[];
    demonstratedCapabilities?: string[];
    executiveThemes?: string[];
  } | null;
  intent: {
    targetTitles: string[];
    preferredLocations: string[];
    preferredWorkModel?: string;
    currency?: string;
    targetSalaryAmount?: number;
    travelTolerance?: string;
    decisionPreferences?: Record<string, unknown>;
  } | null;
}

export interface StagedResearchInput {
  opportunity: SliceInput['opportunity'];
  candidate: SliceInput['candidate'];
  candidateDecisionProfile?: CandidateDecisionProfile;
  intelligenceTaxonomy?: PinnedIntelligence;
  sources: EvidenceSource[];
  evidence: Claim[];
  candidateSourceRefs: { id: string; title: string }[];
  candidateConflicts: z.infer<typeof candidateConflictSchema>[];
  acquisition: AcquisitionAttempt[];
  validEvidenceClaimIds: string[];
  fields: string[];
  fingerprint: string;
}

const requirementStrengthSchema = z.enum(['REQUIRED', 'PREFERRED']);

const roleImportanceSchema = z.enum(['CORE_CAPABILITY', 'ENABLER']);

const fitStatusSchema = z.enum(['DIRECT', 'ADJACENT', 'TRANSFERABLE', 'NOT_EVIDENCED', 'CONTRADICTED']);

const roleRequirementDraftSchema = z.object({
  requirement: z.string().min(1),
  strength: requirementStrengthSchema,
  roleImportance: roleImportanceSchema,
  roleClaimIds: z.array(z.string()).min(1),
  reasoning: z.string().min(1),
});

const roleOperatingConditionDraftSchema = z.object({
  condition: z.string().min(1),
  kind: z.enum(['OPERATING_SHAPE', 'AUTHORITY_SHAPE', 'EMPLOYMENT_CONDITION']),
  roleClaimIds: z.array(z.string()).min(1),
  reasoning: z.string().min(1),
});

export const stagedRoleAnalysisSchema = z.object({
  requirements: z.array(roleRequirementDraftSchema).min(1),
  operatingConditions: z.array(roleOperatingConditionDraftSchema),
  authorityShape: z.string().min(1),
  roleSideConditions: z.array(z.object({
    condition: z.string().min(1),
    roleClaimIds: z.array(z.string()).min(1),
  })),
});

export const stagedMappingResponseSchema = z.object({
  status: fitStatusSchema,
  candidateClaimIds: z.array(z.string()),
  unsupportedAspects: z.array(z.string()),
  reasoning: z.string().min(1),
});

export type StagedRoleRequirement = z.infer<typeof roleRequirementDraftSchema> & { id: string };

export type StagedOperatingCondition = z.infer<typeof roleOperatingConditionDraftSchema> & { id: string };

export type StagedRoleAnalysis = {
  requirements: StagedRoleRequirement[];
  operatingConditions: StagedOperatingCondition[];
  authorityShape: string;
  roleSideConditions: z.infer<typeof stagedRoleAnalysisSchema>['roleSideConditions'];
};

export type StagedScreenedRequirement = StagedRoleRequirement & {
  screeningGate: boolean;
  screeningFunction: 'ENTRY_QUALIFICATION' | 'ROLE_PERFORMANCE_REQUIREMENT';
  screeningGateBasis:
    | 'MINIMUM_TENURE'
    | 'MANDATORY_CREDENTIAL'
    | 'PRIOR_RELEVANT_EXPERIENCE'
    | 'ELIGIBILITY_CONDITION'
    | 'QUALIFYING_ARTIFACT'
    | 'EXPLICIT_SHORTLIST_CONDITION'
    | 'NONE';
  screeningReasoning: string;
};

export type StagedMappedRequirement = StagedScreenedRequirement & {
  status: z.infer<typeof fitStatusSchema>;
  candidateClaimIds: string[];
  unsupportedAspects: string[];
  mappingReasoning: string;
};

function exactIds(ids: readonly string[], known: Set<string>, label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} reference`);
  const unknown = ids.find(id => !known.has(id));
  if (unknown) throw new Error(`Unknown ${label} reference: ${unknown}`);
}

type HighFrictionConditionKind='FOUNDER_ECONOMICS'|'FOUNDER_STATUS'|'RELOCATION'|'WORKING_HOURS';

function highFrictionConditionKind(claim: Claim): HighFrictionConditionKind | null {
  if (claim.plane !== 'JD' || claim.state !== 'EXPLICIT') return null;
  if(/\b(?:equity[- ]only|no\s+(?:fixed\s+)?salary|without\s+(?:a\s+)?salary|personal\s+capital|capital\s+investment|investment\s+commitment|must\s+invest)\b/i.test(claim.text))return 'FOUNDER_ECONOMICS';
  if(/\b(?:co[- ]founder|founder\s+opportunity|not\s+(?:an?\s+)?employment)\b/i.test(claim.text))return 'FOUNDER_STATUS';
  if(/\b(?:relocat(?:e|ion)\s+(?:is\s+)?required|must\s+relocate)\b/i.test(claim.text))return 'RELOCATION';
  if(/\b(?:work(?:ing)?\s+(?:US|U\.S\.|EST|PST|CST)\s+hours|mandatory\s+(?:US|U\.S\.)\s+hours)\b/i.test(claim.text))return 'WORKING_HOURS';
  return null;
}

export function materializeStagedRoleAnalysis(value: unknown, roleClaims: Claim[]): StagedRoleAnalysis {
  const parsed = stagedRoleAnalysisSchema.parse(value);
  const known = new Set(roleClaims.map(claim => claim.id));
  parsed.requirements.forEach(item => exactIds(item.roleClaimIds, known, 'role requirement claim'));
  parsed.operatingConditions.forEach(item => exactIds(item.roleClaimIds, known, 'role operating-condition claim'));
  parsed.roleSideConditions.forEach(item => exactIds(item.roleClaimIds, known, 'role-side condition claim'));
  const claimById=new Map(roleClaims.map(claim=>[claim.id,claim]));
  const requiredKinds=new Set(roleClaims.map(highFrictionConditionKind).filter((kind):kind is HighFrictionConditionKind=>kind!==null));
  const representedKinds=new Set(
    parsed.roleSideConditions
      .flatMap(item=>item.roleClaimIds)
      .map(id=>highFrictionConditionKind(claimById.get(id)!))
      .filter((kind):kind is HighFrictionConditionKind=>kind!==null),
  );
  const missingKinds=[...requiredKinds].filter(kind=>!representedKinds.has(kind));
  if(missingKinds.length){
    throw new Error(`Explicit joining condition must survive as roleSideCondition: ${missingKinds.join(', ')}`);
  }
  return {
    ...parsed,
    requirements: parsed.requirements.map((item, index) => ({ ...item, id: `REQ-${String(index + 1).padStart(3, '0')}` })),
    operatingConditions: parsed.operatingConditions.map((item, index) => ({ ...item, id: `OP-${String(index + 1).padStart(3, '0')}` })),
  };
}

export function eligibleScreeningDrivers(requirements: StagedMappedRequirement[]): StagedMappedRequirement[] {
  return requirements.filter(requirement => requirement.screeningGate && requirement.status !== 'DIRECT');
}
