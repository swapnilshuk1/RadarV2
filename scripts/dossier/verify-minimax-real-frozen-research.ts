import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { bedrockJsonSchema } from '../../src/dossier/bedrock-schema';
import { researchSchema } from '../../src/dossier/contracts';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';
import { researchInputFingerprint, researchModelInput, researchStageInstruction, validateFrozenResearchProposal, type FrozenResearchInput } from '../../src/dossier/pipeline';

const frozenArtifact = '.radar/dossier-runs/2070-real-frozen-research-input.json';
const output = '.radar/dossier-runs/minimax-m2.5-2070-real-frozen-research-verification.json';
const expectedFingerprint = '7db620f562b963a94fe32d3dab34b3b58f632d4741e2a77d63fa2631666a251c';
const frozen = JSON.parse(await readFile(frozenArtifact, 'utf8')) as FrozenResearchInput;
if (frozen.fingerprint !== expectedFingerprint || researchInputFingerprint(frozen) !== expectedFingerprint) throw new Error('Unexpected frozen input fingerprint');

const csv = (await readFile('bedrock-long-term-api-key.csv', 'utf8')).trim().split(/\r?\n/);
const headers = csv[0].split(',').map(value => value.trim());
const values = csv[1].split(',');
const apiKey = values[headers.findIndex(header => header === 'ServiceApiKeyValue' || header === 'API key')]?.trim();
if (!apiKey) throw new Error('Bedrock API key column missing');
process.env.AWS_BEARER_TOKEN_BEDROCK = apiKey;

const schema = bedrockJsonSchema(researchSchema);
const schemaHash = createHash('sha256').update(JSON.stringify(schema)).digest('hex');
const before = researchInputFingerprint(frozen);
const model = new BedrockConverseJsonModel('minimax.minimax-m2.5', async () => process.env.AWS_BEARER_TOKEN_BEDROCK!, fetch, { maxOutputTokens: 12288 });
const startedAt = Date.now();
let rawResponse: unknown = null;
let research: unknown;
let error: string | undefined;
try {
  rawResponse = await model.generate(researchStageInstruction, researchModelInput(frozen), schema);
  await writeFile(output, JSON.stringify({
    sourceFrozenArtifact: frozenArtifact,
    frozenFingerprint: frozen.fingerprint,
    provider: model.id,
    model: model.version,
    endpoint: 'bedrock-runtime/converse',
    region: 'us-east-1',
    authenticationMode: 'AWS_BEARER_TOKEN_BEDROCK',
    structuredOutputSchema: { identifier: 'radar-research-bedrock-json-schema', sha256: schemaHash },
    transportAttempts: 1,
    latencyMs: Date.now() - startedAt,
    usage: model.lastUsage,
    rawResponse,
    validation: { status: 'PENDING' },
  }, null, 2));
  try { research = validateFrozenResearchProposal(frozen, rawResponse); } catch (validationError) { error = validationError instanceof Error ? validationError.message : String(validationError); }
} catch (transportError) {
  error = transportError instanceof Error && /^Bedrock (?:provider|network|timeout)/.test(transportError.message) ? transportError.message : 'Bedrock provider request failed';
}
const after = researchInputFingerprint(frozen);
if (after !== expectedFingerprint || after !== before) throw new Error('Frozen input changed during MiniMax verification');
const evaluation = (research as any)?.evaluation ?? (rawResponse as any)?.evaluation;
await writeFile(output, JSON.stringify({
  sourceFrozenArtifact: frozenArtifact,
  frozenFingerprint: frozen.fingerprint,
  provider: model.id,
  model: model.version,
  endpoint: 'bedrock-runtime/converse',
  region: 'us-east-1',
  authenticationMode: 'AWS_BEARER_TOKEN_BEDROCK',
  thinkingControl: 'No explicit MiniMax thinking control was sent because this Converse surface exposes none for this request.',
  structuredOutputSchema: { identifier: 'radar-research-bedrock-json-schema', sha256: schemaHash },
  transportAttempts: 1,
  latencyMs: Date.now() - startedAt,
  usage: model.lastUsage,
  rawResponse,
  canonicalizedResearch: research ?? null,
  validation: research ? { status: 'ACCEPTED' } : { status: 'REJECTED', error },
  decision: { verdict: evaluation?.verdict ?? null, screeningViability: evaluation?.screeningViability ?? null, requirementMatrix: evaluation?.requirements ?? [] },
  careerCapitalReasoning: (research as any)?.narrativePlan?.careerMove ?? (rawResponse as any)?.narrativePlan?.careerMove ?? null,
  semanticReview: { icOperatingShapeErrorOccurred: null, indirectIcScreeningLeakageOccurred: null, healthcareClassification: null, portfolioClassification: null },
}, null, 2));
console.log(research ? 'accepted' : 'rejected');
