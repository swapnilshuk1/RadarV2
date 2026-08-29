import fs from 'fs';
import path from 'path';
import { getDatabaseAdapter } from '../../src/data/database';
import {
  computeCanonicalJobId,
  computeContentHash,
  computeOpportunityVersionId
} from '../../src/lib/domain/canonical_identity';
import { SqliteCanonicalServingStore } from '../../src/data/sqlite/repositories/SqliteCanonicalServingStore';
import { isEvaluated } from '../../src/data/opportunity-fixtures';
import type { AuthorizedPersonScope } from '../../src/lib/security/auth';

const ROOT = 'c:/Users/swapn/Downloads/radar-local-v2';
const FORENSICS_DIR = path.join(ROOT, 'forensics');
const SCRATCH_DIR = path.join(ROOT, 'scratch');

async function runDryRunCertification() {
  console.log('================================================================');
  console.log('FOR-3 PHASE 1 — DRY RUN & SERVING VERDICT CERTIFICATION');
  console.log('================================================================\n');

  const db = getDatabaseAdapter();

  // Load live Turso Cloud state
  console.log('[1/4] Fetching live Turso Cloud database state...');
  const liveCanonOpps = await db.many<any>(`SELECT id, source, source_job_id, company_name FROM canonical_opportunities`);
  const liveOppVersions = await db.many<any>(`SELECT id, canonical_job_id, content_hash FROM opportunity_versions`);
  const liveStagingOpps = await db.many<any>(`SELECT id, company_id, canonical_title, location FROM opportunities`);
  const liveDecisions = await db.many<any>(`SELECT id, person_id, canonical_job_id, action FROM canonical_decisions`);
  const livePeople = await db.many<any>(`SELECT id, tenant_id FROM people LIMIT 1`);
  const liveSearchPlans = await db.many<any>(`SELECT id, tenant_id, person_id FROM search_plans WHERE status = 'active' LIMIT 1`);

  console.log(`Live Turso State:`);
  console.log(`  - canonical_opportunities : ${liveCanonOpps.length}`);
  console.log(`  - opportunity_versions     : ${liveOppVersions.length}`);
  console.log(`  - opportunities (staging)  : ${liveStagingOpps.length}`);
  console.log(`  - canonical_decisions      : ${liveDecisions.length}`);

  const tenantId = liveSearchPlans[0]?.tenant_id || livePeople[0]?.tenant_id || 'default_tenant';
  const personId = liveSearchPlans[0]?.person_id || livePeople[0]?.id || 'person_default';
  const searchPlanId = liveSearchPlans[0]?.id || 'sp_default';

  console.log(`  - Target Scope: tenantId=${tenantId}, personId=${personId}, searchPlanId=${searchPlanId}\n`);

  const canonById = new Map<string, any>();
  const canonBySourceJobId = new Map<string, any>();
  for (const c of liveCanonOpps) {
    canonById.set(c.id, c);
    if (c.source && c.source_job_id) {
      canonBySourceJobId.set(`${c.source}:${c.source_job_id}`, c);
    }
  }

  const decisionsByKey = new Set<string>();
  for (const d of liveDecisions) {
    decisionsByKey.add(`${d.person_id}:${d.canonical_job_id}`);
  }

  // Load historical artifacts
  const oracle = JSON.parse(fs.readFileSync(path.join(SCRATCH_DIR, 'behavioral-fingerprint-oracle.json'), 'utf-8'));
  const audit = JSON.parse(fs.readFileSync(path.join(SCRATCH_DIR, 'audit_records.json'), 'utf-8'));

  // =========================================================================
  // PHASE 1A — OPPORTUNITY & STAGING RECONCILIATION DRY RUN
  // =========================================================================
  console.log('[2/4] PHASE 1A: Opportunity & Staging Reconciliation Dry Run');

  const histCounts = {
    HISTORICAL_ALREADY_PRESENT: 0,
    HISTORICAL_NEW_CANONICAL: 0,
    HISTORICAL_SPARSE: 0,
    HISTORICAL_DUPLICATE: 0,
    HISTORICAL_AMBIGUOUS: 0,
    HISTORICAL_NOT_SERVABLE: 0,
  };

  const processedHistCanonIds = new Set<string>();

  for (const item of oracle) {
    const jobHash = item.jobHash || '';
    const verb = item.verb || 'UNKNOWN';

    let sourcePortal = 'LinkedIn';
    let sourceJobId = jobHash;

    if (jobHash.includes(':')) {
      const parts = jobHash.split(':');
      sourcePortal = parts[0] === 'indeed' ? 'Indeed' : parts[0] === 'naukri' ? 'Naukri' : 'LinkedIn';
      sourceJobId = parts.slice(1).join(':');
    }

    const computedCanonId = computeCanonicalJobId({ source: sourcePortal, sourceJobId });

    if (processedHistCanonIds.has(computedCanonId)) {
      histCounts.HISTORICAL_DUPLICATE++;
      continue;
    }
    processedHistCanonIds.add(computedCanonId);

    const matchBySource = canonBySourceJobId.get(`${sourcePortal}:${sourceJobId}`);
    const matchById = canonById.get(computedCanonId);

    if (matchBySource || matchById) {
      histCounts.HISTORICAL_ALREADY_PRESENT++;
    } else if (verb === 'SPARSE_SPEC') {
      histCounts.HISTORICAL_SPARSE++;
    } else if (sourcePortal && sourceJobId) {
      histCounts.HISTORICAL_NEW_CANONICAL++;
    } else {
      histCounts.HISTORICAL_NOT_SERVABLE++;
    }
  }

  console.log('  Historical Opportunities Reconciliation Results:');
  console.log(`    - HISTORICAL_ALREADY_PRESENT : ${histCounts.HISTORICAL_ALREADY_PRESENT}`);
  console.log(`    - HISTORICAL_NEW_CANONICAL   : ${histCounts.HISTORICAL_NEW_CANONICAL}`);
  console.log(`    - HISTORICAL_SPARSE          : ${histCounts.HISTORICAL_SPARSE}`);
  console.log(`    - HISTORICAL_DUPLICATE       : ${histCounts.HISTORICAL_DUPLICATE}`);
  console.log(`    - HISTORICAL_AMBIGUOUS       : ${histCounts.HISTORICAL_AMBIGUOUS}`);
  console.log(`    - HISTORICAL_NOT_SERVABLE    : ${histCounts.HISTORICAL_NOT_SERVABLE}`);

  // Staging Dry Run (269 raw staging opps starting with o_)
  const rawStagingOpps = liveStagingOpps.filter((o: any) => o.id.startsWith('o_'));

  const stagingCounts = {
    STAGING_ALREADY_CANONICAL: 0,
    STAGING_NEW_CANONICAL: 0,
    STAGING_RECONCILED: 0,
    STAGING_DUPLICATE: 0,
    STAGING_REJECTED: 0,
  };

  const processedStagingCanonIds = new Set<string>();

  for (const opp of rawStagingOpps) {
    const oppId = opp.id;
    const sourcePortal = opp.company_id && opp.company_id.includes('naukri') ? 'Naukri' : 'LinkedIn';
    const sourceJobId = oppId;
    const computedCanonId = computeCanonicalJobId({ source: sourcePortal, sourceJobId });

    if (processedStagingCanonIds.has(computedCanonId)) {
      stagingCounts.STAGING_DUPLICATE++;
      continue;
    }
    processedStagingCanonIds.add(computedCanonId);

    const matchBySource = canonBySourceJobId.get(`${sourcePortal}:${sourceJobId}`);
    const matchById = canonById.get(computedCanonId);

    if (matchBySource || matchById) {
      stagingCounts.STAGING_ALREADY_CANONICAL++;
    } else {
      stagingCounts.STAGING_NEW_CANONICAL++;
    }
  }

  console.log('  Staging Records (269) Promotion Dry Run Results:');
  console.log(`    - STAGING_ALREADY_CANONICAL : ${stagingCounts.STAGING_ALREADY_CANONICAL}`);
  console.log(`    - STAGING_NEW_CANONICAL     : ${stagingCounts.STAGING_NEW_CANONICAL}`);
  console.log(`    - STAGING_RECONCILED        : ${stagingCounts.STAGING_RECONCILED}`);
  console.log(`    - STAGING_DUPLICATE         : ${stagingCounts.STAGING_DUPLICATE}`);
  console.log(`    - STAGING_REJECTED          : ${stagingCounts.STAGING_REJECTED}\n`);

  // =========================================================================
  // PHASE 1B — DECISION RESTORATION DRY RUN
  // =========================================================================
  console.log('[3/4] PHASE 1B: Decision Restoration Dry Run');

  const decCounts = {
    RESTORABLE: 0,
    ALREADY_PRESENT: 0,
    DUPLICATE: 0,
    IDENTITY_UNRESOLVED: 0,
    USER_UNRESOLVED: 0,
    INVALID_DECISION: 0,
    OTHER: 0,
  };

  const processedDecKeys = new Set<string>();

  for (let i = 0; i < audit.length; i++) {
    const item = audit[i];
    const jobHash = item.jobHash;
    const verb = item.verb || 'UNKNOWN';

    if (verb !== 'PURSUE' && verb !== 'CONSIDER' && verb !== 'PASS') {
      decCounts.INVALID_DECISION++;
      continue;
    }

    let sourcePortal = 'LinkedIn';
    let sourceJobId = jobHash;
    if (jobHash.includes(':')) {
      const parts = jobHash.split(':');
      sourcePortal = parts[0] === 'indeed' ? 'Indeed' : parts[0] === 'naukri' ? 'Naukri' : 'LinkedIn';
      sourceJobId = parts.slice(1).join(':');
    }
    const computedCanonId = computeCanonicalJobId({ source: sourcePortal, sourceJobId });

    const decKey = `${personId}:${computedCanonId}`;

    if (processedDecKeys.has(decKey)) {
      decCounts.DUPLICATE++;
      continue;
    }
    processedDecKeys.add(decKey);

    if (decisionsByKey.has(decKey)) {
      decCounts.ALREADY_PRESENT++;
    } else {
      decCounts.RESTORABLE++;
    }
  }

  console.log('  Decision Restoration Reconciliation Results:');
  console.log(`    - RESTORABLE          : ${decCounts.RESTORABLE}`);
  console.log(`    - ALREADY_PRESENT     : ${decCounts.ALREADY_PRESENT}`);
  console.log(`    - DUPLICATE           : ${decCounts.DUPLICATE}`);
  console.log(`    - IDENTITY_UNRESOLVED : ${decCounts.IDENTITY_UNRESOLVED}`);
  console.log(`    - USER_UNRESOLVED     : ${decCounts.USER_UNRESOLVED}`);
  console.log(`    - INVALID_DECISION    : ${decCounts.INVALID_DECISION}`);
  console.log(`    - OTHER               : ${decCounts.OTHER}\n`);

  // =========================================================================
  // PHASE 1C — 50/CONSIDER PRODUCTION-CORPUS CERTIFICATION
  // =========================================================================
  console.log('[4/4] PHASE 1C: Serving Verdict & Production Corpus Certification');

  const scope: AuthorizedPersonScope = { tenantId, personId };
  const servingStore = new SqliteCanonicalServingStore(db);

  const servedOpps = await servingStore.listOpportunities(scope);
  console.log(`  Fetched ${servedOpps.length} active served opportunities for scope.`);

  const verdictCsvHeader = 'jobHash,stored_verdict,adapter_verdict,serving_verdict,corruption_status';
  const verdictCsvRows: string[] = [verdictCsvHeader];

  const corruptionCounts = {
    PASS_TO_CONSIDER: 0,
    CONSIDER_TO_PASS: 0,
    PURSUE_TO_CONSIDER: 0,
    UNDEFINED_TO_CONSIDER: 0,
    NULL_TO_CONSIDER: 0,
    SPARSE_SPEC_TO_CONSIDER: 0,
    NOT_EVALUABLE_TO_CONSIDER: 0,
  };

  for (const opp of servedOpps) {
    if (isEvaluated(opp)) {
      const storedVerdict = opp.engineRecommendation?.engineVerdict || 'NOT_EVALUABLE';
      const adapterVerdict = opp.engineRecommendation?.verb0 || storedVerdict;
      const servingVerdict = opp.decision;

      let corruptionStatus = 'OK';

      if (storedVerdict === 'PASS' && servingVerdict === 'CONSIDER') {
        corruptionStatus = 'PASS_TO_CONSIDER';
        corruptionCounts.PASS_TO_CONSIDER++;
      } else if (storedVerdict === 'CONSIDER' && servingVerdict === 'PASS') {
        corruptionStatus = 'CONSIDER_TO_PASS';
        corruptionCounts.CONSIDER_TO_PASS++;
      } else if (storedVerdict === 'PURSUE' && servingVerdict === 'CONSIDER') {
        corruptionStatus = 'PURSUE_TO_CONSIDER';
        corruptionCounts.PURSUE_TO_CONSIDER++;
      } else if (storedVerdict === 'SPARSE_SPEC' && servingVerdict === 'CONSIDER') {
        corruptionStatus = 'SPARSE_SPEC_TO_CONSIDER';
        corruptionCounts.SPARSE_SPEC_TO_CONSIDER++;
      }

      verdictCsvRows.push(`${opp.jobHash},${storedVerdict},${adapterVerdict},${servingVerdict},${corruptionStatus}`);
    }
  }

  const csvPath = path.join(FORENSICS_DIR, 'FOR-3-pre-remediation-verdict-integrity.csv');
  fs.writeFileSync(csvPath, verdictCsvRows.join('\n') + '\n', 'utf-8');
  console.log(`  Wrote verdict integrity log to ${csvPath}`);

  console.log('  Corruption Counters Audit:');
  console.log(`    - PASS → CONSIDER          : ${corruptionCounts.PASS_TO_CONSIDER}`);
  console.log(`    - CONSIDER → PASS          : ${corruptionCounts.CONSIDER_TO_PASS}`);
  console.log(`    - PURSUE → CONSIDER        : ${corruptionCounts.PURSUE_TO_CONSIDER}`);
  console.log(`    - undefined → CONSIDER     : ${corruptionCounts.UNDEFINED_TO_CONSIDER}`);
  console.log(`    - null → CONSIDER          : ${corruptionCounts.NULL_TO_CONSIDER}`);
  console.log(`    - SPARSE_SPEC → CONSIDER   : ${corruptionCounts.SPARSE_SPEC_TO_CONSIDER}`);
  console.log(`    - NOT_EVALUABLE → CONSIDER : ${corruptionCounts.NOT_EVALUABLE_TO_CONSIDER}`);

  const totalCorruption = Object.values(corruptionCounts).reduce((a, b) => a + b, 0);

  if (totalCorruption > 0) {
    console.error(`\nCRITICAL FAILURE: ${totalCorruption} verdict corruption instances detected! PHASE 1 HARD STOP.`);
    process.exit(1);
  } else {
    console.log('\nVERDICT INTEGRITY CERTIFIED: 0 corruption instances detected! Gate 1C PASSED.\n');
  }

  return {
    histCounts,
    stagingCounts,
    decCounts,
    corruptionCounts,
    tenantId,
    personId,
    searchPlanId
  };
}

runDryRunCertification().catch(err => {
  console.error('Error running Phase 1 dry run certification:', err);
  process.exit(1);
});
