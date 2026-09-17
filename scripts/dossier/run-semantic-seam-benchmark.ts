import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { bedrockJsonSchema } from '../../src/dossier/bedrock-schema';
import {
  mappingFixtures,
  mappingSeamResponseSchema,
  scoreMappingFixture,
  scoreScreeningFixture,
  screeningFixtures,
  screeningSeamResponseSchema,
  seamFingerprint,
  validateMappingSeamResponse,
  validateScreeningSeamResponse,
  type MappingFixture,
  type ScreeningFixture,
  type SeamCaseKey,
} from '../../src/dossier/semantic-seam-benchmark';
import { researchInputFingerprint, type FrozenResearchInput } from '../../src/dossier/pipeline';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';

const caseSpecs: Record<SeamCaseKey, { path: string; fingerprint: string }> = {
  schnell: {
    path: '.radar/dossier-runs/schnell-real-frozen-research-input.json',
    fingerprint: '2d1a8f361f880f08f2980cf19df79828f1860d446036af46042468c99c7d3bb0',
  },
  artificilux: {
    path: '.radar/dossier-runs/artificilux-real-frozen-research-input.json',
    fingerprint: '7dc7cb6b568b76a2eba98e83d98ea6134f9eb793139318e238430944d8a8bda0',
  },
  '2070': {
    path: '.radar/dossier-runs/2070-real-frozen-research-input.json',
    fingerprint: '7db620f562b963a94fe32d3dab34b3b58f632d4741e2a77d63fa2631666a251c',
  },
};

const modelIds = [
  'zai.glm-5',
  'moonshotai.kimi-k2.5',
  'deepseek.v3.2',
] as const;

const artifactPath = '.radar/dossier-runs/semantic-seam-benchmark-v1.json';
const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
if (!apiKey) throw new Error('AWS_BEARER_TOKEN_BEDROCK is required');

const screeningInstruction = `You are evaluating one narrow RADAR semantic question.

Given one immutable role requirement and its exact JD evidence, decide whether it is an employer-side pre-entry screening gate.

A screening gate is a requirement the employer explicitly presents as something the candidate must possess, have done, or demonstrate in order to be eligible for consideration or shortlisting. It does not need to contain a number. Explicit prior-experience qualifications, eligibility conditions, credentials, licences, and qualifying artifacts can all be gates when the source establishes them as candidate-entry conditions.

A role responsibility, success capability, work style, or operating expectation is not a screening gate merely because it is important or required for strong job performance. PREFERRED or explicitly non-mandatory requirements are not screening gates.

Judge the exact JD evidence. Do not reason about the candidate. Return only screeningGate and concise reasoning.`;

const mappingInstruction = `You are evaluating one narrow RADAR candidate-to-role relationship.

Given one immutable role requirement and the complete frozen candidate evidence, classify the relationship as exactly one of DIRECT, ADJACENT, TRANSFERABLE, NOT_EVIDENCED, or CONTRADICTED.

DIRECT requires candidate evidence for the full material requirement. If a composite requirement has any material part that is not evidenced, it cannot be DIRECT and the missing parts must be listed in unsupportedAspects.

ADJACENT means closely related precedent that does not directly establish the requirement. TRANSFERABLE means a relevant underlying capability from a meaningfully different context. NOT_EVIDENCED means the supplied candidate evidence does not establish the requirement. CONTRADICTED requires affirmative candidate evidence that conflicts with the requirement; absence is never contradiction.

Respect semantic boundaries: portfolio value is not personally closed transaction value; attributed revenue is not owned revenue; an agency/client-services mandate is not a property-sales mandate; working in a country is not direct evidence of language fluency.

Do not reason about candidate desire, willingness, fit with role authority shape, or employer screening. Return only status, candidateClaimIds, unsupportedAspects, and concise reasoning. Cite only supplied candidate claim IDs.`;

const schemaObjects = {
  screening: bedrockJsonSchema(screeningSeamResponseSchema),
  mapping: bedrockJsonSchema(mappingSeamResponseSchema),
};
const schemaHashes = Object.fromEntries(
  Object.entries(schemaObjects).map(([key, schema]) => [
    key,
    createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
  ]),
);
const instructionHashes = {
  screening: seamFingerprint(screeningInstruction),
  mapping: seamFingerprint(mappingInstruction),
};

