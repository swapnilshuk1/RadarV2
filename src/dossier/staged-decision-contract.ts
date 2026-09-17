import { z } from 'zod';

import { operations, resolutionSchema, type Claim } from './contracts';
import type {
  StagedMappedRequirement,
  StagedRoleAnalysis,
  StagedRoleRequirement,
} from './staged-research';

/**
 * The model identifies the selection function; the application owns the
 * resulting screening boolean. This keeps role-performance expectations from
 * silently becoming employer entry filters.
 */
export const stagedScreeningFunctionSchema = z.enum([
  'ENTRY_QUALIFICATION',
  'ROLE_PERFORMANCE_REQUIREMENT',
]);
export type StagedScreeningFunction = z.infer<typeof stagedScreeningFunctionSchema>;

export const stagedScreeningGateBasisSchema = z.enum([
  'MINIMUM_TENURE',
  'MANDATORY_CREDENTIAL',
  'PRIOR_RELEVANT_EXPERIENCE',
  'ELIGIBILITY_CONDITION',
  'QUALIFYING_ARTIFACT',
  'EXPLICIT_SHORTLIST_CONDITION',
  'NONE',
]);
export type StagedScreeningGateBasis = z.infer<typeof stagedScreeningGateBasisSchema>;

export const mandatoryCredentialKindSchema = z.enum([
  'DEGREE',
  'LICENSE',
  'CERTIFICATION',
  'PROFESSIONAL_QUALIFICATION',
  'PROFESSIONAL_REGISTRATION',
]);
export type MandatoryCredentialKind = z.infer<typeof mandatoryCredentialKindSchema>;

export const screeningBasisSupportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('NONE'),
  }).strict(),
  z.object({
    kind: z.literal('MINIMUM_TENURE'),
    thresholdText: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal('MANDATORY_CREDENTIAL'),
    credentialText: z.string().min(1),
    credentialKind: mandatoryCredentialKindSchema,
  }).strict(),
  z.object({
    kind: z.literal('PRIOR_RELEVANT_EXPERIENCE'),
    experienceText: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal('ELIGIBILITY_CONDITION'),
    conditionText: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal('QUALIFYING_ARTIFACT'),
    artifactText: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal('EXPLICIT_SHORTLIST_CONDITION'),
    selectionConditionText: z.string().min(1),
  }).strict(),
]);
export type ScreeningBasisSupport = z.infer<typeof screeningBasisSupportSchema>;

export const stagedScreeningAdjudicationSchema = z.object({
  screeningFunction: stagedScreeningFunctionSchema,
  gateBasis: stagedScreeningGateBasisSchema,
  exactSourceQuote: z.string().min(1),
  basisSupport: screeningBasisSupportSchema,
  reasoning: z.string().min(1),
}).strict();
export type StagedScreeningAdjudication = z.infer<typeof stagedScreeningAdjudicationSchema>;

export function assertExactContainedSpan(span: string, source: string, label: string): void {
  if (!span.trim() || !source.includes(span)) {
    throw new Error(`${label} must be copied exactly from exactSourceQuote`);
  }
}

