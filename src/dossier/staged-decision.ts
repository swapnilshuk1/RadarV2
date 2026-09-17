import { createHash } from 'node:crypto';
import { z } from 'zod';

import { type Claim, type ReasoningModel } from './contracts';
import { bedrockJsonSchema } from './bedrock-schema';
import { modelSchema } from './model-schema';
import {
  eligibleScreeningDrivers,
  materializeStagedRoleAnalysis,
  stagedMappingResponseSchema,
  stagedRoleAnalysisSchema,
  type StagedMappedRequirement,
  type StagedResearchInput,
  type StagedRoleRequirement,
} from './staged-research';
import {
  screeningConstraintForDrivers,
  materializeStagedScreeningAdjudication,
  materializeStagedDecisionResolutions,
  stagedCareerCapitalSchema,
  stagedDecisionProposalSchema,
  stagedDecisionResolutionResponseSchema,
  stagedGapResponseSchema,
  validateStagedDecisionModel,
  validateStagedCareerCapital,
  validateStagedGap,
  type StagedDecisionResult,
  type StagedScreeningDriver,
} from './staged-decision-contract';
import {
  materializeStagedScreeningAdjudication as materializeSourceIdScreeningAdjudication,
  stagedDecisionScreeningInstruction as stagedDecisionScreeningInstructionV6,
  stagedScreeningAdjudicationSchema as stagedScreeningAdjudicationSchemaV6,
  type StagedScreeningQuote,
} from './staged-screening';
import {
  stagedDecisionGapInstruction,
  stagedDecisionCareerCapitalInstruction,
  stagedDecisionInstruction,
  stagedDecisionMappingInstruction,
  stagedDecisionResolutionInstruction,
  stagedDecisionRoleInstruction,
} from './staged-decision-prompts';

const verifiedStageResults = new Map<string, unknown>();

function schemaForModel(model: ReasoningModel, schema: z.ZodTypeAny): Record<string, unknown> {
  return /bedrock/i.test(model.id) ? bedrockJsonSchema(schema) : modelSchema(schema);
}

function stageKey(model: ReasoningModel, instruction: string, input: unknown, schema: z.ZodTypeAny): string {
  return createHash('sha256')
    .update(JSON.stringify([
      model.id,
      model.version,
      instruction,
      input,
      schemaForModel(model, schema),
    ], (key, value) => key === 'capturedAt' ? undefined : value))
    .digest('hex');
}

async function proposeStage<T>(
  label: string,
  model: ReasoningModel,
  instruction: string,
  input: unknown,
  schema: z.ZodTypeAny,
  validate: (value: unknown) => T,
  onStage: (stage: string) => void,
): Promise<T> {
  const key = stageKey(model, instruction, input, schema);
  if (verifiedStageResults.has(key)) {
    return validate(structuredClone(verifiedStageResults.get(key)));
  }

  let previous: unknown;
  let issue = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    onStage(attempt ? `${label} — local repair ${attempt}` : label);
    try {
      previous = await model.generate(
        instruction,
        attempt
          ? {
              input,
              previous,
              repair: `Repair only this stage result. Defect: ${issue}. Preserve all immutable upstream judgments and use only supplied identifiers.`,
            }
          : input,
        schemaForModel(model, schema),
      );
      const result = validate(previous);
      if (verifiedStageResults.size >= 256) {
        verifiedStageResults.delete(verifiedStageResults.keys().next().value!);
      }
      verifiedStageResults.set(key, structuredClone(previous));
      return result;
    } catch (error) {
      issue = error instanceof Error ? error.message : 'Invalid stage response';
    }
  }
  throw new Error(`${label} failed after local repair: ${issue}`);
}