const models = Object.fromEntries(modelIds.map(modelId => [
  modelId,
  new BedrockConverseJsonModel(
    modelId,
    async () => apiKey,
    fetch,
    { maxOutputTokens: 4096, timeoutMs: 600000 },
  ),
])) as Record<(typeof modelIds)[number], BedrockConverseJsonModel>;

const frozenByCase = {} as Record<SeamCaseKey, FrozenResearchInput>;
for (const caseKey of Object.keys(caseSpecs) as SeamCaseKey[]) {
  const spec = caseSpecs[caseKey];
  const frozen = JSON.parse(await readFile(spec.path, 'utf8')) as FrozenResearchInput;
  if (frozen.fingerprint !== spec.fingerprint || researchInputFingerprint(frozen) !== spec.fingerprint) {
    throw new Error(`Unexpected frozen research input for ${caseKey}`);
  }
  frozenByCase[caseKey] = frozen;
}

const assertRoleFixtureEvidence = (fixture: ScreeningFixture | MappingFixture) => {
  const frozen = frozenByCase[fixture.caseKey];
  const roleClaimIds = new Set(frozen.evidence.filter(claim => claim.plane === 'JD').map(claim => claim.id));
  for (const claimId of fixture.requirement.roleClaimIds) {
    if (!roleClaimIds.has(claimId)) throw new Error(`Unknown frozen role claim ${claimId} for ${fixture.id}`);
  }
};
for (const fixture of [...screeningFixtures, ...mappingFixtures]) assertRoleFixtureEvidence(fixture);

const screeningInput = (fixture: ScreeningFixture) => {
  const frozen = frozenByCase[fixture.caseKey];
  const roleClaimById = new Map(frozen.evidence.filter(claim => claim.plane === 'JD').map(claim => [claim.id, claim]));
  const jdSourceIds = new Set(frozen.sources.filter(source => source.plane === 'JD').map(source => source.id));
  return {
    opportunity: frozen.opportunity,
    requirement: fixture.requirement,
    evidence: fixture.requirement.roleClaimIds.map(claimId => {
      const claim = roleClaimById.get(claimId)!;
      return {
        claimId,
        extractedClaimText: claim.text,
        exactJdQuotes: (claim.citations ?? [])
          .filter(citation => jdSourceIds.has(citation.sourceId))
          .map(citation => citation.quote),
      };
    }),
  };
};

const mappingInput = (fixture: MappingFixture) => {
  const frozen = frozenByCase[fixture.caseKey];
  return {
    opportunity: frozen.opportunity,
    requirement: fixture.requirement,
    candidateClaims: frozen.evidence.filter(claim => claim.plane === 'CANDIDATE'),
    candidateConflicts: frozen.candidateConflicts,
  };
};

type CallResult = {
  fixtureId: string;
  caseKey: SeamCaseKey;
  seam: 'screening' | 'mapping';
  modelId: string;
  inputFingerprint: string;
  rawResponse: unknown;
  latencyMs: number;
  usage: unknown;
  validation: { status: 'ACCEPTED' | 'REJECTED'; error?: string };
  semanticScore: unknown | null;
};

const results: CallResult[] = [];

const persist = async () => {
  const summaries = Object.fromEntries(modelIds.map(modelId => {
    const rows = results.filter(row => row.modelId === modelId);
    const accepted = rows.filter(row => row.validation.status === 'ACCEPTED');
    const passed = accepted.filter(row => (row.semanticScore as { passed?: boolean } | null)?.passed).length;
    const screeningRows = rows.filter(row => row.seam === 'screening');
    const mappingRows = rows.filter(row => row.seam === 'mapping');
    return [modelId, {
      callsAttempted: rows.length,
      structurallyAccepted: accepted.length,
      semanticPassed: passed,
      semanticTotal: screeningFixtures.length + mappingFixtures.length,
      screeningPassed: screeningRows.filter(row => (row.semanticScore as { passed?: boolean } | null)?.passed).length,
      screeningTotal: screeningFixtures.length,
      mappingPassed: mappingRows.filter(row => (row.semanticScore as { passed?: boolean } | null)?.passed).length,
      mappingTotal: mappingFixtures.length,
      providerOrValidationFailures: rows.filter(row => row.validation.status === 'REJECTED').length,
    }];
  }));

  await mkdir('.radar/dossier-runs', { recursive: true });
  await writeFile(artifactPath, JSON.stringify({
    experiment: 'semantic-seam-benchmark-v1',
    purpose: 'Compare bounded screening-adjudication and candidate-mapping semantics without rerunning Role Analysis, Decision Reasoning, Research, or composition.',
    models: modelIds,
    caseFingerprints: Object.fromEntries(Object.entries(caseSpecs).map(([key, value]) => [key, value.fingerprint])),
    fixtureFingerprint: seamFingerprint({ screeningFixtures, mappingFixtures }),
    instructionHashes,
    schemaHashes,
    transportNote: 'No semantic repair or second semantic generation. BedrockConverseJsonModel retains its existing transport-only retry behavior for transient network/429/5xx failures.',
    screeningFixtures,
    mappingFixtures,
    summaries,
    results,
  }, null, 2));
};

