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
export const stagedScreeningGateBasisSchema = z.enum([
  'MINIMUM_TENURE',
  'MANDATORY_CREDENTIAL',
  'PRIOR_RELEVANT_EXPERIENCE',
  'ELIGIBILITY_CONDITION',
  'QUALIFYING_ARTIFACT',
  'EXPLICIT_SHORTLIST_CONDITION',
  'NONE',
]);
export const stagedScreeningAdjudicationSchema = z.object({
  screeningFunction: stagedScreeningFunctionSchema,
  gateBasis: stagedScreeningGateBasisSchema,
  reasoning: z.string().min(1),
  exactSourceQuote: z.string().min(1),
}).strict();
export type StagedScreeningAdjudication = z.infer<typeof stagedScreeningAdjudicationSchema>;

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
  if (requirement.strength === 'PREFERRED' && parsed.screeningFunction === 'ENTRY_QUALIFICATION') {
    throw new Error('A preferred requirement cannot become an entry qualification');
  }
  if (parsed.screeningFunction === 'ENTRY_QUALIFICATION' && exactJdEvidence.length
    && !exactJdEvidence.some(quote => quote.includes(parsed.exactSourceQuote))) {
    throw new Error('Entry qualification exactSourceQuote is not contained in the cited JD evidence');
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