function exactIds(ids: readonly string[], known: Set<string>, label: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} reference`);
  const unknown = ids.find(id => !known.has(id));
  if (unknown) throw new Error(`Unknown ${label} reference: ${unknown}`);
}

/** Historical v5 validator retained for direct regression tests only. */
export function validateScreening(
  value: unknown,
  requirement: StagedRoleRequirement,
  exactJdEvidence: readonly string[] = [],
) {
  return materializeStagedScreeningAdjudication(value, requirement, exactJdEvidence);
}

function buildScreeningQuoteCatalog(
  requirement: StagedRoleRequirement,
  roleClaimById: ReadonlyMap<string, Claim>,
  jdSourceIds: ReadonlySet<string>,
): StagedScreeningQuote[] {
  return requirement.roleClaimIds.flatMap(claimId => {
    const claim = roleClaimById.get(claimId);
    if (!claim) throw new Error(`Unknown role claim reference: ${claimId}`);
    return claim.citations.flatMap((citation, citationIndex) =>
      jdSourceIds.has(citation.sourceId)
        ? [{ id: `${claimId}:Q${citationIndex + 1}`, text: citation.quote }]
        : []
    );
  });
}

function validateMapping(value: unknown, candidateClaims: Claim[]) {
  const parsed = stagedMappingResponseSchema.parse(value);
  const known = new Set(candidateClaims.map(claim => claim.id));
  exactIds(parsed.candidateClaimIds, known, 'candidate mapping claim');
  if (['DIRECT', 'ADJACENT', 'TRANSFERABLE'].includes(parsed.status) && !parsed.candidateClaimIds.length) {
    throw new Error('Positive fit mapping needs candidate proof');
  }
  if (parsed.status === 'CONTRADICTED' && !parsed.candidateClaimIds.length) {
    throw new Error('Contradicted fit mapping needs affirmative candidate evidence');
  }
  if (parsed.status === 'DIRECT' && parsed.unsupportedAspects.length) {
    throw new Error('Direct fit mapping cannot contain unsupported requirement aspects');
  }
  return parsed;
}

function validateResolutions(value: unknown, frozen: StagedResearchInput) {
  const drafts = stagedDecisionResolutionResponseSchema.parse(value).resolutions;
  const parsed = materializeStagedDecisionResolutions(drafts);
  const claims = new Map(frozen.evidence.map(claim => [claim.id, claim]));
  const expected = new Set(frozen.fields);
  const knownClaimIds = new Set(claims.keys());
  const seen = new Set<string>();

  for (const resolution of parsed) {
    if (!expected.has(resolution.field) || !seen.add(resolution.field)) {
      throw new Error(`Resolve field exactly once: ${resolution.field}`);
    }
    exactIds(resolution.claimIds, knownClaimIds, `resolution ${resolution.field} claim`);
    if (resolution.status === 'OPEN' && (!resolution.question || resolution.value !== null)) {
      throw new Error(`Open field must become a question: ${resolution.field}`);
    }
    if (resolution.status !== 'OPEN' && (resolution.value === null || !resolution.claimIds.length)) {
      throw new Error(`Resolved field needs evidence: ${resolution.field}`);
    }
    if (resolution.status !== 'OPEN' && resolution.question !== undefined) {
      throw new Error(`Resolved field cannot carry a question: ${resolution.field}`);
    }
    if (resolution.field === 'executiveDistance' && resolution.status === 'RESOLVED') {
      throw new Error('Executive distance is an analytical derivation; label INFERRED');
    }
    if (resolution.field === 'executiveDistance' && resolution.value === 0) {
      const support = resolution.claimIds.map(id => claims.get(id)?.text ?? '').join(' ');
      if (!/\b(?:CEO|chief executive|company head|enterprise head|managing director)\b/i.test(support)) {
        throw new Error('Executive distance 0 is reserved for the company or enterprise head');
      }
      if (/\breports? to (?:the )?board\b/i.test(support)) {
        throw new Error('A vertical leader reporting to the Board is executive-distance 1, not company head');
      }
    }
    if (['leadershipMode', 'functionState'].includes(resolution.field) && resolution.status === 'RESOLVED') {
      const labels = resolution.field === 'leadershipMode'
        ? /\b(?:DIRECT|MATRIX|HYBRID)\b/i
        : /\b(?:ESTABLISHED|SCALE-UP|GREENFIELD|RESTRUCTURE)\b/i;
      const quotes = resolution.claimIds
        .flatMap(id => claims.get(id)?.citations.map(citation => citation.quote) ?? [])
        .join(' ');
      if (!labels.test(quotes)) {
        throw new Error(`${resolution.field} is an analytical classification; label it INFERRED unless the source uses the classification itself`);
      }
    }
    if (resolution.field === 'teamScale' && resolution.status === 'RESOLVED' && resolution.value !== null) {
      const valueNumbers = String(resolution.value).match(/\d+/g) ?? [];
      const evidenceNumbers = resolution.claimIds.flatMap(id =>
        claims.get(id)?.citations.flatMap(citation => citation.quote.match(/\d+/g) ?? []) ?? []
      );
      if (valueNumbers.some(number => !evidenceNumbers.includes(number))) {
        throw new Error('Preserve the exact explicit team target; do not round it to an estimated band');
      }
    }
  }

  if (seen.size !== expected.size) {
    const missing = [...expected].filter(field => !seen.has(field));
    throw new Error(`Missing requested resolution fields: ${missing.join(', ')}`);
  }
  return parsed;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function runStagedFrozenDecisionDetailed(
  frozen: StagedResearchInput,
  model: ReasoningModel,
  onStage: (stage: string) => void = () => {},
): Promise<StagedDecisionResult> {
  const roleClaims = frozen.evidence.filter(claim => claim.plane === 'JD');
  const candidateClaims = frozen.evidence.filter(claim => claim.plane === 'CANDIDATE');
  if (!roleClaims.length || !candidateClaims.length) {
    throw new Error('Staged decision research requires validated JD and candidate evidence');
  }

  const role = await proposeStage(
    'Interpreting the role',
    model,
    stagedDecisionRoleInstruction,
    { opportunity: frozen.opportunity, roleClaims },
    stagedRoleAnalysisSchema,
    value => materializeStagedRoleAnalysis(value, roleClaims),
    onStage,
  );

  const roleClaimById = new Map(roleClaims.map(claim => [claim.id, claim]));
  const jdSourceIds = new Set(frozen.sources.filter(source => source.plane === 'JD').map(source => source.id));

  const [screeningResults, mappingResults] = await Promise.all([
    mapConcurrent(role.requirements, 3, requirement => {
      const quoteCatalog = buildScreeningQuoteCatalog(requirement, roleClaimById, jdSourceIds);
      return proposeStage(
        `Adjudicating screening: ${requirement.id}`,
        model,
        stagedDecisionScreeningInstructionV6,
        {
          requirement: {
            requirement: requirement.requirement,
            strength: requirement.strength,
            roleImportance: requirement.roleImportance,
          },
          quoteCatalog,
        },
        stagedScreeningAdjudicationSchemaV6,
        value => materializeSourceIdScreeningAdjudication(value, requirement, quoteCatalog),
        onStage,
      );
    }),
    mapConcurrent(role.requirements, 3, requirement => proposeStage(
      `Mapping candidate evidence: ${requirement.id}`,
      model,
      stagedDecisionMappingInstruction,
      {
        opportunity: frozen.opportunity,
        requirement,
        candidateClaims,
        candidateConflicts: frozen.candidateConflicts,
      },
      stagedMappingResponseSchema,
      value => validateMapping(value, candidateClaims),
      onStage,
    )),
  ]);

  const requirements: StagedMappedRequirement[] = role.requirements.map((requirement, index) => ({
    ...requirement,
    screeningGate: screeningResults[index].screeningGate,
    screeningFunction: screeningResults[index].screeningFunction,
    screeningGateBasis: screeningResults[index].gateBasis,
    screeningSupportQuoteIds: screeningResults[index].supportQuoteIds,
    screeningReasoning: screeningResults[index].reasoning,
    status: mappingResults[index].status,
    candidateClaimIds: mappingResults[index].candidateClaimIds,
    unsupportedAspects: mappingResults[index].unsupportedAspects,
    mappingReasoning: mappingResults[index].reasoning,
    reasoning: requirement.reasoning,
  }));

  const resolutions = await proposeStage(
    'Resolving role and company context',
    model,
    stagedDecisionResolutionInstruction,
    {
      opportunity: frozen.opportunity,
      role,
      evidence: frozen.evidence,
      acquisition: frozen.acquisition,
      fields: frozen.fields,
    },
    stagedDecisionResolutionResponseSchema,
    value => validateResolutions(value, frozen),
    onStage,
  );

  const unresolvedGates = eligibleScreeningDrivers(requirements);
  const gapResults = await mapConcurrent(unresolvedGates, 3, requirement => {
    if (requirement.status === 'CONTRADICTED') {
      return Promise.resolve({
        gapNature: 'AFFIRMATIVE_CONFLICT' as const,
        reasoning: 'The immutable candidate mapping contains affirmative conflicting evidence.',
      });
    }
    return proposeStage(
      `Classifying screening gap: ${requirement.id}`,
      model,
      stagedDecisionGapInstruction,
      {
        opportunity: frozen.opportunity,
        requirement: {
          id: requirement.id,
          requirement: requirement.requirement,
          strength: requirement.strength,
          roleImportance: requirement.roleImportance,
          screeningGate: requirement.screeningGate,
          screeningReasoning: requirement.screeningReasoning,
        },
        immutableMapping: {
          status: requirement.status,
          candidateClaimIds: requirement.candidateClaimIds,
          unsupportedAspects: requirement.unsupportedAspects,
          mappingReasoning: requirement.mappingReasoning,
        },
      },
      stagedGapResponseSchema,
      value => validateStagedGap(value, requirement),
      onStage,
    );
  });

  const drivers: StagedScreeningDriver[] = unresolvedGates.map((requirement, index) => ({
    ...requirement,
    gapNature: gapResults[index].gapNature,
    gapReasoning: gapResults[index].reasoning,
  }));
  const screeningConstraint = screeningConstraintForDrivers(drivers);

  const careerCapital = await proposeStage(
    'Adjudicating career capital',
    model,
    stagedDecisionCareerCapitalInstruction,
    {
      candidateClaims,
      operatingConditions: role.operatingConditions,
      authorityShape: role.authorityShape,
      resolutions,
    },
    stagedCareerCapitalSchema,
    value => validateStagedCareerCapital(value, role, resolutions, candidateClaims),
    onStage,
  );

  const immutableRequirements = requirements.map(requirement => ({
    id: requirement.id,
    requirement: requirement.requirement,
    strength: requirement.strength,
    roleImportance: requirement.roleImportance,
    screeningGate: requirement.screeningGate,
    status: requirement.status,
    unsupportedAspects: requirement.unsupportedAspects,
    mappingReasoning: requirement.mappingReasoning,
  }));

  const decision = await proposeStage(
    'Reasoning about pursuit decision',
    model,
    stagedDecisionInstruction,
    {
      opportunity: frozen.opportunity,
      candidate: frozen.candidate,
      immutableRequirements,
      eligibleScreeningDrivers: drivers.map(driver => ({
        id: driver.id,
        requirement: driver.requirement,
        status: driver.status,
        unsupportedAspects: driver.unsupportedAspects,
        gapNature: driver.gapNature,
        gapReasoning: driver.gapReasoning,
      })),
      screeningConstraint,
      operatingConditions: role.operatingConditions,
      authorityShape: role.authorityShape,
      roleSideConditions: role.roleSideConditions,
      resolutions,
      careerCapital,
    },
    stagedDecisionProposalSchema,
    value => validateStagedDecisionModel(value, requirements, drivers, role, resolutions, careerCapital),
    onStage,
  );

  return {
    decision,
    trace: {
      role,
      requirements,
      resolutions,
      eligibleScreeningDrivers: drivers,
      screeningConstraint,
      decision,
    },
  };
}

export async function runStagedFrozenDecision(
  frozen: StagedResearchInput,
  model: ReasoningModel,
  onStage: (stage: string) => void = () => {},
) {
  return (await runStagedFrozenDecisionDetailed(frozen, model, onStage)).decision;
}
