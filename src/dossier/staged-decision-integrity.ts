import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { resolutionSchema, type Dossier } from './contracts';
import {
  screeningConstraintForDrivers,
  stagedDecisionModelSchema,
  stagedGapNatureSchema,
  stagedScreeningFunctionSchema,
  stagedScreeningGateBasisSchema,
  validateStagedDecisionModel,
  type StagedDecisionResult,
  type StagedDecisionTrace,
} from './staged-decision-contract';

const requirementSchema = z.object({
  id: z.string().min(1),
  requirement: z.string().min(1),
  strength: z.enum(['REQUIRED', 'PREFERRED']),
  roleImportance: z.enum(['CORE_CAPABILITY', 'ENABLER']),
  roleClaimIds: z.array(z.string()).min(1),
  reasoning: z.string().min(1),
  screeningGate: z.boolean(),
  screeningFunction: stagedScreeningFunctionSchema,
  screeningGateBasis: stagedScreeningGateBasisSchema,
  screeningSupportQuoteIds: z.array(z.string()).min(1),
  screeningReasoning: z.string().min(1),
  status: z.enum(['DIRECT', 'ADJACENT', 'TRANSFERABLE', 'NOT_EVIDENCED', 'CONTRADICTED']),
  candidateClaimIds: z.array(z.string()),
  unsupportedAspects: z.array(z.string()),
  mappingReasoning: z.string().min(1),
}).passthrough();

const screeningDriverSchema = requirementSchema.extend({
  gapNature: stagedGapNatureSchema,
  gapReasoning: z.string().min(1),
}).passthrough();

const roleSchema = z.object({
  requirements: z.array(z.unknown()),
  operatingConditions: z.array(z.unknown()),
  authorityShape: z.string(),
  roleSideConditions: z.array(z.unknown()),
}).passthrough();

const traceSchema = z.object({
  role: roleSchema,
  requirements: z.array(requirementSchema).min(1),
  resolutions: z.array(resolutionSchema),
  eligibleScreeningDrivers: z.array(screeningDriverSchema),
  screeningConstraint: z.enum(['NONE', 'MAX_FRAGILE', 'BLOCKED_REQUIRED']),
  decision: stagedDecisionModelSchema,
}).passthrough();

const resultSchema = z.object({
  decision: stagedDecisionModelSchema,
  trace: traceSchema,
}).passthrough();

export type CanonicalStagedDecisionTrace = StagedDecisionTrace & {
  requirements: Array<StagedDecisionTrace['requirements'][number] & { screeningSupportQuoteIds: string[] }>;
  eligibleScreeningDrivers: Array<StagedDecisionTrace['eligibleScreeningDrivers'][number] & { screeningSupportQuoteIds: string[] }>;
};

export type CanonicalStagedDecisionResult = StagedDecisionResult & {
  trace: CanonicalStagedDecisionTrace;
};

function assertPersistedScreeningSemantics(
  requirement: CanonicalStagedDecisionTrace['requirements'][number],
) {
  if (new Set(requirement.screeningSupportQuoteIds).size !== requirement.screeningSupportQuoteIds.length) {
    throw new Error('STAGED_EVALUATION_DUPLICATE_SCREENING_SUPPORT_QUOTE_ID');
  }
  if (requirement.strength === 'PREFERRED' && requirement.screeningFunction === 'ENTRY_QUALIFICATION') {
    throw new Error('STAGED_EVALUATION_PREFERRED_ENTRY_QUALIFICATION');
  }
  if (requirement.screeningFunction === 'ENTRY_QUALIFICATION' && requirement.screeningGateBasis === 'NONE') {
    throw new Error('STAGED_EVALUATION_ENTRY_WITHOUT_GATE_BASIS');
  }
  if (requirement.screeningFunction === 'ROLE_PERFORMANCE_REQUIREMENT' && requirement.screeningGateBasis !== 'NONE') {
    throw new Error('STAGED_EVALUATION_ROLE_PERFORMANCE_WITH_GATE_BASIS');
  }

  const expectedGate =
    requirement.strength === 'REQUIRED'
    && requirement.screeningFunction === 'ENTRY_QUALIFICATION'
    && requirement.screeningGateBasis !== 'NONE';
  if (requirement.screeningGate !== expectedGate) {
    throw new Error('STAGED_EVALUATION_SCREENING_GATE_DERIVATION_MISMATCH');
  }
}

/**
 * Staged evaluations are persisted as JSON, so validate the semantic structures
 * that must survive every downstream transition before treating them as authority.
 */
