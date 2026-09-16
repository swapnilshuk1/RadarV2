import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Claim, EvidenceSource } from './contracts';

export const roleImportanceSchema = z.enum(['CORE_CAPABILITY', 'ENABLER']);
export const requirementStrengthSchema = z.enum(['REQUIRED', 'PREFERRED']);
export const fitStatusSchema = z.enum(['DIRECT', 'ADJACENT', 'TRANSFERABLE', 'NOT_EVIDENCED', 'CONTRADICTED']);

const roleRequirementSchema = z.object({
  id: z.string().min(1),
  requirement: z.string().min(1),
  strength: requirementStrengthSchema,
  roleImportance: roleImportanceSchema,
  screeningGate: z.boolean(),
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

export const candidateMappingSchema = z.object({
  mappings: z.array(z.object({
    requirementId: z.string().min(1),
    status: fitStatusSchema,
    candidateClaimIds: z.array(z.string()),
    reasoning: z.string().min(1),
  })).min(1),
  authorityFacts: z.array(z.object({
    claimIds: z.array(z.string()).min(1),
    observation: z.string().min(1),
  })),
});
export type CandidateMapping = z.infer<typeof candidateMappingSchema>;

export const boundedDecisionSchema = z.object({
  screeningViability: z.enum(['STRONG', 'PLAUSIBLE', 'FRAGILE', 'BLOCKED']),
  screeningRationale: z.string().min(1),
  screeningDriverRequirementIds: z.array(z.string()),
  verdict: z.enum(['PURSUE', 'CONSIDER', 'PASS']),
  decisionRationale: z.string().min(1),
  careerCapitalTrade: z.string().min(1),
  decisionHinges: z.array(z.object({
    statement: z.string().min(1),
    claimIds: z.array(z.string()).min(1),
  })).min(1),
});
export type BoundedDecision = z.infer<typeof boundedDecisionSchema>;

// Temporary fail-closed safety rail for this shadow experiment. This is not a
// production Role Requirement Compiler and must not grow into a phrase ontology.
const entryQualification = /\b(?:required|must(?:\s+have)?|minimum|eligib(?:le|ility)|qualification|prior experience|relevant experience|years? of experience|proven track record|portfolio)\b/i;
const employmentCondition = /\b(?:compensation|salary|ctc|pay|on[- ]?site|remote|hybrid|location|relocat)\b/i;

function exactIds(ids: readonly string[], known: Set<string>, label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} claim reference`);
  if (ids.some(id => !known.has(id))) throw new Error(`Unknown ${label} claim reference`);
}

export function stageFingerprint(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input, (_key, value) => _key === 'capturedAt' ? undefined : value))
    .digest('hex');
}

export function validateRoleAnalyticalCore(
  value: unknown,
  roleClaims: Claim[],
  sources: EvidenceSource[],
): RoleAnalyticalCore {
  const core = roleAnalyticalCoreSchema.parse(value);
  const known = new Set(roleClaims.map(claim => claim.id));
  const byId = new Map(roleClaims.map(claim => [claim.id, claim]));
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const ids = new Set<string>();

  for (const requirement of core.requirements) {
    if (!ids.add(requirement.id)) throw new Error(`Duplicate role requirement: ${requirement.id}`);
    exactIds(requirement.roleClaimIds, known, 'role requirement');

    if (requirement.screeningGate && requirement.strength !== 'REQUIRED') {
      throw new Error('A screening gate must be a required candidate requirement');
    }

    if (requirement.screeningGate) {
      if (employmentCondition.test(requirement.requirement)) {
        throw new Error('Employment conditions are not candidate-evidence screening gates');
      }

      const evidence = requirement.roleClaimIds
        .flatMap(id => {
          const claim = byId.get(id);
          if (!claim) return [];
          const jdQuotes = (claim.citations ?? [])
            .filter(citation => sourceById.get(citation.sourceId)?.plane === 'JD')
            .map(citation => citation.quote);
          return [claim.text, ...jdQuotes];
        })
        .join(' ');

      if (!entryQualification.test(evidence)) {
        throw new Error(`Screening gate '${requirement.requirement}' needs an explicit employer entry qualification in its cited JD evidence`);
      }
    }
  }

  const operatingIds = new Set<string>();
  for (const condition of core.operatingConditions) {
    if (!operatingIds.add(condition.id)) throw new Error(`Duplicate role operating condition: ${condition.id}`);
    exactIds(condition.roleClaimIds, known, 'role operating condition');
  }
  for (const condition of core.roleSideConditions) {
    exactIds(condition.roleClaimIds, known, 'role-side condition');
  }

  const requirementClaimIds = new Set(core.requirements.flatMap(item => item.roleClaimIds));
  const operatingClaimIds = new Set(core.operatingConditions.flatMap(item => item.roleClaimIds));
  for (const id of operatingClaimIds) {
    if (requirementClaimIds.has(id)) {
      throw new Error('A role operating condition cannot also be a candidate requirement');
    }
  }

  return core;
}

export function validateCandidateMapping(
  value: unknown,
  role: RoleAnalyticalCore,
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

    exactIds(item.candidateClaimIds, candidateIds, 'candidate mapping');

    if (['DIRECT', 'ADJACENT', 'TRANSFERABLE'].includes(item.status) && !item.candidateClaimIds.length) {
      throw new Error('Positive fit mapping needs candidate proof');
    }

    if (item.status === 'CONTRADICTED' && !item.candidateClaimIds.length) {
      throw new Error('Contradicted fit mapping needs affirmative candidate evidence');
    }
  }

  if (seen.size !== requiredIds.size) {
    throw new Error('Candidate mapping omitted an immutable role requirement');
  }

  for (const fact of mapping.authorityFacts) {
    exactIds(fact.claimIds, candidateIds, 'candidate authority fact');
  }

  return mapping;
}

export function validateBoundedDecision(
  value: unknown,
  role: RoleAnalyticalCore,
  mapping: CandidateMapping,
  contextClaims: Claim[],
  candidateClaims: Claim[],
): BoundedDecision {
  const decision = boundedDecisionSchema.parse(value);

  const requirementIds = new Set(role.requirements.map(item => item.id));
  exactIds(decision.screeningDriverRequirementIds, requirementIds, 'screening driver');

  const requirementsById = new Map(role.requirements.map(item => [item.id, item]));
  for (const id of decision.screeningDriverRequirementIds) {
    if (!requirementsById.get(id)?.screeningGate) {
      throw new Error(`Screening driver '${id}' is not an explicit screening gate`);
    }
  }

  const validIds = new Set([
    ...role.requirements.flatMap(item => item.roleClaimIds),
    ...role.operatingConditions.flatMap(item => item.roleClaimIds),
    ...role.roleSideConditions.flatMap(item => item.roleClaimIds),
    ...mapping.mappings.flatMap(item => item.candidateClaimIds),
    ...mapping.authorityFacts.flatMap(item => item.claimIds),
    ...contextClaims.map(item => item.id),
    ...candidateClaims.map(item => item.id),
  ]);
  for (const hinge of decision.decisionHinges) {
    exactIds(hinge.claimIds, validIds, 'decision hinge');
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
  }

  return decision;
}

export function assembleBoundedAnalyticalResult(
  role: RoleAnalyticalCore,
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
