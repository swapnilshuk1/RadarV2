import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { getDatabaseAdapter } from '../src/data/database';

const profileVersion = 'projection-8acff2997f98e0d6418d8b01c5244128a6b9d6aa61232a5e791afd6210fea8e4';
const jobIds = [
  '0324d299f63029cb6ea39f33fd4d3d36325bdcdd5cb9c654cbe59a5022bca919',
  '04e5d72ede7c9d3a6fd2843ea63340b193a5d3792acb9f7f125c4855d8bef172',
  '0790b99e515da51b9ad44dd9d513bbc1a3267c9cd5d77f8dc38a6b56b5ba962b',
  '09421323bb5c680b3b55be75f0c97c5369ac9db542963dca88a59611fb55c8ac',
  '09424218e8ee80e243b1740867e468f9415dca97ac4e4d1fcd159f7a5bee4f75',
  '0b3b761ed55ecb2720f197203d2b0b1e8e0e7489860403e9fa2537b0e86136c9',
  '06d0d80ea8b1aa5d7b27a0b3027dc8d748002568e574da51cdcd7207a28a3184',
];

function csvValue(): string {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (token) return token;
  const lines = readFileSync('bedrock-long-term-api-key.csv', 'utf8').trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(value => value.trim().replace(/^"|"$/g, ''));
  const values = lines[1].split(',').map(value => value.trim().replace(/^"|"$/g, ''));
  const index = headers.findIndex(header => ['ServiceApiKeyValue', 'API key', 'API key value'].includes(header));
  if (index < 0 || !values[index]) throw new Error('Bedrock API key is unavailable');
  return values[index];
}

const environment = { ...process.env, AWS_BEARER_TOKEN_BEDROCK: csvValue() };

function runScript(args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', ...args], {
    cwd: process.cwd(), env: environment, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || `Command failed with exit ${result.status}`);
  }
  const start = result.stdout.indexOf('\n{');
  return JSON.parse(result.stdout.slice(start >= 0 ? start + 1 : result.stdout.indexOf('{')));
}

const db = getDatabaseAdapter();
const enqueued = jobIds.map(jobId => runScript([
  'scripts/backfill-staged-evaluations.ts', '--limit', '1', '--job-hash', jobId,
  '--profile-version', profileVersion,
]));
const contextFingerprint = enqueued[0]?.contextFingerprint;
if (!contextFingerprint) throw new Error('Backfill did not return a context fingerprint');

const rounds: unknown[] = [];
for (let round = 0; round < 10; round += 1) {
  rounds.push(runScript(['scripts/process-staged-evaluation-jobs.ts', '--max-jobs=7']));
  const pending = await db.many<any>(
    'SELECT status,next_attempt_at FROM evaluation_jobs WHERE evaluation_context_fingerprint=? AND status IN (\'staged_pending\',\'staged_processing\')',
    [contextFingerprint],
  );
  if (!pending.length) break;
  const next = pending.map(row => Date.parse(`${row.next_attempt_at}Z`)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const delay = Math.max(1000, Math.min(30000, next ? next - Date.now() : 5000));
  await new Promise(resolve => setTimeout(resolve, delay));
}

const jobs = await db.many<any>('SELECT canonical_job_id,status,attempts,last_error FROM evaluation_jobs WHERE evaluation_context_fingerprint=?', [contextFingerprint]);
const rows = await db.many<any>(`SELECT ov.job_title,se.decision,se.screening_viability,se.evaluation_json
  FROM staged_evaluations se JOIN opportunity_versions ov
  ON ov.canonical_job_id=se.canonical_job_id AND ov.id=se.opportunity_version
  WHERE se.evaluation_context_fingerprint=? ORDER BY se.evaluated_at`, [contextFingerprint]);
const records = rows.map(row => {
  const evaluation = JSON.parse(row.evaluation_json);
  const requirements = evaluation.trace?.requirements ?? [];
  return {
    title: row.job_title,
    decision: row.decision,
    screeningViability: row.screening_viability,
    requirements: requirements.map((item: any) => ({
      id: item.id, requirement: item.requirement, strength: item.strength,
      roleImportance: item.roleImportance, screeningFunction: item.screeningFunction,
      screeningGateBasis: item.screeningGateBasis, screeningGate: item.screeningGate,
      status: item.status, candidateClaimIds: item.candidateClaimIds,
    })),
  };
});

const assertions = {
  cargillNewProductDevelopmentNonGate: records
    .find(row => /R&D Leader|Health & Nutrition/i.test(row.title))?.requirements
    .find((item: any) => /New Product Development/i.test(item.requirement))?.screeningGate === false,
  spiceMoneyNotDeadLetter: !jobs.some(row => row.canonical_job_id.startsWith('0324') && row.status === 'staged_dead_letter'),
  alvarezNotDeadLetter: !jobs.some(row => row.canonical_job_id.startsWith('0b3b') && row.status === 'staged_dead_letter'),
  travelPpcNotDeadLetter: !jobs.some(row => row.canonical_job_id.startsWith('06d0') && row.status === 'staged_dead_letter'),
};

writeFileSync('.radar/dossier-runs/staged-v4-verification.json', JSON.stringify({
  policyVersion: 'staged-v4', profileVersion, contextFingerprint, enqueued, rounds, jobs, records, assertions,
}, null, 2));
console.log(JSON.stringify({written: '.radar/dossier-runs/staged-v4-verification.json', contextFingerprint, jobs, assertions}, null, 2));
if (!Object.values(assertions).every(Boolean)) process.exitCode = 1;
