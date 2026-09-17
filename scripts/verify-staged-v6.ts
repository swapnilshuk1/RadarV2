import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { getDatabaseAdapter } from '../src/data/database';
import {
  STAGED_CONTRACT_VERSION,
  STAGED_POLICY_VERSION,
} from '../src/data/sqlite/repositories/SqliteStagedEvaluationStore';

const PRODUCTION_CANDIDATE_SHA = '7f93c09c78c5194b38b502bd7af3f84962b67aef';
const V4_CONTEXT_FINGERPRINT = '1b676dab40587d5ea24c513b0793c242302795a0e020a3d4d9e6cb74e6c9b7f5';
const V5_CONTEXT_FINGERPRINT = '8263d65affc06cb64f95c0e0f2c80fd9948788b12d9472b15032fa0be702b8c1';
const PROFILE_VERSION = 'projection-8acff2997f98e0d6418d8b01c5244128a6b9d6aa61232a5e791afd6210fea8e4';
const OUTPUT_PATH = '.radar/dossier-runs/staged-v6-verification.json';

const jobIds = [
  '0324d299f63029cb6ea39f33fd4d3d36325bdcdd5cb9c654cbe59a5022bca919',
  '04e5d72ede7c9d3a6fd2843ea63340b193a5d3792acb9f7f125c4855d8bef172',
  '0790b99e515da51b9ad44dd9d513bbc1a3267c9cd5d77f8dc38a6b56b5ba962b',
  '09421323bb5c680b3b55be75f0c97c5369ac9db542963dca88a59611fb55c8ac',
  '09424218e8ee80e243b1740867e468f9415dca97ac4e4d1fcd159f7a5bee4f75',
  '0b3b761ed55ecb2720f197203d2b0b1e8e0e7489860403e9fa2537b0e86136c9',
  '06d0d80ea8b1aa5d7b27a0b3027dc8d748002568e574da51cdcd7207a28a3184',
] as const;

function bedrockToken(): string {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (token) return token;

  const lines = readFileSync('bedrock-long-term-api-key.csv', 'utf8').trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(value => value.trim().replace(/^"|"$/g, ''));
  const values = lines[1].split(',').map(value => value.trim().replace(/^"|"$/g, ''));
  const index = headers.findIndex(header => ['ServiceApiKeyValue', 'API key', 'API key value'].includes(header));
  if (index < 0 || !values[index]) throw new Error('Bedrock API key is unavailable');
  return values[index];
}

const environment = { ...process.env, AWS_BEARER_TOKEN_BEDROCK: bedrockToken() };

function runScript(args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', ...args], {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || `Command failed with exit ${result.status}`);
  }
  const start = result.stdout.indexOf('\n{');
  const jsonStart = start >= 0 ? start + 1 : result.stdout.indexOf('{');
  if (jsonStart < 0) throw new Error(`Command produced no JSON: ${args.join(' ')}`);
  return JSON.parse(result.stdout.slice(jsonStart));
}

