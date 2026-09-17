import { readFile, writeFile } from 'node:fs/promises';
import { BedrockClaudeJsonModel } from '../../src/lib/model/bedrock-claude-model';
import { researchInputFingerprint, researchModelInput, researchStageInstruction, validateFrozenResearchProposal } from '../../src/dossier/pipeline';

const csv = (await readFile('bedrock-long-term-api-key.csv', 'utf8')).trim().split(/\r?\n/);
const headers = csv[0].split(',').map(value => value.trim());
const values = csv[1].split(',');
const apiKey = values[headers.findIndex(header => header === 'ServiceApiKeyValue' || header === 'API key')]?.trim();
if (!apiKey) throw new Error('Bedrock API key column missing');
process.env.AWS_BEARER_TOKEN_BEDROCK = apiKey;

const capturedAt = '2026-09-16T00:00:00.000Z';
const jd = 'This is an individual contributor role leading through craft and judgment rather than headcount. 10+ years of experience spanning brand and UX/product design required. A strong portfolio demonstrating brand craft and UX rigor is required. Healthcare experience is a strong plus, but not mandatory.';
const cv = 'Senior Vice President who led a 40-person commercial CoE, brand transformation, and digital growth.';
const sources: any[] = [
  { id: 'jd', plane: 'JD', title: '2070', locator: 'fixture:2070', text: jd, capturedAt, attribution: 'JOB_POST' },
  { id: 'cv', plane: 'CANDIDATE', title: 'CV', locator: 'fixture:2070', text: cv, capturedAt, attribution: 'CANDIDATE_SUPPLIED' },
];
const evidence: any[] = [
  { id: 'JD-1-1', text: jd, state: 'EXPLICIT', confidence: 1, plane: 'JD', citations: [{ sourceId: 'jd', quote: jd }], derivedFrom: [] },
  { id: 'CANDIDATE-1-1', text: cv, state: 'EXPLICIT', confidence: 1, plane: 'CANDIDATE', citations: [{ sourceId: 'cv', quote: cv }], derivedFrom: [] },
];
const frozen: any = {
  opportunity: { id: '2070', company: '2070 Health', title: 'Head of Brand & UX' },
  candidate: { name: 'Swapnil Shukla' },
  sources,
  evidence,
  candidateSourceRefs: [{ id: 'cv', title: 'CV' }],
  candidateConflicts: [],
  acquisition: [],
  validEvidenceClaimIds: evidence.map(item => item.id),
  fields: ['companySize', 'reportingLine', 'executiveDistance', 'leadershipMode', 'teamScale', 'functionState', 'geography', 'commercialScope', 'compensation'],
  fingerprint: '',
};
frozen.fingerprint = researchInputFingerprint(frozen);

const minimaxArtifact = JSON.parse(await readFile('.radar/dossier-runs/minimax-m2.5-2070-research-verification.json', 'utf8'));
if (minimaxArtifact.inputFingerprint !== frozen.fingerprint) throw new Error('Frozen input fingerprint differs from MiniMax verification');

const model = new BedrockClaudeJsonModel(async () => process.env.AWS_BEARER_TOKEN_BEDROCK!, fetch, { maxOutputTokens: 12288 });
const startedAt = Date.now();
let rawResponse: unknown = null;
let research: unknown;
let validationError: string | undefined;
let providerError: string | undefined;
try {
  rawResponse = await model.generate(researchStageInstruction, researchModelInput(frozen));
  try {
    research = validateFrozenResearchProposal(frozen, rawResponse);
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }
} catch (error) {
  providerError = error instanceof Error && /^Bedrock (?:provider|network|timeout)/.test(error.message) ? error.message : 'Bedrock provider request failed';
}

const evaluation = (rawResponse as any)?.evaluation;
const requirements = Array.isArray(evaluation?.requirements) ? evaluation.requirements : [];
const icRequirement = requirements.find((requirement: any) => /individual contributor|craft and judgment|headcount/i.test(requirement.requirement ?? ''));
await writeFile('.radar/dossier-runs/claude-sonnet-4.6-2070-research-verification.json', JSON.stringify({
  provider: model.id,
  model: model.version,
  endpoint: 'bedrock-mantle',
  region: 'us-east-1',
  credentialSource: 'bedrock-long-term-api-key.csv',
  authenticationMode: 'AWS_BEARER_TOKEN_BEDROCK',
  inputFingerprint: frozen.fingerprint,
  transportAttempts: 1,
  latencyMs: Date.now() - startedAt,
  usage: model.lastUsage,
  thinkingControl: 'No extended or adaptive thinking control was sent.',
  rawResponse,
  validation: research ? { status: 'ACCEPTED', research } : { status: 'REJECTED', error: validationError ?? providerError },
  decision: { verdict: evaluation?.verdict ?? null, screeningViability: evaluation?.screeningViability ?? null, requirementMatrix: requirements },
  careerCapitalReasoning: (rawResponse as any)?.narrativePlan?.careerMove ?? null,
  semanticReview: {
    icOperatingShapeErrorOccurred: icRequirement?.decisionRole === 'HARD_SCREEN',
    indirectIcScreeningLeakageOccurred: null,
  },
}, null, 2));

console.log(research ? 'accepted' : 'rejected');
