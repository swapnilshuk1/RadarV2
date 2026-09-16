import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { researchInputFingerprint, type FrozenResearchInput } from '../../src/dossier/pipeline';
import { runStagedFrozenResearchDetailed } from '../../src/dossier/staged-research';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';

const cases = [
  {
    key: 'schnell',
    path: '.radar/dossier-runs/schnell-real-frozen-research-input.json',
    fingerprint: '2d1a8f361f880f08f2980cf19df79828f1860d446036af46042468c99c7d3bb0',
  },
  {
    key: 'artificilux',
    path: '.radar/dossier-runs/artificilux-real-frozen-research-input.json',
    fingerprint: '7dc7cb6b568b76a2eba98e83d98ea6134f9eb793139318e238430944d8a8bda0',
  },
  {
    key: '2070',
    path: '.radar/dossier-runs/2070-real-frozen-research-input.json',
    fingerprint: '7db620f562b963a94fe32d3dab34b3b58f632d4741e2a77d63fa2631666a251c',
  },
] as const;

const outputPath = '.radar/dossier-runs/staged-production-research-three-case-v2.json';
const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
if (!apiKey) throw new Error('AWS_BEARER_TOKEN_BEDROCK is required');

const model = new BedrockConverseJsonModel(
  'zai.glm-5',
  async () => apiKey,
  fetch,
  { maxOutputTokens: 8192, timeoutMs: 600000 },
);

const records: Record<string, unknown> = {};

const persist = async () => {
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  const statuses = Object.values(records).map((record: any) => record.status);
  const status = statuses.length === cases.length && statuses.every(value => value === 'ACCEPTED')
    ? 'ACCEPTED'
    : statuses.some(value => value === 'FAILED')
      ? 'FAILED'
      : 'RUNNING';
  await writeFile(outputPath, JSON.stringify({
    run: 'staged-production-research-three-case-v2',
    purpose: 'Verify the staged Research production candidate after removing duplicate lexical re-adjudication of already validated screening semantics, before wiring it into buildDossier.',
    model: { provider: model.id, version: model.version },
    caseOrder: cases.map(item => item.key),
    status,
    records,
  }, null, 2));
};

await persist();
for (const spec of cases) {
  const frozen = JSON.parse(await readFile(spec.path, 'utf8')) as FrozenResearchInput;
  const computed = researchInputFingerprint(frozen);
  if (frozen.fingerprint !== spec.fingerprint || computed !== spec.fingerprint) {
    throw new Error(`Frozen input fingerprint mismatch for ${spec.key}`);
  }

  const stages: string[] = [];
  const startedAt = Date.now();
  try {
    const result = await runStagedFrozenResearchDetailed(
      frozen,
      model,
      stage => {
        stages.push(stage);
        console.log(`[${spec.key}] ${stage}`);
      },
    );
    records[spec.key] = {
      status: 'ACCEPTED',
      sourceFrozenArtifact: spec.path,
      frozenFingerprint: spec.fingerprint,
      latencyMs: Date.now() - startedAt,
      stages,
      trace: result.trace,
      research: result.research,
    };
  } catch (error) {
    records[spec.key] = {
      status: 'FAILED',
      sourceFrozenArtifact: spec.path,
      frozenFingerprint: spec.fingerprint,
      latencyMs: Date.now() - startedAt,
      stages,
      error: error instanceof Error ? error.message : 'Unknown staged Research failure',
    };
  }
  await persist();
}

await persist();
console.log(resolve(outputPath));