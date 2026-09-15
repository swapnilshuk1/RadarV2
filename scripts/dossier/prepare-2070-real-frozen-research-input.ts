import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { prepareFrozenResearchInput } from '../../src/dossier/pipeline';
import type { AcquisitionAttempt, ContextProvider, EvidenceSource, SliceInput } from '../../src/dossier/contracts';
import { GeminiJsonModel } from '../../src/lib/model/json-model';
import { adcTokenProvider } from './credentials';
import { readSliceInput } from './source-input';

const output = '.radar/dossier-runs/2070-real-frozen-research-input.json';
try { await access(output, constants.F_OK); throw new Error('Frozen input already exists; extraction will not be repeated'); } catch (error) {
  if (error instanceof Error && error.message.includes('already exists')) throw error;
}

const corpusRoot = 'C:/Users/swapn/Downloads/Radar V2/audit-reports/phase5-100-case-corpus';
const prior = JSON.parse(await readFile('.radar/dossier-runs/2070-health-case-01-accepted.json', 'utf8')) as { evidence: { lineage: EvidenceSource[] }; acquisition: AcquisitionAttempt[] };
const base = await readSliceInput(`${corpusRoot}/cases.jsonl`, '01', [
  `${corpusRoot}/Swapnil_Shukla_Executive_Resume_v3.md`,
  `${corpusRoot}/Swapnil_Shukla_Resume_M.md`,
]);
const input: SliceInput = { ...base, sources: [...base.sources, ...prior.evidence.lineage.filter(source => source.plane === 'CONTEXT')] };
const frozenContext: ContextProvider = {
  id: 'frozen-context',
  async acquire() { return { sources: [], attempts: prior.acquisition }; },
};
const project = process.env.GCP_PROJECT_ID;
if (!project) throw new Error('GCP_PROJECT_ID required for production extraction');
const extractionModel = new GeminiJsonModel(project, adcTokenProvider(), fetch, { model: 'gemini-2.5-flash', maxOutputTokens: 24576, temperature: 0.25, timeoutMs: 240000 });
const frozen = await prepareFrozenResearchInput(input, [frozenContext], extractionModel);
await writeFile(output, JSON.stringify(frozen, null, 2));
console.log(output);
