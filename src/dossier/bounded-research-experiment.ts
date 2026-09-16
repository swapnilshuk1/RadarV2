import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Claim } from './contracts';

export const roleImportanceSchema = z.enum(['CORE_CAPABILITY', 'ENABLER']);
export const requirementStrengthSchema = z.enum(['REQUIRED', 'PREFERRED']);
export const fitStatusSchema = z.enum(['DIRECT', 'ADJACENT', 'TRANSFERABLE', 'NOT_EVIDENCED', 'CONTRADICTED']);

const roleRequirementSchema = z.object({
  id: z.string().min(1),
  requirement: z.string().min(1),
  strength: requirementStrengthSchema,
  roleImportance: roleImportanceSchema,
  roleClaimIds: z.array(z.string()).min(1),
  reasoning: z.string().min(1),
});

const roleOperatingConditionSchema = z.object({
  id: z.string().min(1),
  condition: z.string().min(1),
  kind: z.enum(['OPERATING_SHAPE', 'AUTHORITY_SHAPE', 'EMPLOYMENT_CONDITION']),
  roleClaimIds: z.array(z.string()).min(1),
  reasoning: z.string().min(1),
});

export const roleAnalyticalCoreSchema = z.object({
  requirements: z.array(roleRequirementSchema).min(1),
  operatingConditions: z.array(roleOperatingConditionSchema),
  authorityShape: z.string().min(1),
  roleSideConditions: z.array(z.object({
    condition: z.string().min(1),
    roleClaimIds: z.array(z.string()).min(1),
  })),
});
export type RoleAnalyticalCore = z.infer<typeof roleAnalyticalCoreSchema>;

export const screeningAdjudicationSchema = z.object({
  decisions: z.array(z.object({
    requirementId: z.string().min(1),
    screeningGate: z.boolean(),
    reasoning: z.string().min(1),
  })).min(1),
});
export type ScreeningAdjudication = z.infer<typeof screeningAdjudicationSchema>;

const screenedRoleRequirementSchema = roleRequirementSchema.extend({
  screeningGate: z.boolean(),
});

export const screenedRoleAnalyticalCoreSchema = roleAnalyticalCoreSchema.extend({
  requirements: z.array(screenedRoleRequirementSchema).min(1),
});
export type ScreenedRoleAnalyticalCore = z.infer<typeof screenedRoleAnalyticalCoreSchema>;

export const candidateMappingSchema = z.object({
  mappings: z.array(z.object({
    requirementId: z.string().min(1),
    status: fitStatusSchema,
    candidateClaimIds: z.array(z.string()),
    unsupportedAspects: z.array(z.string()),
    reasoning: z.string().min(1),
  })).min(1),
  authorityFacts: z.array(z.object({
    claimIds: z.array(z.string()).min(1),
    observation: z.string().min(1),
  })),
});
export type CandidateMapping = z.infer<typeof candidateMappingSchema>;

const decisionReferenceSchema = z.object({
  kind: z.enum([
    'ROLE_REQUIREMENT',
    'ROLE_CLAIM',
    'CANDIDATE_CLAIM',
    'CONTEXT_CLAIM',
    'OPERATING_CONDITION',
  ]),
  id: z.string().min(1),
});

export const boundedDecisionSchema = z.object({
  screeningViability: z.enum(['STRONG', 'PLAUSIBLE', 'FRAGILE', 'BLOCKED']),
  screeningRationale: z.string().min(1),
  screeningDriverRequirementIds: z.array(z.string()),
  verdict: z.enum(['PURSUE', 'CONSIDER', 'PASS']),
  decisionRationale: z.string().min(1),
  careerCapitalTrade: z.string().min(1),
  decisionHinges: z.array(z.object({
    statement: z.string().min(1),
    refs: z.array(decisionReferenceSchema).min(1),
  })).min(1),
});
export type BoundedDecision = z.infer<typeof boundedDecisionSchema>;