function git(args: string[]): string {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

const releaseCommit = git(['rev-parse', 'HEAD']);
const candidateAncestor = spawnSync(
  'git',
  ['merge-base', '--is-ancestor', PRODUCTION_CANDIDATE_SHA, 'HEAD'],
  { cwd: process.cwd(), encoding: 'utf8' },
);
if (candidateAncestor.status !== 0) {
  throw new Error(`Production candidate ${PRODUCTION_CANDIDATE_SHA} is not an ancestor of HEAD ${releaseCommit}`);
}
const candidateDelta = git(['diff', '--name-only', `${PRODUCTION_CANDIDATE_SHA}..HEAD`])
  .split(/\r?\n/)
  .filter(Boolean);
if (candidateDelta.some(path => path !== 'scripts/verify-staged-v6.ts')) {
  throw new Error(`Production candidate is not frozen; unexpected post-candidate changes: ${candidateDelta.join(', ')}`);
}
if (STAGED_POLICY_VERSION !== 'staged-v6' || STAGED_CONTRACT_VERSION !== 'staged-decision-v6') {
  throw new Error(`Unexpected staged identities: ${STAGED_POLICY_VERSION} / ${STAGED_CONTRACT_VERSION}`);
}

const db = getDatabaseAdapter();
const placeholders = jobIds.map(() => '?').join(',');

async function scalarCount(sql: string, params: unknown[] = []): Promise<number> {
  const row = await db.one<{ count: number }>(sql, params);
  return Number(row?.count ?? 0);
}

async function activePointers(tenantId: string, personId: string) {
  return db.many<any>(
    `SELECT tenant_id,person_id,search_plan_id,context_fingerprint,activated_by,activated_at
     FROM active_evaluation_contexts
     WHERE tenant_id=? AND person_id=?
     ORDER BY search_plan_id,context_fingerprint`,
    [tenantId, personId],
  );
}

async function canonicalDecisions(tenantId: string, personId: string) {
  return db.many<any>(
    `SELECT id,tenant_id,person_id,canonical_job_id,action,reason,reviewed_fingerprint,updated_at,created_at
     FROM canonical_decisions
     WHERE tenant_id=? AND person_id=?
     ORDER BY canonical_job_id`,
    [tenantId, personId],
  );
}

async function stagedRows(contextFingerprint: string) {
  return db.many<any>(
    `SELECT se.canonical_job_id,se.opportunity_version,se.evaluation_context_fingerprint,se.profile_version,
            se.policy_version,se.input_fingerprint,se.source_fingerprints_json,se.contract_version,
            se.decision,se.screening_viability,se.evaluation_json,ov.job_title
     FROM staged_evaluations se
     JOIN opportunity_versions ov
       ON ov.canonical_job_id=se.canonical_job_id AND ov.id=se.opportunity_version
     WHERE se.evaluation_context_fingerprint=?
       AND se.canonical_job_id IN (${placeholders})
     ORDER BY se.canonical_job_id`,
    [contextFingerprint, ...jobIds],
  );
}

function parseSourceFingerprints(value: string): string[] {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('Invalid source_fingerprints_json');
  }
  return [...parsed].sort();
}