export function parseCanonicalStagedDecisionResult(value: unknown): CanonicalStagedDecisionResult {
  resultSchema.parse(value);
  const result = value as CanonicalStagedDecisionResult;
  if (!isDeepStrictEqual(result.decision, result.trace.decision)) {
    throw new Error('STAGED_EVALUATION_DECISION_TRACE_MISMATCH');
  }

  const ids = result.trace.requirements.map(requirement => requirement.id);
  if (new Set(ids).size !== ids.length) throw new Error('STAGED_EVALUATION_DUPLICATE_REQUIREMENT_ID');
  const requirementsById = new Map(result.trace.requirements.map(requirement => [requirement.id, requirement]));
  for (const requirement of result.trace.requirements) assertPersistedScreeningSemantics(requirement);

  const expectedDrivers = result.trace.requirements.filter(
    requirement => requirement.screeningGate && requirement.status !== 'DIRECT',
  );
  const expectedDriverIds = expectedDrivers.map(driver => driver.id);
  const actualDriverIds = result.trace.eligibleScreeningDrivers.map(driver => driver.id);
  if (!isDeepStrictEqual(actualDriverIds, expectedDriverIds)) {
    throw new Error('STAGED_EVALUATION_SCREENING_DRIVER_DERIVATION_MISMATCH');
  }

  for (const driver of result.trace.eligibleScreeningDrivers) {
    const requirement = requirementsById.get(driver.id);
    if (!requirement) throw new Error('STAGED_EVALUATION_UNKNOWN_SCREENING_DRIVER');
    const { gapNature, gapReasoning, ...driverRequirement } = driver;
    if (!isDeepStrictEqual(driverRequirement, requirement)) {
      throw new Error('STAGED_EVALUATION_SCREENING_DRIVER_REQUIREMENT_MISMATCH');
    }
    if (requirement.status === 'CONTRADICTED' && gapNature !== 'AFFIRMATIVE_CONFLICT') {
      throw new Error('STAGED_EVALUATION_CONTRADICTED_DRIVER_GAP_MISMATCH');
    }
    if (requirement.status !== 'CONTRADICTED' && gapNature === 'AFFIRMATIVE_CONFLICT') {
      throw new Error('STAGED_EVALUATION_AFFIRMATIVE_CONFLICT_WITHOUT_CONTRADICTION');
    }
    if (!gapReasoning.trim()) throw new Error('STAGED_EVALUATION_EMPTY_SCREENING_GAP_REASONING');
  }

  if (!isDeepStrictEqual(result.decision.screeningDriverRequirementIds, expectedDriverIds)) {
    throw new Error('STAGED_EVALUATION_SCREENING_DRIVER_MISMATCH');
  }
  if (screeningConstraintForDrivers(result.trace.eligibleScreeningDrivers) !== result.trace.screeningConstraint) {
    throw new Error('STAGED_EVALUATION_SCREENING_CONSTRAINT_MISMATCH');
  }

  const {
    screeningDriverRequirementIds: _screeningDriverRequirementIds,
    careerCapital,
    ...decisionProposal
  } = result.decision;
  const replayedDecision = validateStagedDecisionModel(
    decisionProposal,
    result.trace.requirements,
    result.trace.eligibleScreeningDrivers,
    result.trace.role,
    result.trace.resolutions,
    careerCapital,
  );
  if (!isDeepStrictEqual(replayedDecision, result.decision)) {
    throw new Error('STAGED_EVALUATION_DECISION_POLICY_MISMATCH');
  }

  return result;
}

/** Fingerprint the exact evaluated semantic output, not only its frozen input. */
export function createStagedEvaluationFingerprint(args: {
  evaluationContextFingerprint: string;
  inputFingerprint: string;
  evaluation: CanonicalStagedDecisionResult;
}): string {
  return createHash('sha256').update(JSON.stringify({
    context: args.evaluationContextFingerprint,
    input: args.inputFingerprint,
    evaluation: args.evaluation,
  })).digest('hex');
}

/** A rich dossier may explain canonical truth but may never rewrite or compress it. */
export function assertCanonicalDecisionTrace(
  dossier: Pick<Dossier, 'canonicalDecisionTrace'>,
  expected: CanonicalStagedDecisionTrace,
): CanonicalStagedDecisionTrace {
  traceSchema.parse(dossier.canonicalDecisionTrace);
  if (!isDeepStrictEqual(dossier.canonicalDecisionTrace, expected)) {
    throw new Error('DOSSIER_DECISION_TRACE_MISMATCH');
  }
  return dossier.canonicalDecisionTrace as unknown as CanonicalStagedDecisionTrace;
}