function exactIds(ids: readonly string[], known: Set<string>, label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} reference`);
  if (ids.some(id => !known.has(id))) throw new Error(`Unknown ${label} reference`);
}

export function stageFingerprint(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input, (_key, value) => _key === 'capturedAt' ? undefined : value))
    .digest('hex');
}

export function validateRoleAnalyticalCore(
  value: unknown,
  roleClaims: Claim[],
): RoleAnalyticalCore {
  const core = roleAnalyticalCoreSchema.parse(value);
  const known = new Set(roleClaims.map(claim => claim.id));
  const requirementIds = new Set<string>();

  for (const requirement of core.requirements) {
    if (!requirementIds.add(requirement.id)) throw new Error(`Duplicate role requirement: ${requirement.id}`);
    exactIds(requirement.roleClaimIds, known, 'role requirement claim');
  }

  const operatingIds = new Set<string>();
  for (const condition of core.operatingConditions) {
    if (!operatingIds.add(condition.id)) throw new Error(`Duplicate role operating condition: ${condition.id}`);
    exactIds(condition.roleClaimIds, known, 'role operating condition claim');
  }

  for (const condition of core.roleSideConditions) {
    exactIds(condition.roleClaimIds, known, 'role-side condition claim');
  }

  // A single JD claim may legitimately support more than one derived semantic
  // conclusion (for example both a candidate capability and an authority-shape
  // inference). Evidence ancestry is therefore not mutually exclusive.
  return core;
}

export function validateScreeningAdjudication(
  value: unknown,
  role: RoleAnalyticalCore,
): ScreeningAdjudication {
  const adjudication = screeningAdjudicationSchema.parse(value);
  const requirementIds = new Set(role.requirements.map(requirement => requirement.id));
  const requirementsById = new Map(role.requirements.map(requirement => [requirement.id, requirement]));
  const seen = new Set<string>();

  for (const decision of adjudication.decisions) {
    if (!requirementIds.has(decision.requirementId) || !seen.add(decision.requirementId)) {
      throw new Error(`Screening adjudication must decide each immutable role requirement once: ${decision.requirementId}`);
    }

    const requirement = requirementsById.get(decision.requirementId)!;
    if (decision.screeningGate && requirement.strength !== 'REQUIRED') {
      throw new Error('A preferred requirement cannot become a screening gate');
    }
  }

  if (seen.size !== requirementIds.size) {
    throw new Error('Screening adjudication omitted an immutable role requirement');
  }

  return adjudication;
}

export function applyScreeningAdjudication(
  role: RoleAnalyticalCore,
  adjudication: ScreeningAdjudication,
): ScreenedRoleAnalyticalCore {
  const byRequirement = new Map(
    adjudication.decisions.map(decision => [decision.requirementId, decision]),
  );

  return screenedRoleAnalyticalCoreSchema.parse({
    ...role,
    requirements: role.requirements.map(requirement => ({
      ...requirement,
      screeningGate: byRequirement.get(requirement.id)!.screeningGate,
    })),
  });
}

export function validateCandidateMapping(
  value: unknown,
  role: ScreenedRoleAnalyticalCore,
  candidateClaims: Claim[],
): CandidateMapping {
  const mapping = candidateMappingSchema.parse(value);
  const requiredIds = new Set(role.requirements.map(requirement => requirement.id));
  const candidateIds = new Set(candidateClaims.map(claim => claim.id));
  const seen = new Set<string>();

  for (const item of mapping.mappings) {
    if (!requiredIds.has(item.requirementId) || !seen.add(item.requirementId)) {
      throw new Error(`Candidate mapping must map each immutable role requirement once: ${item.requirementId}`);
    }

    exactIds(item.candidateClaimIds, candidateIds, 'candidate mapping claim');

    if (['DIRECT', 'ADJACENT', 'TRANSFERABLE'].includes(item.status) && !item.candidateClaimIds.length) {
      throw new Error('Positive fit mapping needs candidate proof');
    }

    if (item.status === 'CONTRADICTED' && !item.candidateClaimIds.length) {
      throw new Error('Contradicted fit mapping needs affirmative candidate evidence');
    }

    if (item.status === 'DIRECT' && item.unsupportedAspects.length) {
      throw new Error('Direct fit mapping cannot contain unsupported requirement aspects');
    }
  }

  if (seen.size !== requiredIds.size) {
    throw new Error('Candidate mapping omitted an immutable role requirement');
  }

  for (const fact of mapping.authorityFacts) {
    exactIds(fact.claimIds, candidateIds, 'candidate authority fact claim');
  }

  return mapping;
}

export function validateBoundedDecision(
  value: unknown,
  role: ScreenedRoleAnalyticalCore,
  mapping: CandidateMapping,
  contextClaims: Claim[],
  candidateClaims: Claim[],
): BoundedDecision {
  const decision = boundedDecisionSchema.parse(value);

  const requirementIds = new Set(role.requirements.map(item => item.id));
  exactIds(decision.screeningDriverRequirementIds, requirementIds, 'screening driver requirement');

  const requirementsById = new Map(role.requirements.map(item => [item.id, item]));
  for (const id of decision.screeningDriverRequirementIds) {
    if (!requirementsById.get(id)?.screeningGate) {
      throw new Error(`Screening driver '${id}' is not an adjudicated screening gate`);
    }
  }

  const roleClaimIds = new Set([
    ...role.requirements.flatMap(item => item.roleClaimIds),
    ...role.operatingConditions.flatMap(item => item.roleClaimIds),
    ...role.roleSideConditions.flatMap(item => item.roleClaimIds),
  ]);
  const candidateClaimIds = new Set(candidateClaims.map(item => item.id));
  const contextClaimIds = new Set(contextClaims.map(item => item.id));
  const operatingConditionIds = new Set(role.operatingConditions.map(item => item.id));

  for (const hinge of decision.decisionHinges) {
    for (const ref of hinge.refs) {
      const known = ref.kind === 'ROLE_REQUIREMENT'
        ? requirementIds
        : ref.kind === 'ROLE_CLAIM'
          ? roleClaimIds
          : ref.kind === 'CANDIDATE_CLAIM'
            ? candidateClaimIds
            : ref.kind === 'CONTEXT_CLAIM'
              ? contextClaimIds
              : operatingConditionIds;
      if (!known.has(ref.id)) {
        throw new Error(`Unknown ${ref.kind} decision hinge reference: ${ref.id}`);
      }
    }
  }

  const byRequirement = new Map(mapping.mappings.map(item => [item.requirementId, item]));
  const screeningGates = role.requirements.filter(item => item.screeningGate);
  const negativeGateIds = new Set(
    screeningGates
      .filter(item => ['NOT_EVIDENCED', 'CONTRADICTED'].includes(byRequirement.get(item.id)?.status ?? ''))
      .map(item => item.id),
  );

  if (decision.screeningViability === 'STRONG' && negativeGateIds.size) {
    throw new Error('Strong screening viability cannot contain an unsupported or contradicted screening gate');
  }

  if (decision.screeningViability === 'BLOCKED') {
    if (!negativeGateIds.size) {
      throw new Error('Blocked screening viability needs a real screening-gate barrier');
    }
    if (!decision.screeningDriverRequirementIds.some(id => negativeGateIds.has(id))) {
      throw new Error('Blocked screening viability must name the screening-gate barrier as a screening driver');
    }
    if (decision.verdict !== 'PASS') {
      throw new Error('Blocked screening viability requires a PASS verdict');
    }
  }

  return decision;
}

export function assembleBoundedAnalyticalResult(
  role: ScreenedRoleAnalyticalCore,
  mapping: CandidateMapping,
  decision: BoundedDecision,
) {
  const mappingByRequirement = new Map(mapping.mappings.map(item => [item.requirementId, item]));
  return {
    requirements: role.requirements.map(requirement => ({
      ...requirement,
      ...mappingByRequirement.get(requirement.id)!,
    })),
    operatingConditions: role.operatingConditions,
    authorityShape: role.authorityShape,
    roleSideConditions: role.roleSideConditions,
    authorityFacts: mapping.authorityFacts,
    decision,
  };
}