function normalizedRequirement(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

type RequirementRecord = {
  id: string;
  requirement: string;
  strength: string;
  roleImportance: string;
  screeningFunction: string;
  screeningGateBasis: string;
  screeningGate: boolean;
  screeningSupportQuoteIds: string[];
  status: string;
  candidateClaimIds: string[];
};

type RoleRecord = {
  canonicalJobId: string;
  title: string;
  decision: string | null;
  screeningViability: string | null;
  requirements: RequirementRecord[];
};

function recordsFromRows(rows: any[]): RoleRecord[] {
  return rows.map(row => {
    const evaluation = JSON.parse(row.evaluation_json);
    const requirements = evaluation.trace?.requirements ?? [];
    return {
      canonicalJobId: row.canonical_job_id,
      title: row.job_title,
      decision: row.decision ?? null,
      screeningViability: row.screening_viability ?? null,
      requirements: requirements.map((item: any) => ({
        id: item.id,
        requirement: item.requirement,
        strength: item.strength,
        roleImportance: item.roleImportance,
        screeningFunction: item.screeningFunction,
        screeningGateBasis: item.screeningGateBasis,
        screeningGate: item.screeningGate,
        screeningSupportQuoteIds: Array.isArray(item.screeningSupportQuoteIds)
          ? item.screeningSupportQuoteIds
          : [],
        status: item.status,
        candidateClaimIds: item.candidateClaimIds,
      })),
    };
  });
}

function findRequirement(records: RoleRecord[], title: RegExp, requirement: RegExp) {
  return records.find(row => title.test(row.title))?.requirements.find(item => requirement.test(item.requirement));
}

function gateTriple(item: RequirementRecord | undefined) {
  return item
    ? {
        screeningFunction: item.screeningFunction,
        screeningGateBasis: item.screeningGateBasis,
        screeningGate: item.screeningGate,
      }
    : null;
}

function beforeAfterMatrix(v4: RoleRecord[], v6: RoleRecord[]) {
  const v4ByJob = new Map(v4.map(role => [role.canonicalJobId, role]));
  const v6ByJob = new Map(v6.map(role => [role.canonicalJobId, role]));
  const matrix: unknown[] = [];

  for (const jobId of jobIds) {
    const before = v4ByJob.get(jobId);
    const after = v6ByJob.get(jobId);
    const beforeMap = new Map((before?.requirements ?? []).map(item => [normalizedRequirement(item.requirement), item]));
    const afterMap = new Map((after?.requirements ?? []).map(item => [normalizedRequirement(item.requirement), item]));
    const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

    for (const key of keys) {
      const v4Requirement = beforeMap.get(key);
      const v6Requirement = afterMap.get(key);
      const same = Boolean(v4Requirement && v6Requirement)
        && JSON.stringify(gateTriple(v4Requirement)) === JSON.stringify(gateTriple(v6Requirement));
      matrix.push({
        canonicalJobId: jobId,
        title: after?.title ?? before?.title ?? 'Unknown role',
        requirement: v6Requirement?.requirement ?? v4Requirement?.requirement ?? key,
        v4: gateTriple(v4Requirement),
        v6: gateTriple(v6Requirement),
        category: !v4Requirement
          ? 'REQUIREMENT_NEW_IN_V6'
          : !v6Requirement
            ? 'REQUIREMENT_MISSING_IN_V6'
            : same
              ? (v6Requirement.screeningGate ? 'UNCHANGED_GATE' : 'UNCHANGED_NON_GATE')
              : 'SEMANTIC_CHANGE',
      });
    }
  }
  return matrix;
}

const preview = runScript([
  'scripts/backfill-staged-evaluations.ts',
  '--dry-run',
  '--limit', '1',
  '--job-hash', jobIds[0],
  '--profile-version', PROFILE_VERSION,
]);
const contextFingerprint = preview?.contextFingerprint as string | undefined;
if (!contextFingerprint) throw new Error('Dry-run backfill did not return a v6 context fingerprint');
if (contextFingerprint === V4_CONTEXT_FINGERPRINT || contextFingerprint === V5_CONTEXT_FINGERPRINT) {
  throw new Error('v6 context fingerprint must differ from v4 and v5');
}

const scope = await db.one<{ tenant_id: string; person_id: string }>(
  `SELECT tenant_id,person_id FROM active_evaluation_contexts ORDER BY activated_at DESC LIMIT 1`,
);
if (!scope) throw new Error('Active serving scope is unavailable for isolation snapshot');

const controlsBefore = {
  activePointers: await activePointers(scope.tenant_id, scope.person_id),
  canonicalDecisions: await canonicalDecisions(scope.tenant_id, scope.person_id),
  materializedForV6Context: await scalarCount(
    'SELECT COUNT(*) AS count FROM materialized_evaluations WHERE evaluation_context_fingerprint=?',
    [contextFingerprint],
  ),
  stagedRowsForV6Context: await scalarCount(
    `SELECT COUNT(*) AS count FROM staged_evaluations
     WHERE evaluation_context_fingerprint=? AND canonical_job_id IN (${placeholders})`,
    [contextFingerprint, ...jobIds],
  ),
};

const enqueued = jobIds.map(jobId => runScript([
  'scripts/backfill-staged-evaluations.ts',
  '--limit', '1',
  '--job-hash', jobId,
  '--profile-version', PROFILE_VERSION,
]));
const contextFingerprints = [...new Set(enqueued.map(item => item?.contextFingerprint).filter(Boolean))];
if (contextFingerprints.length !== 1 || contextFingerprints[0] !== contextFingerprint) {
  throw new Error(`Backfill context drift: ${JSON.stringify(contextFingerprints)}`);
}

const rounds: unknown[] = [];
for (let round = 0; round < 12; round += 1) {
  rounds.push(runScript(['scripts/process-staged-evaluation-jobs.ts', '--max-jobs=7']));
  const pending = await db.many<any>(
    `SELECT status,next_attempt_at FROM evaluation_jobs
     WHERE evaluation_context_fingerprint=?
       AND canonical_job_id IN (${placeholders})
       AND status IN ('staged_pending','staged_processing')`,
    [contextFingerprint, ...jobIds],
  );
  if (!pending.length) break;
  const next = pending
    .map(row => Date.parse(`${row.next_attempt_at}Z`))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const delay = Math.max(1000, Math.min(30000, next ? next - Date.now() : 5000));
  await new Promise(resolve => setTimeout(resolve, delay));
}

const jobs = await db.many<any>(
  `SELECT canonical_job_id,status,attempts,last_error
   FROM evaluation_jobs
   WHERE evaluation_context_fingerprint=? AND canonical_job_id IN (${placeholders})
   ORDER BY canonical_job_id`,
  [contextFingerprint, ...jobIds],
);
const v4Rows = await stagedRows(V4_CONTEXT_FINGERPRINT);
const v6Rows = await stagedRows(contextFingerprint);
const v4Records = recordsFromRows(v4Rows);
const v6Records = recordsFromRows(v6Rows);

const v4ByJob = new Map(v4Rows.map(row => [row.canonical_job_id, row]));
const v6ByJob = new Map(v6Rows.map(row => [row.canonical_job_id, row]));
const frozenInputComparisons = jobIds.map(canonicalJobId => {
  const before = v4ByJob.get(canonicalJobId);
  const after = v6ByJob.get(canonicalJobId);
  const sourceFingerprintsV4 = before ? parseSourceFingerprints(before.source_fingerprints_json) : [];
  const sourceFingerprintsV6 = after ? parseSourceFingerprints(after.source_fingerprints_json) : [];
  const opportunityVersionEqual = Boolean(before && after && before.opportunity_version === after.opportunity_version);
  const profileVersionEqual = Boolean(before && after && before.profile_version === after.profile_version);
  const inputFingerprintEqual = Boolean(before && after && before.input_fingerprint === after.input_fingerprint);
  const sourceFingerprintsEqual = Boolean(
    before && after && JSON.stringify(sourceFingerprintsV4) === JSON.stringify(sourceFingerprintsV6)
  );
  const state = !before
    ? 'BASELINE_MISSING'
    : !after
      ? 'OUTPUT_NOT_MATERIALIZED'
      : opportunityVersionEqual && profileVersionEqual && inputFingerprintEqual && sourceFingerprintsEqual
        ? 'EQUIVALENT'
        : 'MISMATCH';
  return {
    canonicalJobId,
    state,
    opportunityVersionEqual,
    profileVersionEqual,
    inputFingerprintEqual,
    sourceFingerprintsEqual,
    v4: before ? {
      opportunityVersion: before.opportunity_version,
      profileVersion: before.profile_version,
      inputFingerprint: before.input_fingerprint,
      sourceFingerprints: sourceFingerprintsV4,
    } : null,
    v6: after ? {
      opportunityVersion: after.opportunity_version,
      profileVersion: after.profile_version,
      inputFingerprint: after.input_fingerprint,
      sourceFingerprints: sourceFingerprintsV6,
    } : null,
  };
});

const controlsAfter = {
  activePointers: await activePointers(scope.tenant_id, scope.person_id),
  canonicalDecisions: await canonicalDecisions(scope.tenant_id, scope.person_id),
  materializedForV6Context: await scalarCount(
    'SELECT COUNT(*) AS count FROM materialized_evaluations WHERE evaluation_context_fingerprint=?',
    [contextFingerprint],
  ),
  v6ContextActivePointers: await scalarCount(
    'SELECT COUNT(*) AS count FROM active_evaluation_contexts WHERE context_fingerprint=?',
    [contextFingerprint],
  ),
};

const cargillNpd = findRequirement(v6Records, /R&D Leader|Health & Nutrition/i, /New Product Development/i);
const travelGa4 = findRequirement(v6Records, /Travel PPC/i, /GA4|Google Tag Manager/i);
const changeFramework = findRequirement(v6Records, /Change Management/i, /Strong grounding in change frameworks/i);
const spiceTools = findRequirement(v6Records, /Product Growth Head|Spice Money/i, /Google Sheets|Tableau|CRM dashboards|Excel-based/i);
const cargillDegree = findRequirement(v6Records, /R&D Leader|Health & Nutrition/i, /Bachelor'?s degree/i);
const cargillMinimumTenure = findRequirement(v6Records, /R&D Leader|Health & Nutrition/i, /Minimum 10 years/i);
const travelPpcTenure = findRequirement(v6Records, /Travel PPC/i, /2.?5 years.*PPC|2.?5 years.*Performance Marketing/i);
const travelInboundCalls = findRequirement(v6Records, /Travel PPC/i, /Experience generating inbound calls/i);
const changeTenure = findRequirement(v6Records, /Change Management/i, /5.?10 years of experience in Change Management/i);
const travelUsMarket = findRequirement(v6Records, /Travel PPC/i, /Experience managing campaigns targeting the US market/i);
const allRequirements = v6Records.flatMap(role => role.requirements);
const preferredEntryGates = allRequirements.filter(
  item => item.strength === 'PREFERRED' && item.screeningGate,
);
const requirementsWithoutQuoteProvenance = allRequirements.filter(
  item => !item.screeningSupportQuoteIds.length,
);

const assertions = {
  productionCandidateFrozen: candidateDelta.every(path => path === 'scripts/verify-staged-v6.ts'),
  stagedIdentityIsV6: STAGED_POLICY_VERSION === 'staged-v6' && STAGED_CONTRACT_VERSION === 'staged-decision-v6',
  contextFingerprintChangedFromV4AndV5:
    contextFingerprint !== V4_CONTEXT_FINGERPRINT && contextFingerprint !== V5_CONTEXT_FINGERPRINT,
  v4BaselineComplete: v4Rows.length === jobIds.length,
  v6PopulationComplete: v6Rows.length === jobIds.length,
  frozenInputsContainNoMismatch: !frozenInputComparisons.some(item =>
    item.state === 'MISMATCH' || item.state === 'BASELINE_MISSING'
  ),
  frozenInputsFullyEquivalent: frozenInputComparisons.every(item => item.state === 'EQUIVALENT'),
  allSevenCompleted: jobs.length === jobIds.length && jobs.every(row => row.status === 'staged_completed'),
  zeroDeadLetters: !jobs.some(row => row.status === 'staged_dead_letter'),
  noV6ServingActivation: controlsAfter.v6ContextActivePointers === 0,
  activeServingPointersUnchanged: JSON.stringify(controlsBefore.activePointers) === JSON.stringify(controlsAfter.activePointers),
  noLegacyMaterialization:
    controlsBefore.materializedForV6Context === 0 && controlsAfter.materializedForV6Context === 0,
  canonicalDecisionsUnchanged:
    JSON.stringify(controlsBefore.canonicalDecisions) === JSON.stringify(controlsAfter.canonicalDecisions),
  quoteProvenancePersistedForEveryRequirement: requirementsWithoutQuoteProvenance.length === 0,
  cargillNewProductDevelopmentNonGate: cargillNpd?.screeningGate === false,
  travelPpcGa4NonGate: travelGa4?.screeningGate === false,
  changeFrameworkGroundingNonGate: changeFramework?.screeningGate === false,
  spiceMoneyDataToolsNonGate: spiceTools?.screeningGate === false,
  cargillDegreeGatePreserved:
    cargillDegree?.screeningGate === true && cargillDegree.screeningGateBasis === 'MANDATORY_CREDENTIAL',
  cargillMinimumTenureGatePreserved:
    cargillMinimumTenure?.screeningGate === true && cargillMinimumTenure.screeningGateBasis === 'MINIMUM_TENURE',
  travelPpcTenureGatePreserved:
    travelPpcTenure?.screeningGate === true && travelPpcTenure.screeningGateBasis === 'MINIMUM_TENURE',
  travelInboundCallExperienceGatePreserved:
    travelInboundCalls?.screeningGate === true && travelInboundCalls.screeningGateBasis === 'PRIOR_RELEVANT_EXPERIENCE',
  changeManagementTenureGatePreserved:
    changeTenure?.screeningGate === true && changeTenure.screeningGateBasis === 'MINIMUM_TENURE',
  preferredRequirementEntryGateCountZero: preferredEntryGates.length === 0,
};

const observations = {
  travelUsMarketCampaigns: gateTriple(travelUsMarket),
};

const matrix = beforeAfterMatrix(v4Records, v6Records);
const result = {
  productionCandidateSha: PRODUCTION_CANDIDATE_SHA,
  releaseCommit,
  candidateDelta,
  policyVersion: STAGED_POLICY_VERSION,
  contractVersion: STAGED_CONTRACT_VERSION,
  profileVersion: PROFILE_VERSION,
  v4ContextFingerprint: V4_CONTEXT_FINGERPRINT,
  v5ContextFingerprint: V5_CONTEXT_FINGERPRINT,
  contextFingerprint,
  preview,
  enqueued,
  rounds,
  jobs,
  controlsBefore,
  controlsAfter,
  frozenInputComparisons,
  v4Records,
  v6Records,
  beforeAfterMatrix: matrix,
  requirementsWithoutQuoteProvenance,
  preferredEntryGates,
  observations,
  assertions,
};

mkdirSync('.radar/dossier-runs', { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  written: OUTPUT_PATH,
  productionCandidateSha: PRODUCTION_CANDIDATE_SHA,
  releaseCommit,
  contextFingerprint,
  jobs,
  observations,
  assertions,
}, null, 2));

if (!Object.values(assertions).every(Boolean)) process.exitCode = 1;
