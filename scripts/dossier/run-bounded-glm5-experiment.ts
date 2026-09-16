import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { bedrockJsonSchema } from '../../src/dossier/bedrock-schema';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';
import {
  assembleBoundedAnalyticalResult,
  boundedDecisionSchema,
  candidateMappingSchema,
  roleAnalyticalCoreSchema,
  stageFingerprint,
  validateBoundedDecision,
  validateCandidateMapping,
  validateRoleAnalyticalCore,
} from '../../src/dossier/bounded-research-experiment';
import { researchInputFingerprint, type FrozenResearchInput } from '../../src/dossier/pipeline';

const cases = [
  {
    key: 'schnell',
    frozenPath: '.radar/dossier-runs/schnell-real-frozen-research-input.json',
    expectedFingerprint: '2d1a8f361f880f08f2980cf19df79828f1860d446036af46042468c99c7d3bb0',
  },
  {
    key: 'artificilux',
    frozenPath: '.radar/dossier-runs/artificilux-real-frozen-research-input.json',
    expectedFingerprint: '7dc7cb6b568b76a2eba98e83d98ea6134f9eb793139318e238430944d8a8bda0',
  },
  {
    key: '2070',
    frozenPath: '.radar/dossier-runs/2070-real-frozen-research-input.json',
    expectedFingerprint: '7db620f562b963a94fe32d3dab34b3b58f632d4741e2a77d63fa2631666a251c',
  },
] as const;

const artifactPath = '.radar/dossier-runs/three-case-bounded-research-architecture-experiment-v2.json';
const modelId = 'zai.glm-5';

const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
if (!apiKey) {
  throw new Error('AWS_BEARER_TOKEN_BEDROCK is required');
}

const schemas = {
  role: bedrockJsonSchema(roleAnalyticalCoreSchema),
  mapping: bedrockJsonSchema(candidateMappingSchema),
  decision: bedrockJsonSchema(boundedDecisionSchema),
};
const schemaHashes = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [
    name,
    createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
  ]),
);

const model = new BedrockConverseJsonModel(
  modelId,
  async () => apiKey,
  fetch,
  { maxOutputTokens: 8192, timeoutMs: 600000 },
);

const roleInstruction = `You are Stage 1 of a bounded executive-opportunity analysis. Analyze only validated JD claims. Return a RoleAnalyticalCore.

Separate candidate requirements from role operating conditions.

A candidate requirement is something the employer expects the candidate to bring before entry or demonstrate as relevant capability. A role operating condition describes how the job itself operates; it is not a candidate requirement merely because it matters.

For each candidate requirement classify three independent properties:
- strength: REQUIRED or PREFERRED.
- roleImportance: CORE_CAPABILITY or ENABLER.
- screeningGate: true only when the JD explicitly establishes an employer-side pre-entry qualification or shortlisting condition.

These properties are independent. REQUIRED does not automatically mean screeningGate=true. A core capability can be required yet not be an explicit employer doorway gate. PREFERRED can never be a screening gate.

Put individual-contributor versus people-manager structure, hands-on execution, authority topology, reporting shape, and employment conditions in operatingConditions or roleSideConditions unless the JD explicitly requires prior experience as a candidate qualification.

Do not infer anything about a candidate. Cite only supplied JD claim IDs. Do not create claims.`;

const mappingInstruction = `You are Stage 2 of a bounded executive-opportunity analysis. The RoleAnalyticalCore is already validated and immutable.

Map every and only its candidate requirements to supplied candidate evidence using exactly DIRECT, ADJACENT, TRANSFERABLE, NOT_EVIDENCED, or CONTRADICTED.

Positive statuses require actual supplied candidate claim IDs. CONTRADICTED requires affirmative candidate evidence that conflicts with the requirement; missing evidence is NOT_EVIDENCED, never CONTRADICTED.

Do not add or modify requirements, strength, roleImportance, screeningGate, or operating conditions. Separately return factual authority/commercial observations when the supplied candidate evidence supports them; this array may be empty.

Never infer desire, willingness, flight risk, retention risk, or candidate preference from missing evidence. Do not create claims.`;

const decisionInstruction = `You are Stage 3 of a bounded executive-opportunity analysis. Use the immutable role core and requirement mapping.

Return only:
- screening viability;
- screening rationale;
- screeningDriverRequirementIds;
- pursuit verdict;
- concise decision rationale;
- career-capital/authority trade;
- decision hinges.

Every screeningDriverRequirementId must point to an immutable role requirement whose screeningGate is true.

Employer screening viability may be driven only by requirements with screeningGate=true. Role operating shape, authority change, employment conditions, compensation, location, or candidate willingness cannot become employer screening drivers.

Treat authority/headcount/commercial-scope differences as candidate-side career-capital reasoning. Do not invent personal preference, desire, willingness, flight risk, retention risk, or employer concern.

Do not create requirements, mappings, claims, narrative plans, resolutions, or acquisition requests. Cite only supplied evidence IDs in decision hinges.`;

type ExperimentCaseRecord = {
  sourceFrozenArtifact: string;
  frozenFingerprint: string;
  opportunity?: FrozenResearchInput['opportunity'];
  evidenceVolumes?: {
    roleClaims: number;
    candidateClaims: number;
    contextClaims: number;
    candidateConflicts: number;
  };
  stages: Record<string, unknown>;
  status: 'PENDING' | 'RUNNING' | 'ACCEPTED' | 'FAILED';
  assembled: unknown | null;
  error: string | null;
};

