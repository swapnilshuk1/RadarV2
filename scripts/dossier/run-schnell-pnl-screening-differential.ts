import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { bedrockJsonSchema } from '../../src/dossier/bedrock-schema';
import { researchInputFingerprint, type FrozenResearchInput } from '../../src/dossier/pipeline';
import { stagedScreeningResponseSchema } from '../../src/dossier/staged-research';
import { stagedDecisionScreeningInstruction } from '../../src/dossier/staged-decision-prompts';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';

const frozenPath = '.radar/dossier-runs/schnell-real-frozen-research-input.json';
const frozenFingerprint = '2d1a8f361f880f08f2980cf19df79828f1860d446036af46042468c99c7d3bb0';
const claimId = 'JD-1-65';
const outputPath = '.radar/dossier-runs/schnell-pnl-screening-differential-v1.json';
const modelIds = ['zai.glm-5', 'moonshotai.kimi-k2.5'] as const;

const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
if (!apiKey) throw new Error('AWS_BEARER_TOKEN_BEDROCK is required');

const frozen = JSON.parse(await readFile(frozenPath, 'utf8')) as FrozenResearchInput;
if (frozen.fingerprint !== frozenFingerprint || researchInputFingerprint(frozen) !== frozenFingerprint) {
  throw new Error('Unexpected Schnell frozen input');
}

const roleClaim = frozen.evidence.find(claim => claim.id === claimId && claim.plane === 'JD');
if (!roleClaim) throw new Error(`Missing frozen Schnell claim ${claimId}`);
const jdSourceIds = new Set(frozen.sources.filter(source => source.plane === 'JD').map(source => source.id));

const requirement = {
  id: 'REQ-PNL',
  requirement: 'Experience running a sales business as a P&L, or credible readiness on the cost side.',
  strength: 'REQUIRED' as const,
  roleImportance: 'CORE_CAPABILITY' as const,
  roleClaimIds: [claimId],
  reasoning: 'Frozen surgical differential: preserve the exact production requirement semantics.',
};

const input = {
  opportunity: frozen.opportunity,
  requirement,
  evidence: [{
    claimId,
    extractedClaimText: roleClaim.text,
    exactJdQuotes: roleClaim.citations
      .filter(citation => jdSourceIds.has(citation.sourceId))
      .map(citation => citation.quote),
  }],
};

const schema = bedrockJsonSchema(stagedScreeningResponseSchema);
const results: Record<string, unknown> = {};

for (const modelId of modelIds) {
  const model = new BedrockConverseJsonModel(
    modelId,
    async () => apiKey,
    fetch,
    { maxOutputTokens: 1024, timeoutMs: 600000 },
  );
  const startedAt = Date.now();
  let rawResponse: unknown = null;
  try {
    rawResponse = await model.generate(stagedDecisionScreeningInstruction, input, schema);
    const validated = stagedScreeningResponseSchema.parse(rawResponse);
    results[modelId] = {
      status: 'ACCEPTED',
      rawResponse,
      validated,
      expectedGate: true,
      semanticPass: validated.screeningGate === true,
      latencyMs: Date.now() - startedAt,
      usage: model.lastUsage,
    };
  } catch (error) {
    results[modelId] = {
      status: 'FAILED',
      rawResponse,
      error: error instanceof Error ? error.message : 'Unknown screening differential failure',
      latencyMs: Date.now() - startedAt,
      usage: model.lastUsage,
    };
  }
}

await mkdir('.radar/dossier-runs', { recursive: true });
await writeFile(outputPath, JSON.stringify({
  experiment: 'schnell-pnl-screening-differential-v1',
  purpose: 'One-shot GLM 5 vs Kimi K2.5 differential on the exact Schnell P&L/readiness requirement that was under-gated in staged production v2.',
  sourceFrozenArtifact: frozenPath,
  frozenFingerprint,
  expectedGate: true,
  modelIds,
  instruction: stagedDecisionScreeningInstruction,
  input,
  results,
}, null, 2));

console.log(resolve(outputPath));
