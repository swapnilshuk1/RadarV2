import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { bedrockJsonSchema } from '../../src/dossier/bedrock-schema';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';
import type { Claim, EvidenceSource } from '../../src/dossier/contracts';
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

const frozenPath = '.radar/dossier-runs/2070-real-frozen-research-input.json';
const artifactPath = '.radar/dossier-runs/2070-bounded-research-architecture-experiment.json';
const expectedFingerprint = '7db620f562b963a94fe32d3dab34b3b58f632d4741e2a77d63fa2631666a251c';
const modelId = 'zai.glm-5';
const frozen = JSON.parse(await readFile(frozenPath, 'utf8')) as FrozenResearchInput;
if (frozen.fingerprint !== expectedFingerprint || researchInputFingerprint(frozen) !== expectedFingerprint) throw new Error('Unexpected frozen research input');

const csv = (await readFile('bedrock-long-term-api-key.csv', 'utf8')).trim().split(/\r?\n/);
const headers = csv[0].split(',').map(value => value.trim());
const values = csv[1].split(',');
const apiKey = values[headers.findIndex(header => header === 'ServiceApiKeyValue' || header === 'API key')]?.trim();
if (!apiKey) throw new Error('Bedrock API key column missing');
process.env.AWS_BEARER_TOKEN_BEDROCK = apiKey;

const roleClaims = frozen.evidence.filter(claim => claim.plane === 'JD');
const candidateClaims = frozen.evidence.filter(claim => claim.plane === 'CANDIDATE');
const contextClaims = frozen.evidence.filter(claim => claim.plane === 'CONTEXT');
const roleSources = frozen.sources.filter(source => source.plane === 'JD');
const schemas = {
  role: bedrockJsonSchema(roleAnalyticalCoreSchema),
  mapping: bedrockJsonSchema(candidateMappingSchema),
  decision: bedrockJsonSchema(boundedDecisionSchema),
};
const schemaHashes = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, createHash('sha256').update(JSON.stringify(schema)).digest('hex')]));
const model = new BedrockConverseJsonModel(modelId, async () => process.env.AWS_BEARER_TOKEN_BEDROCK!, fetch, { maxOutputTokens: 8192, timeoutMs: 600000 });

const roleInstruction = `You are Stage 1 of a bounded executive-opportunity analysis. Analyze only validated JD claims. Return a RoleAnalyticalCore.

A candidate requirement is an employer-side qualification the candidate must bring before entry. A role operating condition describes how the job operates; it is never a candidate requirement merely because it matters. Classify each material candidate requirement with mandatory and decisionRole. HARD_SCREEN requires explicit employer entry qualification wording. PREFERENCE cannot be mandatory. Put individual-contributor versus people-manager structure, hands-on execution, authority topology, reporting shape, and employment conditions in operatingConditions or roleSideConditions unless the JD explicitly requires prior experience as an entry qualification. Do not infer anything about a candidate. Cite only supplied JD claim IDs. Do not create claims.`;
const mappingInstruction = `You are Stage 2 of a bounded executive-opportunity analysis. The RoleAnalyticalCore is already validated and immutable. Map every and only its candidate requirements to supplied candidate evidence using exactly DIRECT, ADJACENT, TRANSFERABLE, NOT_EVIDENCED, or CONTRADICTED. Positive statuses require actual supplied candidate claim IDs. Do not add or modify requirements, mandatory status, decisionRole, or operating conditions. Separately return factual authority/commercial observations using candidate claim IDs. Never infer desire, willingness, flight risk, retention risk, or candidate preference from missing evidence. Do not create claims.`;
const decisionInstruction = `You are Stage 3 of a bounded executive-opportunity analysis. Use the immutable role core and requirement mapping. Return only screening viability, screening rationale, pursuit verdict, concise decision rationale, career-capital/authority trade, and decision hinges.

Employer screening viability derives only from employer-side candidate requirements. Role operating shape, authority change, employment conditions, compensation, location, or candidate willingness cannot become employer screening blockers unless the validated role core already identifies an explicit entry qualification. Treat authority/headcount/commercial-scope differences as candidate-side career-capital reasoning. Do not invent personal preference, desire, willingness, flight risk, retention risk, or employer concern. Do not create requirements, mappings, claims, narrative plans, resolutions, or acquisition requests. Cite only supplied IDs in decision hinges.`;