const caseRecords: Record<string, ExperimentCaseRecord> = {};

const persist = async (status: 'RUNNING' | 'ACCEPTED' | 'FAILED') => {
  await writeFile(artifactPath, JSON.stringify({
    experiment: 'bounded-research-v2-three-case',
    model: {
      provider: model.id,
      version: model.version,
      endpoint: 'bedrock-runtime/converse',
      region: 'us-east-1',
    },
    schemas: schemaHashes,
    caseOrder: cases.map(item => item.key),
    status,
    cases: caseRecords,
  }, null, 2));
};

async function runStage<T>(
  caseRecord: ExperimentCaseRecord,
  name: string,
  instruction: string,
  input: unknown,
  schema: Record<string, unknown>,
  validate: (raw: unknown) => T,
): Promise<T> {
  const startedAt = Date.now();
  const inputFingerprint = stageFingerprint(input);
  let rawResponse: unknown = null;

  try {
    rawResponse = await model.generate(instruction, input, schema);
    caseRecord.stages[name] = {
      inputFingerprint,
      rawResponse,
      latencyMs: Date.now() - startedAt,
      usage: model.lastUsage,
      validation: { status: 'PENDING' },
    };
    await persist('RUNNING');

    const validated = validate(rawResponse);
    caseRecord.stages[name] = {
      ...(caseRecord.stages[name] as object),
      validated,
      validation: { status: 'ACCEPTED' },
    };
    await persist('RUNNING');
    return validated;
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : 'Unknown stage failure';
    caseRecord.stages[name] = {
      inputFingerprint,
      rawResponse,
      latencyMs: Date.now() - startedAt,
      usage: model.lastUsage,
      validation: { status: 'REJECTED', error: message },
    };
    throw failure;
  }
}

await mkdir('.radar/dossier-runs', { recursive: true });

for (const experimentCase of cases) {
  const caseRecord: ExperimentCaseRecord = {
    sourceFrozenArtifact: experimentCase.frozenPath,
    frozenFingerprint: experimentCase.expectedFingerprint,
    stages: {},
    status: 'PENDING',
    assembled: null,
    error: null,
  };
  caseRecords[experimentCase.key] = caseRecord;

  try {
    const frozen = JSON.parse(
      await readFile(experimentCase.frozenPath, 'utf8'),
    ) as FrozenResearchInput;

    if (
      frozen.fingerprint !== experimentCase.expectedFingerprint
      || researchInputFingerprint(frozen) !== experimentCase.expectedFingerprint
    ) {
      throw new Error(`Unexpected frozen research input for ${experimentCase.key}`);
    }

    const roleClaims = frozen.evidence.filter(claim => claim.plane === 'JD');
    const candidateClaims = frozen.evidence.filter(claim => claim.plane === 'CANDIDATE');
    const contextClaims = frozen.evidence.filter(claim => claim.plane === 'CONTEXT');
    const roleSources = frozen.sources.filter(source => source.plane === 'JD');

    caseRecord.opportunity = frozen.opportunity;
    caseRecord.evidenceVolumes = {
      roleClaims: roleClaims.length,
      candidateClaims: candidateClaims.length,
      contextClaims: contextClaims.length,
      candidateConflicts: frozen.candidateConflicts.length,
    };
    caseRecord.status = 'RUNNING';
    await persist('RUNNING');

    const roleInput = { opportunity: frozen.opportunity, roleClaims };
    const role = await runStage(
      caseRecord,
      'roleAnalysis',
      roleInstruction,
      roleInput,
      schemas.role,
      raw => validateRoleAnalyticalCore(raw, roleClaims, roleSources),
    );

    const mappingInput = {
      role,
      candidateClaims,
      candidateConflicts: frozen.candidateConflicts,
    };
    const mapping = await runStage(
      caseRecord,
      'candidateMapping',
      mappingInstruction,
      mappingInput,
      schemas.mapping,
      raw => validateCandidateMapping(raw, role, candidateClaims),
    );

    const authorityClaimIds = [
      ...new Set(mapping.authorityFacts.flatMap(item => item.claimIds)),
    ];
    const authorityEvidence = candidateClaims.filter(claim =>
      authorityClaimIds.includes(claim.id),
    );

    const decisionInput = {
      opportunity: frozen.opportunity,
      role,
      mapping,
      contextClaims,
      authorityEvidence,
    };
    const decision = await runStage(
      caseRecord,
      'decisionReasoning',
      decisionInstruction,
      decisionInput,
      schemas.decision,
      raw => validateBoundedDecision(raw, role, mapping, contextClaims, candidateClaims),
    );

    caseRecord.assembled = assembleBoundedAnalyticalResult(role, mapping, decision);
    caseRecord.status = 'ACCEPTED';
    await persist('RUNNING');
    console.log(`${experimentCase.key}: accepted`);
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : 'Unknown case failure';
    caseRecord.status = 'FAILED';
    caseRecord.error = message;
    await persist('RUNNING');
    console.log(`${experimentCase.key}: rejected — ${message}`);
  }
}

const allAccepted = cases.every(item => caseRecords[item.key]?.status === 'ACCEPTED');
await persist(allAccepted ? 'ACCEPTED' : 'FAILED');
console.log(allAccepted ? 'experiment: accepted' : 'experiment: rejected');
