import { createHash } from 'node:crypto';
import { ModelProviderUnavailableError } from '../lib/model/provider-unavailable';
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
} from './staged-role';
import {
  screeningConstraintForDrivers,
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
  materializeStagedScreeningAdjudication,
  stagedDecisionScreeningInstruction,
  stagedScreeningAdjudicationSchema,
  type StagedScreeningQuote,
} from './staged-screening';
import {
  stagedDecisionGapInstruction,
  stagedDecisionCareerCapitalInstruction,
  stagedDecisionInstruction,
  contextAwareDecisionInstruction,
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
      model.configurationFingerprint ?? "unconfigured",
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
  callStage = label,
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
        { stage: callStage, attempt: attempt + 1 },
      );
      const result = validate(previous);
      if (verifiedStageResults.size >= 256) {
        verifiedStageResults.delete(verifiedStageResults.keys().next().value!);
      }
      verifiedStageResults.set(key, structuredClone(previous));
      return result;
    } catch (error) {
      if (error instanceof ModelProviderUnavailableError) throw error;
      await model.discardResponse?.(previous);
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

const screeningBatchSchema = z.object({
  results: z.array(z.object({
    requirementId: z.string().min(1),
    adjudication: stagedScreeningAdjudicationSchema,
  }).strict()),
}).strict();

const mappingBatchSchema = z.object({
  results: z.array(z.object({
    requirementId: z.string().min(1),
    mapping: stagedMappingResponseSchema,
  }).strict()),
}).strict();

const gapBatchSchema = z.object({
  results: z.array(z.object({
    requirementId: z.string().min(1),
    gap: stagedGapResponseSchema,
  }).strict()),
}).strict();

export const STAGED_DECISION_BATCH_SIZE = 10;

export function chunkStagedDecisionItems<T>(
  items: readonly T[],
  size = STAGED_DECISION_BATCH_SIZE,
): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function exactBatch<T extends { requirementId: string }>(
  rows: T[],
  ids: string[],
  label: string,
): Map<string, T> {
  const expected = new Set(ids);
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!expected.has(row.requirementId) || result.has(row.requirementId)) {
      throw new Error(`Invalid or duplicate ${label} requirement: ${row.requirementId}`);
    }
    result.set(row.requirementId, row);
  }
  if (result.size !== expected.size) {
    const missing = ids.filter(id => !result.has(id));
    throw new Error(`Missing ${label} requirements: ${missing.join(', ')}`);
  }
  return result;
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