const roleInput = { opportunity: frozen.opportunity, roleClaims };
const stageRecords: Record<string, unknown> = {};
const persist = async (status: string, assembled?: unknown, error?: string) => writeFile(artifactPath, JSON.stringify({
  sourceFrozenArtifact: frozenPath,
  frozenFingerprint: frozen.fingerprint,
  model: { provider: model.id, version: model.version, endpoint: 'bedrock-runtime/converse', region: 'us-east-1' },
  schemas: schemaHashes,
  evidenceVolumes: { roleClaims: roleClaims.length, candidateClaims: candidateClaims.length, contextClaims: contextClaims.length, candidateConflicts: frozen.candidateConflicts.length },
  stages: stageRecords,
  status,
  assembled: assembled ?? null,
  error: error ?? null,
}, null, 2));

async function runStage<T>(name: string, instruction: string, input: unknown, schema: Record<string, unknown>, validate: (raw: unknown) => T): Promise<T> {
  const startedAt = Date.now();
  const inputFingerprint = stageFingerprint(input);
  let rawResponse: unknown = null;
  try {
    rawResponse = await model.generate(instruction, input, schema);
    stageRecords[name] = { inputFingerprint, inputEvidenceVolume: Array.isArray((input as any).roleClaims) ? (input as any).roleClaims.length : Array.isArray((input as any).candidateClaims) ? (input as any).candidateClaims.length : undefined, rawResponse, latencyMs: Date.now() - startedAt, usage: model.lastUsage, validation: { status: 'PENDING' } };
    await persist('RUNNING');
    const validated = validate(rawResponse);
    stageRecords[name] = { ...stageRecords[name] as object, validated, validation: { status: 'ACCEPTED' } };
    await persist('RUNNING');
    return validated;
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : 'Unknown stage failure';
    stageRecords[name] = { inputFingerprint, rawResponse, latencyMs: Date.now() - startedAt, usage: model.lastUsage, validation: { status: 'REJECTED', error: message } };
    await persist('FAILED', undefined, `${name}: ${message}`);
    throw failure;
  }
}

await mkdir('.radar/dossier-runs', { recursive: true });
let role: ReturnType<typeof validateRoleAnalyticalCore>;
let mapping: ReturnType<typeof validateCandidateMapping>;
let decision: ReturnType<typeof validateBoundedDecision>;
try {
  role = await runStage('roleAnalysis', roleInstruction, roleInput, schemas.role, raw => validateRoleAnalyticalCore(raw, roleClaims, roleSources));
  const mappingInput = { role, candidateClaims, candidateConflicts: frozen.candidateConflicts };
  mapping = await runStage('candidateMapping', mappingInstruction, mappingInput, schemas.mapping, raw => validateCandidateMapping(raw, role, candidateClaims));
  const authorityClaimIds = [...new Set(mapping.authorityFacts.flatMap(item => item.claimIds))];
  const authorityEvidence = candidateClaims.filter(claim => authorityClaimIds.includes(claim.id));
  const decisionInput = { opportunity: frozen.opportunity, role, mapping, contextClaims, authorityEvidence };
  decision = await runStage('decisionReasoning', decisionInstruction, decisionInput, schemas.decision, raw => validateBoundedDecision(raw, role, mapping, contextClaims, candidateClaims));
  const assembled = assembleBoundedAnalyticalResult(role, mapping, decision);
  await persist('ACCEPTED', assembled);
  console.log('accepted');
} catch {
  console.log('rejected');
}