async function runScreening(fixture: ScreeningFixture, modelId: (typeof modelIds)[number]): Promise<CallResult> {
  const input = screeningInput(fixture);
  const startedAt = Date.now();
  let rawResponse: unknown = null;
  try {
    rawResponse = await models[modelId].generate(screeningInstruction, input, schemaObjects.screening);
    const validated = validateScreeningSeamResponse(rawResponse);
    return {
      fixtureId: fixture.id,
      caseKey: fixture.caseKey,
      seam: 'screening',
      modelId,
      inputFingerprint: seamFingerprint(input),
      rawResponse,
      latencyMs: Date.now() - startedAt,
      usage: models[modelId].lastUsage,
      validation: { status: 'ACCEPTED' },
      semanticScore: scoreScreeningFixture(fixture, validated),
    };
  } catch (failure) {
    return {
      fixtureId: fixture.id,
      caseKey: fixture.caseKey,
      seam: 'screening',
      modelId,
      inputFingerprint: seamFingerprint(input),
      rawResponse,
      latencyMs: Date.now() - startedAt,
      usage: models[modelId].lastUsage,
      validation: { status: 'REJECTED', error: failure instanceof Error ? failure.message : 'Unknown failure' },
      semanticScore: null,
    };
  }
}

async function runMapping(fixture: MappingFixture, modelId: (typeof modelIds)[number]): Promise<CallResult> {
  const input = mappingInput(fixture);
  const candidateClaims = frozenByCase[fixture.caseKey].evidence.filter(claim => claim.plane === 'CANDIDATE');
  const startedAt = Date.now();
  let rawResponse: unknown = null;
  try {
    rawResponse = await models[modelId].generate(mappingInstruction, input, schemaObjects.mapping);
    const validated = validateMappingSeamResponse(rawResponse, candidateClaims);
    return {
      fixtureId: fixture.id,
      caseKey: fixture.caseKey,
      seam: 'mapping',
      modelId,
      inputFingerprint: seamFingerprint(input),
      rawResponse,
      latencyMs: Date.now() - startedAt,
      usage: models[modelId].lastUsage,
      validation: { status: 'ACCEPTED' },
      semanticScore: scoreMappingFixture(fixture, validated),
    };
  } catch (failure) {
    return {
      fixtureId: fixture.id,
      caseKey: fixture.caseKey,
      seam: 'mapping',
      modelId,
      inputFingerprint: seamFingerprint(input),
      rawResponse,
      latencyMs: Date.now() - startedAt,
      usage: models[modelId].lastUsage,
      validation: { status: 'REJECTED', error: failure instanceof Error ? failure.message : 'Unknown failure' },
      semanticScore: null,
    };
  }
}

await persist();
for (const fixture of screeningFixtures) {
  const rows = await Promise.all(modelIds.map(modelId => runScreening(fixture, modelId)));
  results.push(...rows);
  await persist();
  console.log(`screening ${fixture.id}: ${rows.map(row => `${row.modelId}=${(row.semanticScore as { passed?: boolean } | null)?.passed ? 'PASS' : 'FAIL'}`).join(' | ')}`);
}
for (const fixture of mappingFixtures) {
  const rows = await Promise.all(modelIds.map(modelId => runMapping(fixture, modelId)));
  results.push(...rows);
  await persist();
  console.log(`mapping ${fixture.id}: ${rows.map(row => `${row.modelId}=${(row.semanticScore as { passed?: boolean } | null)?.passed ? 'PASS' : 'FAIL'}`).join(' | ')}`);
}

await persist();
console.log(artifactPath);