const TENURE_DURATION_PATTERN = /\b(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|twenty-five|thirty)\+?\s*(?:to|-|–|—)\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|twenty-five|thirty|\+)?\s*(?:years?|yrs?|months?|decades?)|\d+\+?\s*(?:years?|yrs?|months?|decades?)|(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s*(?:\+|plus)?\s*(?:years?|yrs?|months?|decades?)|(?:minimum|at\s+least|tenure\s+of)\s+(?:of\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s*(?:\+|plus)?\s*(?:years?|yrs?|months?|decades?))\b/i;

export function assertMinimumTenureSupport(text: string): void {
  if (!TENURE_DURATION_PATTERN.test(text)) {
    throw new Error('MINIMUM_TENURE requires an exact source-bound duration threshold');
  }
}

const DEGREE_CREDENTIAL_PATTERN = /\b(?:degrees?|bachelor(?:'s)?|masters?(?:'s)?|doctor(?:ate|al)?|ph\.?d|b\.?tech|b\.?e\.?|b\.?sc|b\.?com|b\.?ba|m\.?tech|m\.?e\.?|m\.?sc|m\.?com|m\.?ba|diplomas?|(?:undergraduate|post[- ]?graduate|graduate)\s+(?:degree|diploma)s?|educational\s+qualification|academic\s+degree)\b/i;

const LICENSE_CREDENTIAL_PATTERN = /\b(?:licen[sc]es?|licen[sc]ed|licen[sc]ure|bar\s+admi(?:ssion|tted))\b/i;

const CERTIFICATION_CREDENTIAL_PATTERN = /\b(?:certif(?:ied|ication|icate)s?|accredit(?:ed|ation)|board\s+certified)\b/i;

const PROFESSIONAL_QUALIFICATION_PATTERN = /\b(?:chartered|professional\s+qualification|professional\s+designation|cpa|ca|cfa|pmp|cima|acca)\b/i;

const PROFESSIONAL_REGISTRATION_PATTERN = /\b(?:professional\s+registration|registered\s+with|board\s+registered|registered\s+(?:professional|practitioner|engineer|architect|nurse|physician|member)|registration\s+with)\b/i;

export function assertMandatoryCredentialSupport(text: string, kind: MandatoryCredentialKind): void {
  switch (kind) {
    case 'DEGREE':
      if (!DEGREE_CREDENTIAL_PATTERN.test(text)) {
        throw new Error('MANDATORY_CREDENTIAL with DEGREE requires source text denoting an academic degree or educational qualification');
      }
      return;
    case 'LICENSE':
      if (!LICENSE_CREDENTIAL_PATTERN.test(text)) {
        throw new Error('MANDATORY_CREDENTIAL with LICENSE requires source text denoting licensing or licensure');
      }
      return;
    case 'CERTIFICATION':
      if (!CERTIFICATION_CREDENTIAL_PATTERN.test(text)) {
        throw new Error('MANDATORY_CREDENTIAL with CERTIFICATION requires source text denoting certification or certified status');
      }
      return;
    case 'PROFESSIONAL_QUALIFICATION':
      if (!PROFESSIONAL_QUALIFICATION_PATTERN.test(text)) {
        throw new Error('MANDATORY_CREDENTIAL with PROFESSIONAL_QUALIFICATION requires source text denoting a formal professional qualification or designation');
      }
      return;
    case 'PROFESSIONAL_REGISTRATION':
      if (!PROFESSIONAL_REGISTRATION_PATTERN.test(text)) {
        throw new Error('MANDATORY_CREDENTIAL with PROFESSIONAL_REGISTRATION requires source text denoting professional registration');
      }
      return;
  }
}

const PRIOR_EXPERIENCE_PATTERN = /\b(?:(?:prior|previous|past|demonstrated|proven|hands-on|professional|work|industry|relevant|direct|extensive|solid|practical)\s+experience|experience\s+(?:in|with|of|leading|managing|building|scaling|developing|delivering|driving|integrating|supporting|designing|operating|executing|working)|years\s+of\s+experience|track\s+record|prior\s+(?:background|roles?|work|delivery)|career\s+(?:history|background)|history\s+of|worked\s+with|exposure\s+to|demonstrated\s+(?:experience|track\s+record|history))\b/i;

export function assertPriorExperienceSupport(text: string): void {
  if (!PRIOR_EXPERIENCE_PATTERN.test(text)) {
    throw new Error('PRIOR_RELEVANT_EXPERIENCE requires exact source-bound retrospective experience');
  }
}

const ELIGIBILITY_PATTERN = /\b(?:citizenship|citizen|work\s+authoriz(?:ation|ed)|visa\s*(?:status|sponsorship)?|security\s+clearance|background\s+check|drug\s+screen(?:ing)?|legally\s+authorized|right\s+to\s+work|permanent\s+resident|regulatory\s+clearance)\b/i;

export function assertEligibilitySupport(text: string): void {
  if (!ELIGIBILITY_PATTERN.test(text)) {
    throw new Error('ELIGIBILITY_CONDITION requires an exact source-bound candidate eligibility condition');
  }
}

const QUALIFYING_ARTIFACT_PATTERN = /\b(?:portfolio|work\s+samples?|writing\s+samples?|code\s+samples?|repositor(?:y|ies)|github|case\s+stud(?:y|ies)\s+submission|transcripts?|publications?|dossier|writing\s+exercise|assessment\s+submission)\b/i;

export function assertQualifyingArtifactSupport(text: string): void {
  if (!QUALIFYING_ARTIFACT_PATTERN.test(text)) {
    throw new Error('QUALIFYING_ARTIFACT requires an exact source-bound proof or submission artifact');
  }
}

const EXPLICIT_SHORTLIST_PATTERN = /\b(?:only\s+candidates|will\s+not\s+be\s+considered|must\s+have\s+.*\s+to\s+be\s+considered|required\s+for\s+shortlisting|prerequisite\s+for\s+(?:consideration|shortlisting|interview)|strictly\s+required\s+for\s+consideration|mandatory\s+for\s+consideration|disqualif(?:ied|ying|y)|shortlist(?:ing)?\s+criteria|considered\s+only\s+if)\b/i;

export function assertExplicitShortlistSupport(text: string): void {
  if (!EXPLICIT_SHORTLIST_PATTERN.test(text)) {
    throw new Error('EXPLICIT_SHORTLIST_CONDITION requires exact source-bound selection or shortlisting language');
  }
}

export function materializeStagedScreeningAdjudication(
  value: unknown,
  requirement: StagedRoleRequirement,
  exactJdEvidence: readonly string[] = [],
): StagedScreeningAdjudication & { screeningGate: boolean } {
  const parsed = stagedScreeningAdjudicationSchema.parse(value);
  if (parsed.screeningFunction === 'ENTRY_QUALIFICATION' && parsed.gateBasis === 'NONE') {
    throw new Error('An entry qualification needs a stated gate basis');
  }
  if (parsed.screeningFunction === 'ROLE_PERFORMANCE_REQUIREMENT' && parsed.gateBasis !== 'NONE') {
    throw new Error('A role-performance requirement cannot carry an entry gate basis');
  }
  if (parsed.screeningFunction === 'ROLE_PERFORMANCE_REQUIREMENT' && parsed.basisSupport.kind !== 'NONE') {
    throw new Error('A role-performance requirement cannot carry basis support');
  }
  if (parsed.screeningFunction === 'ENTRY_QUALIFICATION' && parsed.basisSupport.kind !== parsed.gateBasis) {
    throw new Error('Gate basis and basisSupport kind must match');
  }
  if (requirement.strength === 'PREFERRED' && parsed.screeningFunction === 'ENTRY_QUALIFICATION') {
    throw new Error('A preferred requirement cannot become an entry qualification');
  }
  if (parsed.screeningFunction === 'ENTRY_QUALIFICATION') {
    if (!exactJdEvidence.length) {
      throw new Error('Entry qualification requires cited exact JD evidence');
    }
    if (!exactJdEvidence.some(quote => quote.includes(parsed.exactSourceQuote))) {
      throw new Error('Entry qualification exactSourceQuote is not contained in the cited JD evidence');
    }
    switch (parsed.basisSupport.kind) {
      case 'MINIMUM_TENURE':
        assertExactContainedSpan(parsed.basisSupport.thresholdText, parsed.exactSourceQuote, 'thresholdText');
        assertMinimumTenureSupport(parsed.basisSupport.thresholdText);
        break;
      case 'MANDATORY_CREDENTIAL':
        assertExactContainedSpan(parsed.basisSupport.credentialText, parsed.exactSourceQuote, 'credentialText');
        assertMandatoryCredentialSupport(parsed.basisSupport.credentialText, parsed.basisSupport.credentialKind);
        break;
      case 'PRIOR_RELEVANT_EXPERIENCE':
        assertExactContainedSpan(parsed.basisSupport.experienceText, parsed.exactSourceQuote, 'experienceText');
        assertPriorExperienceSupport(parsed.basisSupport.experienceText);
        break;
      case 'ELIGIBILITY_CONDITION':
        assertExactContainedSpan(parsed.basisSupport.conditionText, parsed.exactSourceQuote, 'conditionText');
        assertEligibilitySupport(parsed.basisSupport.conditionText);
        break;
      case 'QUALIFYING_ARTIFACT':
        assertExactContainedSpan(parsed.basisSupport.artifactText, parsed.exactSourceQuote, 'artifactText');
        assertQualifyingArtifactSupport(parsed.basisSupport.artifactText);
        break;
      case 'EXPLICIT_SHORTLIST_CONDITION':
        assertExactContainedSpan(parsed.basisSupport.selectionConditionText, parsed.exactSourceQuote, 'selectionConditionText');
        assertExplicitShortlistSupport(parsed.basisSupport.selectionConditionText);
        break;
    }
  }
  return {
    ...parsed,
    screeningGate: requirement.strength === 'REQUIRED'
      && parsed.screeningFunction === 'ENTRY_QUALIFICATION'
      && parsed.gateBasis !== 'NONE',
  };
}

export const stagedGapNatureSchema = z.enum([
  'PARTIAL_EVIDENCE',
  'MISSING_ARTIFACT',
  'MISSING_EXPERIENCE',
  'AFFIRMATIVE_CONFLICT',
]);
export type StagedGapNature = z.infer<typeof stagedGapNatureSchema>;

export const stagedGapResponseSchema = z.object({
  gapNature: stagedGapNatureSchema,
  reasoning: z.string().min(1),
});

const decisionHingeSchema = z.object({
  requirementIds: z.array(z.string()),
  resolutionFields: z.array(z.string()),
}).strict();
const reopeningConditionSchema = z.object({
  requirementIds: z.array(z.string()).min(1),
}).strict();
const careerCapitalAxisSchema = z.object({
  material: z.boolean(),
  candidateClaimIds: z.array(z.string()),
  operatingConditionIds: z.array(z.string()),
  resolutionFields: z.array(z.string()),
}).strict();

export const stagedCareerCapitalSchema = z.object({
  authority: careerCapitalAxisSchema,
  scope: careerCapitalAxisSchema,
  functionalAltitude: careerCapitalAxisSchema,
  compensation: careerCapitalAxisSchema,
}).strict();
export type StagedCareerCapital = z.infer<typeof stagedCareerCapitalSchema>;

export const stagedDecisionProposalSchema = z.object({
  screeningViability: z.enum(['STRONG', 'PLAUSIBLE', 'FRAGILE', 'BLOCKED']),
  verdict: z.enum(['PURSUE', 'CONSIDER', 'PASS']),
  decisionHinges: z.array(decisionHingeSchema).min(1),
  reopeningConditions: z.array(reopeningConditionSchema),
}).strict();

export const stagedDecisionModelSchema = stagedDecisionProposalSchema.extend({
  screeningDriverRequirementIds: z.array(z.string()),
  careerCapital: stagedCareerCapitalSchema,
}).strict();

export type StagedDecisionModel = z.infer<typeof stagedDecisionModelSchema>;
export type ScreeningConstraint = 'NONE' | 'MAX_FRAGILE' | 'BLOCKED_REQUIRED';

const stagedDecisionResolutionDraftSchema = z.object({
  field: z.string().min(1),
  status: z.enum(['RESOLVED', 'INFERRED', 'OPEN']),
  value: z.union([z.string(), z.number(), z.array(z.string()), z.array(z.number())]).nullable(),
  claimIds: z.array(z.string()),
  methods: z.array(z.enum(operations)).min(1),
  question: z.string().min(1).optional(),
}).strict();

export const stagedDecisionResolutionResponseSchema = z.object({
  resolutions: z.array(stagedDecisionResolutionDraftSchema).min(1),
}).strict();

export type StagedDecisionResolutionDraft = z.infer<typeof stagedDecisionResolutionDraftSchema>;

export function materializeStagedDecisionResolutions(
  drafts: StagedDecisionResolutionDraft[],
): z.infer<typeof resolutionSchema>[] {
  return drafts.map(draft => resolutionSchema.parse({
    ...draft,
    consequence: `${draft.field} remains a decision-relevant role and opportunity field.`,
  }));
}

export function validateStagedCareerCapital(
  value: unknown,
  role: StagedRoleAnalysis,
  resolutions: z.infer<typeof resolutionSchema>[],
  candidateClaims: Claim[],
): StagedCareerCapital {
  const parsed = stagedCareerCapitalSchema.parse(value);
  const operatingIds = new Set(role.operatingConditions.map(item => item.id));
  const resolutionFields = new Set(resolutions.map(item => item.field));
  const candidateIds = new Set(candidateClaims.map(item => item.id));

  for (const [axis, judgment] of Object.entries(parsed)) {
    exactIds(judgment.candidateClaimIds, candidateIds, `${axis} career-capital candidate claim`);
    exactIds(judgment.operatingConditionIds, operatingIds, `${axis} career-capital operating condition`);
    exactIds(judgment.resolutionFields, resolutionFields, `${axis} career-capital resolution field`);
    const supportCount = judgment.candidateClaimIds.length
      + judgment.operatingConditionIds.length
      + judgment.resolutionFields.length;
    if (judgment.material && !supportCount) {
      throw new Error(`Material ${axis} career-capital axis needs immutable supporting references`);
    }
    if (!judgment.material && supportCount) {
      throw new Error(`Non-material ${axis} career-capital axis cannot carry supporting references`);
    }
  }
  return parsed;
}

export type StagedScreeningDriver = StagedMappedRequirement & {
  gapNature: StagedGapNature;
  gapReasoning: string;
};

export interface StagedDecisionTrace {
  role: StagedRoleAnalysis;
  requirements: StagedMappedRequirement[];
  resolutions: z.infer<typeof resolutionSchema>[];
  eligibleScreeningDrivers: StagedScreeningDriver[];
  screeningConstraint: ScreeningConstraint;
  decision: StagedDecisionModel;
}

export interface StagedDecisionResult {
  decision: StagedDecisionModel;
  trace: StagedDecisionTrace;
}

function exactIds(ids: readonly string[], known: Set<string>, label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} reference`);
  const unknown = ids.find(id => !known.has(id));
  if (unknown) throw new Error(`Unknown ${label} reference: ${unknown}`);
}

export function validateStagedGap(
  value: unknown,
  requirement: StagedMappedRequirement,
) {
  const parsed = stagedGapResponseSchema.parse(value);
  if (requirement.status === 'CONTRADICTED' && parsed.gapNature !== 'AFFIRMATIVE_CONFLICT') {
    throw new Error('A contradicted screening gate must be classified as AFFIRMATIVE_CONFLICT');
  }
  if (requirement.status !== 'CONTRADICTED' && parsed.gapNature === 'AFFIRMATIVE_CONFLICT') {
    throw new Error('AFFIRMATIVE_CONFLICT requires an immutable CONTRADICTED mapping');
  }
  return parsed;
}

export function screeningConstraintForDrivers(
  drivers: StagedScreeningDriver[],
): ScreeningConstraint {
  if (drivers.some(driver => ['MISSING_EXPERIENCE', 'AFFIRMATIVE_CONFLICT'].includes(driver.gapNature))) {
    return 'BLOCKED_REQUIRED';
  }
  if (drivers.length) return 'MAX_FRAGILE';
  return 'NONE';
}

export function validateStagedDecisionModel(
  value: unknown,
  requirements: StagedMappedRequirement[],
  drivers: StagedScreeningDriver[],
  role: StagedRoleAnalysis,
  resolutions: z.infer<typeof resolutionSchema>[],
  careerCapital: StagedCareerCapital,
): StagedDecisionModel {
  const parsed = stagedDecisionProposalSchema.parse(value);
  const operatingIds = new Set(role.operatingConditions.map(item => item.id));
  const resolutionFields = new Set(resolutions.map(item => item.field));

  const screeningDriverRequirementIds = drivers.map(driver => driver.id);
  const constraint = screeningConstraintForDrivers(drivers);

  if (constraint === 'BLOCKED_REQUIRED' && parsed.screeningViability !== 'BLOCKED') {
    throw new Error('Substantive unresolved screening gates require BLOCKED screening viability');
  }
  if (constraint === 'MAX_FRAGILE' && ['STRONG', 'PLAUSIBLE'].includes(parsed.screeningViability)) {
    throw new Error('An unresolved screening gate cannot produce STRONG or PLAUSIBLE screening viability');
  }
  if (constraint === 'NONE' && ['FRAGILE', 'BLOCKED'].includes(parsed.screeningViability)) {
    throw new Error('FRAGILE or BLOCKED screening viability requires an unresolved screening gate');
  }
  if (constraint === 'BLOCKED_REQUIRED') {
    const substantiveSelected = drivers.some(driver =>
      ['MISSING_EXPERIENCE', 'AFFIRMATIVE_CONFLICT'].includes(driver.gapNature)
    );
    if (!substantiveSelected) {
      throw new Error('BLOCKED screening viability must identify a substantive unresolved screening driver');
    }
  }
  if (parsed.screeningViability === 'BLOCKED' && parsed.verdict !== 'PASS') {
    throw new Error('BLOCKED screening viability requires verdict PASS');
  }
  if (parsed.screeningViability === 'BLOCKED' && !screeningDriverRequirementIds.length) {
    throw new Error('BLOCKED screening viability requires an eligible screening driver');
  }

  const nonDirectRequirementIds = new Set(
    requirements.filter(item => item.status !== 'DIRECT').map(item => item.id),
  );
  for (const hinge of parsed.decisionHinges) {
    exactIds(hinge.requirementIds, nonDirectRequirementIds, 'decision-hinge unresolved requirement');
    exactIds(hinge.resolutionFields, resolutionFields, 'decision-hinge resolution field');
    if (!hinge.requirementIds.length && !hinge.resolutionFields.length) {
      throw new Error('Decision hinge needs an unresolved requirement or resolution reference');
    }
  }
  for (const condition of parsed.reopeningConditions) {
    exactIds(condition.requirementIds, nonDirectRequirementIds, 'reopening-condition unresolved requirement');
  }

  return stagedDecisionModelSchema.parse({ ...parsed, screeningDriverRequirementIds, careerCapital });
}