export async function runStagedFrozenDecisionDetailed(
  frozen: StagedResearchInput,
  model: ReasoningModel,
  onStage: (stage: string) => void = () => {},
  options: { policyVersion?: 'staged-v6' | 'staged-v7' | 'staged-v8' } = {},
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
    'role-interpretation',
  );

  const roleClaimById = new Map(roleClaims.map(claim => [claim.id, claim]));
  const jdSourceIds = new Set(frozen.sources.filter(source => source.plane === 'JD').map(source => source.id));

  const quoteCatalogs = new Map(
    role.requirements.map(requirement => [
      requirement.id,
      buildScreeningQuoteCatalog(requirement, roleClaimById, jdSourceIds),
    ]),
  );
  const requirementChunks = chunkStagedDecisionItems(role.requirements);
  const [screeningChunks, mappingChunks] = await Promise.all([
    Promise.all(
      requirementChunks.map((requirements, chunkIndex) => {
        const ids = requirements.map(requirement => requirement.id);
        return proposeStage(
          `Adjudicating screening requirements — chunk ${chunkIndex + 1}/${requirementChunks.length}`,
          model,
          stagedDecisionScreeningInstruction +
            '\nBATCH MODE: adjudicate every supplied requirement exactly once. Return JSON {results:[{requirementId,adjudication:{screeningFunction,gateBasis,supportQuoteIds,reasoning}}]}. requirementId is application-owned and must be copied exactly.',
          {
            requirements: requirements.map(requirement => ({
              requirementId: requirement.id,
              requirement: {
                requirement: requirement.requirement,
                strength: requirement.strength,
                roleImportance: requirement.roleImportance,
              },
              quoteCatalog: quoteCatalogs.get(requirement.id),
            })),
          },
          screeningBatchSchema,
          value => {
            const parsed = screeningBatchSchema.parse(value);
            const byId = exactBatch(parsed.results, ids, 'screening');
            return requirements.map(requirement =>
              materializeStagedScreeningAdjudication(
                byId.get(requirement.id)!.adjudication,
                requirement,
                quoteCatalogs.get(requirement.id)!,
              ),
            );
          },
          onStage,
          'screening-batch',
        );
      }),
    ),
    Promise.all(
      requirementChunks.map((requirements, chunkIndex) => {
        const ids = requirements.map(requirement => requirement.id);
        return proposeStage(
          `Mapping candidate evidence to requirements — chunk ${chunkIndex + 1}/${requirementChunks.length}`,
          model,
          stagedDecisionMappingInstruction +
            '\nBATCH MODE: map every supplied requirement exactly once. Return JSON {results:[{requirementId,mapping:{status,candidateClaimIds,unsupportedAspects,reasoning}}]}. Do not allow evidence for one requirement to satisfy another unless the supplied claims genuinely support both.',
          {
            opportunity: frozen.opportunity,
            requirements,
            candidateClaims,
            candidateConflicts: frozen.candidateConflicts,
          },
          mappingBatchSchema,
          value => {
            const parsed = mappingBatchSchema.parse(value);
            const byId = exactBatch(parsed.results, ids, 'mapping');
            return requirements.map(requirement =>
              validateMapping(byId.get(requirement.id)!.mapping, candidateClaims),
            );
          },
          onStage,
          'candidate-mapping-batch',
        );
      }),
    ),
  ]);
  const screeningResults = screeningChunks.flat();
  const mappingResults = mappingChunks.flat();

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
      ...(options.policyVersion==='staged-v8'?{candidateConflicts:frozen.candidateConflicts,conflictInstruction:'These conflicts are unresolved. Do not choose a winner or treat a conflicting premise as settled.'}:{}),
      fields: frozen.fields,
    },
    stagedDecisionResolutionResponseSchema,
    value => validateResolutions(value, frozen),
    onStage,
    'context-resolution',
  );

  const unresolvedGates = eligibleScreeningDrivers(requirements);
  const modelGates = unresolvedGates.filter(requirement => requirement.status !== 'CONTRADICTED');
  const modelGapResults = new Map<string, z.infer<typeof stagedGapResponseSchema>>();
  if (modelGates.length) {
    const gateChunks = chunkStagedDecisionItems(modelGates);
    const entries = await Promise.all(
      gateChunks.map((requirements, chunkIndex) =>
        proposeStage(
          `Classifying screening gaps — chunk ${chunkIndex + 1}/${gateChunks.length}`,
          model,
          stagedDecisionGapInstruction +
            '\nBATCH MODE: classify every supplied immutable screening gap exactly once. Return JSON {results:[{requirementId,gap:{gapNature,reasoning}}]}. Do not reopen screening or mapping judgments.',
          {
            opportunity: frozen.opportunity,
            requirements: requirements.map(requirement => ({
              requirementId: requirement.id,
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
            })),
          },
          gapBatchSchema,
          value => {
            const parsed = gapBatchSchema.parse(value);
            const byId = exactBatch(parsed.results, requirements.map(gate => gate.id), 'gap');
            return requirements.map(
              requirement =>
                [
                  requirement.id,
                  validateStagedGap(byId.get(requirement.id)!.gap, requirement),
                ] as const,
            );
          },
          onStage,
          'gap-classification-batch',
        ),
      ),
    );
    for (const [id, gap] of entries.flat()) modelGapResults.set(id, gap);
  }

  const gapResults = unresolvedGates.map(requirement =>
    requirement.status === 'CONTRADICTED'
      ? {
          gapNature: 'AFFIRMATIVE_CONFLICT' as const,
          reasoning: 'The immutable candidate mapping contains affirmative conflicting evidence.',
        }
      : modelGapResults.get(requirement.id)!,
  );

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
      ...(options.policyVersion==='staged-v8'?{candidateConflicts:frozen.candidateConflicts,conflictInstruction:'Do not resolve candidate-source conflicts by choosing a winner.'}:{}),
      operatingConditions: role.operatingConditions,
      authorityShape: role.authorityShape,
      resolutions,
    },
    stagedCareerCapitalSchema,
    value => validateStagedCareerCapital(value, role, resolutions, candidateClaims, (options.policyVersion === 'staged-v7' || options.policyVersion === 'staged-v8')),
    onStage,
    'career-capital',
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
    (options.policyVersion === 'staged-v7' || options.policyVersion === 'staged-v8') ? contextAwareDecisionInstruction : stagedDecisionInstruction,
    {
      opportunity: frozen.opportunity,
      candidate: frozen.candidate,
      ...((options.policyVersion === 'staged-v7' || options.policyVersion === 'staged-v8') ? { candidateClaims } : {}),
      ...(options.policyVersion==='staged-v8'?{candidateConflicts:frozen.candidateConflicts,conflictInstruction:'Keep conflicts unresolved and express material uncertainty as decision hinges.'}:{}),
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
    'decision',
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