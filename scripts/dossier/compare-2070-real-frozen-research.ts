import { readFile, writeFile } from 'node:fs/promises';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';
import { researchInputFingerprint, researchModelInput, researchStageInstruction, validateFrozenResearchProposal, type FrozenResearchInput } from '../../src/dossier/pipeline';

const output = '.radar/dossier-runs/2070-real-frozen-research-model-comparison.json';
const frozen = JSON.parse(await readFile('.radar/dossier-runs/2070-real-frozen-research-input.json', 'utf8')) as FrozenResearchInput;
if (researchInputFingerprint(frozen) !== frozen.fingerprint) throw new Error('Persisted frozen input fingerprint mismatch');

const csv = (await readFile('bedrock-long-term-api-key.csv', 'utf8')).trim().split(/\r?\n/);
const headers = csv[0].split(',').map(value => value.trim());
const values = csv[1].split(',');
const apiKey = values[headers.findIndex(header => header === 'ServiceApiKeyValue' || header === 'API key')]?.trim();
if (!apiKey) throw new Error('Bedrock API key column missing');
process.env.AWS_BEARER_TOKEN_BEDROCK = apiKey;
const key = async () => process.env.AWS_BEARER_TOKEN_BEDROCK!;

const modelListStartedAt = Date.now();
const modelListResponse = await fetch('https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/models', { headers: { Authorization: `Bearer ${await key()}` } });
const modelList = modelListResponse.ok ? await modelListResponse.json() as { data?: Array<{ id?: string }> } : undefined;
const modelListMetadata = { status: modelListResponse.status, latencyMs: Date.now() - modelListStartedAt };
if (!modelListResponse.ok) throw new Error(`Bedrock provider HTTP ${modelListResponse.status}`);
const modelIds = modelList?.data?.flatMap(item => item.id ? [item.id] : []) ?? [];
const claudeCandidates = ['us.anthropic.claude-sonnet-4-6', 'anthropic.claude-sonnet-4-6-v1', 'global.anthropic.claude-sonnet-4-6'];
const claudeModel = claudeCandidates.find(candidate => modelIds.includes(candidate));
if (!claudeModel) throw new Error('No supported Claude Sonnet 4.6 Bedrock Runtime identifier is available to this account');
if (!modelIds.includes('minimax.minimax-m2.5')) throw new Error('MiniMax M2.5 is unavailable on Bedrock Runtime for this account');

const relevantClaims = frozen.evidence.filter(claim => claim.plane === 'JD' && /individual contributor|craft and judgment|10\+ years|portfolio|healthcare|wellness|not mandatory/i.test(claim.text));
const evidenceInspection = {
  jdClaimCount: frozen.evidence.filter(claim => claim.plane === 'JD').length,
  candidateClaimCount: frozen.evidence.filter(claim => claim.plane === 'CANDIDATE').length,
  contextClaimCount: frozen.evidence.filter(claim => claim.plane === 'CONTEXT').length,
  candidateConflictCount: frozen.candidateConflicts.length,
  acquisitionAttemptCount: frozen.acquisition.length,
  distinctRelevantJdClaims: relevantClaims.map(claim => ({ id: claim.id, text: claim.text })),
};
const concepts = [/individual contributor|craft and judgment/i, /10\+ years.*brand.*UX|brand.*UX.*10\+ years/i, /portfolio/i, /strong plus.*not mandatory|not mandatory/i];
if (!concepts.every(pattern => relevantClaims.some(claim => pattern.test(claim.text)))) throw new Error('Frozen JD evidence does not separate all comparison propositions');

const records: any[] = [];
const input = researchModelInput(frozen);
for (const modelId of ['minimax.minimax-m2.5', claudeModel]) {
  const before = researchInputFingerprint(frozen);
  if (before !== frozen.fingerprint) throw new Error(`Frozen input changed before ${modelId}`);
  const model = new BedrockConverseJsonModel(modelId, key, fetch, { maxOutputTokens: 12288 });
  const startedAt = Date.now();
  let rawResponse: unknown = null;
  let research: unknown;
  let error: string | undefined;
  try {
    rawResponse = await model.generate(researchStageInstruction, input);
    try { research = validateFrozenResearchProposal(frozen, rawResponse); } catch (validationError) { error = validationError instanceof Error ? validationError.message : String(validationError); }
  } catch (transportError) {
    error = transportError instanceof Error && /^Bedrock (?:provider|network|timeout)/.test(transportError.message) ? transportError.message : 'Bedrock provider request failed';
  }
  const after = researchInputFingerprint(frozen);
  if (after !== before) throw new Error(`Frozen input changed during ${modelId}`);
  records.push({
    provider: model.id,
    model: model.version,
    endpoint: 'bedrock-runtime/converse',
    region: 'us-east-1',
    inputFingerprintBefore: before,
    inputFingerprintAfter: after,
    transportAttempts: 1,
    latencyMs: Date.now() - startedAt,
    usage: model.lastUsage,
    rawResponse,
    canonicalValidation: research ? { status: 'ACCEPTED', research } : { status: 'REJECTED', error },
    semanticReview: { icOperatingShapeErrorOccurred: null, indirectIcScreeningLeakageOccurred: null },
  });
  await writeFile(output, JSON.stringify({ frozenInputArtifact: '.radar/dossier-runs/2070-real-frozen-research-input.json', commonModelVisibleInputFingerprint: frozen.fingerprint, evidenceInspection, modelList: modelListMetadata, records }, null, 2));
}
console.log(output);
