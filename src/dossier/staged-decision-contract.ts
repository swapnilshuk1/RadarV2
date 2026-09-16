import { z } from 'zod';

import { operations, resolutionSchema, type Claim } from './contracts';
import type {
  StagedMappedRequirement,
  StagedRoleAnalysis,
} from './staged-research';

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
const careerCapitalTradeSchema = z.object({
  material: z.boolean(),
  dimension: z.enum(['AUTHORITY', 'SCOPE', 'FUNCTIONAL_ALTITUDE', 'COMPENSATION', 'NONE']),
  candidateClaimIds: z.array(z.string()),
  operatingConditionIds: z.array(z.string()),
  resolutionFields: z.array(z.string()),
}).strict();

export const stagedDecisionProposalSchema = z.object({
  screeningViability: z.enum(['STRONG', 'PLAUSIBLE', 'FRAGILE', 'BLOCKED']),
  verdict: z.enum(['PURSUE', 'CONSIDER', 'PASS']),
  careerCapitalTrade: careerCapitalTradeSchema,
  decisionHinges: z.array(decisionHingeSchema).min(1),
  reopeningConditions: z.array(reopeningConditionSchema),
}).strict();

export const stagedDecisionModelSchema = stagedDecisionProposalSchema.extend({
  screeningDriverRequirementIds: z.array(z.string()),
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
  candidateClaims: Claim[],
): StagedDecisionModel {
  const parsed = stagedDecisionProposalSchema.parse(value);
  const operatingIds = new Set(role.operatingConditions.map(item => item.id));
  const resolutionFields = new Set(resolutions.map(item => item.field));
  const candidateIds = new Set(candidateClaims.map(item => item.id));

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

  exactIds(parsed.careerCapitalTrade.candidateClaimIds, candidateIds, 'career-capital candidate claim');
  exactIds(parsed.careerCapitalTrade.operatingConditionIds, operatingIds, 'career-capital operating condition');
  exactIds(parsed.careerCapitalTrade.resolutionFields, resolutionFields, 'career-capital resolution field');
  if (parsed.careerCapitalTrade.material) {
    if (parsed.careerCapitalTrade.dimension === 'NONE') {
      throw new Error('A material career-capital trade needs a concrete trade dimension');
    }
    const supportCount = parsed.careerCapitalTrade.candidateClaimIds.length
      + parsed.careerCapitalTrade.operatingConditionIds.length
      + parsed.careerCapitalTrade.resolutionFields.length;
    if (!supportCount) throw new Error('A material career-capital trade needs immutable supporting references');
  } else if (parsed.careerCapitalTrade.dimension !== 'NONE') {
    throw new Error('A non-material career-capital trade must use dimension NONE');
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

  return stagedDecisionModelSchema.parse({ ...parsed, screeningDriverRequirementIds });
}
