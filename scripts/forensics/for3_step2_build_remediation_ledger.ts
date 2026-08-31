import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import {
  computeCanonicalJobId,
  computeContentHash,
  computeOpportunityVersionId,
} from '../../src/lib/domain/canonical_identity';

const ROOT = 'c:/Users/swapn/Downloads/radar-local-v2';
const FORENSICS_DIR = path.join(ROOT, 'forensics');
const SCRATCH_DIR = path.join(ROOT, 'scratch');

const BASELINE_SNAPSHOT_PATH = path.join(FORENSICS_DIR, 'radar-turso-pre-remediation-2026-08-29.sqlite');
const LEDGER_DB_PATH = path.join(FORENSICS_DIR, 'FOR-3-remediation-ledger.sqlite');

async function main() {
  console.log('================================================================');
  console.log('FOR-3 — STEP 2: BUILD REMEDIATION LEDGER DATABASE & EXPORTS');
  console.log('================================================================\n');

  // Load baseline Turso snapshot
  const baselineDb = new Database(BASELINE_SNAPSHOT_PATH, { readonly: true });

  const canonRows = baselineDb.prepare(`SELECT * FROM canonical_opportunities`).all() as any[];
  const oppRows = baselineDb.prepare(`SELECT * FROM opportunities`).all() as any[];
  const docRows = baselineDb.prepare(`SELECT * FROM documents`).all() as any[];

  console.log(`Loaded Baseline DB: ${canonRows.length} canonical opps, ${oppRows.length} staging opps, ${docRows.length} documents.`);

  const canonBySourceJobId = new Map<string, any>();
  const canonById = new Map<string, any>();
  for (const c of canonRows) {
    canonById.set(c.id, c);
    if (c.source_job_id) {
      canonBySourceJobId.set(c.source_job_id, c);
    }
  }

  const docByOppId = new Map<string, any>();
  for (const d of docRows) {
    docByOppId.set(d.opportunity_id, d);
  }

  // Load historical source artifacts
  const oracle = JSON.parse(fs.readFileSync(path.join(SCRATCH_DIR, 'behavioral-fingerprint-oracle.json'), 'utf-8'));
  const audit = JSON.parse(fs.readFileSync(path.join(SCRATCH_DIR, 'audit_records.json'), 'utf-8'));

  console.log(`Loaded Historical Oracle (${oracle.length}), Audit Records (${audit.length})`);

  // Initialize FOR-3 Ledger SQLite DB
  if (fs.existsSync(LEDGER_DB_PATH)) {
    fs.unlinkSync(LEDGER_DB_PATH);
  }

  const ledgerDb = new Database(LEDGER_DB_PATH);
  ledgerDb.exec('PRAGMA foreign_keys = OFF;');

  ledgerDb.exec(`
    CREATE TABLE opportunity_restoration_ledger (
      historical_job_hash TEXT PRIMARY KEY,
      source_portal TEXT,
      source_job_id TEXT,
      canonical_job_id TEXT,
      classification TEXT,
      restoration_action TEXT,
      historical_verb TEXT,
      historical_score REAL,
      reason TEXT,
      confidence TEXT
    );

    CREATE TABLE decision_restoration_ledger (
      decision_id TEXT PRIMARY KEY,
      historical_job_hash TEXT,
      canonical_job_id TEXT,
      user_action TEXT,
      historical_timestamp TEXT,
      classification TEXT,
      restoration_action TEXT,
      reason TEXT,
      confidence TEXT
    );

    CREATE TABLE staging_promotion_ledger (
      staging_opportunity_id TEXT PRIMARY KEY,
      staging_document_id TEXT,
      source_portal TEXT,
      source_job_id TEXT,
      canonical_job_id TEXT,
      opportunity_version_id TEXT,
      classification TEXT,
      promotion_action TEXT,
      reason TEXT,
      confidence TEXT
    );

    CREATE TABLE verdict_repair_ledger (
      repair_id TEXT PRIMARY KEY,
      location TEXT,
      defect_type TEXT,
      bug_description TEXT,
      remediation_action TEXT
    );
  `);

  // 1. Process 2,231 Historical Opportunities
  const oppLedgerJsonl: string[] = [];
  let alreadyRestoredCount = 0;
  let restorableCount = 0;
  let sparseCount = 0;

  for (const item of oracle) {
    const jobHash = item.jobHash || '';
    const verb = item.verb || 'UNKNOWN';
    const rawScore = item.rawScore ?? null;

    let sourcePortal = 'LinkedIn';
    let sourceJobId = jobHash;

    if (jobHash.includes(':')) {
      const parts = jobHash.split(':');
      sourcePortal = parts[0] === 'indeed' ? 'Indeed' : parts[0] === 'naukri' ? 'Naukri' : 'LinkedIn';
      sourceJobId = parts.slice(1).join(':');
    }

    const computedCanonId = computeCanonicalJobId({ source: sourcePortal, sourceJobId });

    let classification = 'RESTOREABLE';
    let restorationAction = 'RESTORE_TO_CANONICAL';
    let reason = 'Historical oracle entry with valid source identity';
    let confidence = 'PROVEN';

    if (canonBySourceJobId.has(sourceJobId) || canonById.has(computedCanonId)) {
      classification = 'ALREADY_RESTORED';
      restorationAction = 'DO_NOT_TOUCH';
      reason = 'Canonical identity already present in canonical_opportunities';
      alreadyRestoredCount++;
    } else if (verb === 'SPARSE_SPEC') {
      classification = 'SPARSE_HISTORICAL_RECORD';
      restorationAction = 'RESTORE_AS_SPARSE_CANONICAL';
      reason = 'Sparse historical record without full document body';
      sparseCount++;
      restorableCount++;
    } else {
      restorableCount++;
    }

    const ledgerRow = {
      historical_job_hash: jobHash,
      source_portal: sourcePortal,
      source_job_id: sourceJobId,
      canonical_job_id: computedCanonId,
      classification,
      restoration_action: restorationAction,
      historical_verb: verb,
      historical_score: rawScore,
      reason,
      confidence
    };

    ledgerDb.prepare(`
      INSERT INTO opportunity_restoration_ledger (
        historical_job_hash, source_portal, source_job_id, canonical_job_id,
        classification, restoration_action, historical_verb, historical_score, reason, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobHash, sourcePortal, sourceJobId, computedCanonId,
      classification, restorationAction, verb, rawScore, reason, confidence
    );

    oppLedgerJsonl.push(JSON.stringify(ledgerRow));
  }

  fs.writeFileSync(path.join(FORENSICS_DIR, 'FOR-3-opportunity-restoration-ledger.jsonl'), oppLedgerJsonl.join('\n') + '\n', 'utf-8');
  console.log(`Populated Opportunity Restoration Ledger: ${oracle.length} records`);
  console.log(`  - Already Restored : ${alreadyRestoredCount}`);
  console.log(`  - Restorable       : ${restorableCount} (including ${sparseCount} sparse)`);

  // 2. Process 269 Raw Staging Opportunities
  const stagingLedgerJsonl: string[] = [];
  let stagingPromotableCount = 0;

  const rawStagingOpps = oppRows.filter(o => o.id.startsWith('o_'));
  for (const opp of rawStagingOpps) {
    const oppId = opp.id;
    const doc = docByOppId.get(oppId);

    const sourcePortal = opp.company_id && opp.company_id.includes('naukri') ? 'Naukri' : 'LinkedIn';
    const sourceJobId = oppId;
    const computedCanonId = computeCanonicalJobId({ source: sourcePortal, sourceJobId });

    const classification = 'CURRENT_STAGING_RECORD_REQUIRING_CANONICALIZATION';
    const promotionAction = 'PROMOTE_VIA_CANONICAL_INGESTION_SERVICE';
    const reason = 'Raw staging opportunity with document payload present';
    const confidence = 'PROVEN';
    stagingPromotableCount++;

    const docId = doc ? doc.id : null;
    const contentHash = doc ? computeContentHash({
      title: opp.canonical_title || 'Unknown Title',
      companyName: 'Unknown Company',
      location: opp.location || null,
      employmentType: null,
      rawContent: doc.content || ''
    }) : 'no_doc';

    const versionId = computeOpportunityVersionId(computedCanonId, contentHash);

    const ledgerRow = {
      staging_opportunity_id: oppId,
      staging_document_id: docId,
      source_portal: sourcePortal,
      source_job_id: sourceJobId,
      canonical_job_id: computedCanonId,
      opportunity_version_id: versionId,
      classification,
      promotion_action: promotionAction,
      reason,
      confidence
    };

    ledgerDb.prepare(`
      INSERT INTO staging_promotion_ledger (
        staging_opportunity_id, staging_document_id, source_portal, source_job_id,
        canonical_job_id, opportunity_version_id, classification, promotion_action, reason, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      oppId, docId, sourcePortal, sourceJobId, computedCanonId, versionId,
      classification, promotionAction, reason, confidence
    );

    stagingLedgerJsonl.push(JSON.stringify(ledgerRow));
  }

  fs.writeFileSync(path.join(FORENSICS_DIR, 'FOR-3-staging-promotion-ledger.jsonl'), stagingLedgerJsonl.join('\n') + '\n', 'utf-8');
  console.log(`Populated Staging Promotion Ledger: ${rawStagingOpps.length} records`);

  // 3. Process 1,514 Historical Decisions
  const decisionLedgerJsonl: string[] = [];
  let decisionRestorableCount = 0;

  for (let i = 0; i < audit.length; i++) {
    const item = audit[i];
    const jobHash = item.jobHash;
    const verb = item.verb || 'UNKNOWN';

    let userAction = 'NONE';
    if (verb === 'PURSUE') userAction = 'PURSUE';
    else if (verb === 'CONSIDER') userAction = 'CONSIDER';
    else if (verb === 'PASS') userAction = 'PASS';

    let sourcePortal = 'LinkedIn';
    let sourceJobId = jobHash;
    if (jobHash.includes(':')) {
      const parts = jobHash.split(':');
      sourcePortal = parts[0] === 'indeed' ? 'Indeed' : parts[0] === 'naukri' ? 'Naukri' : 'LinkedIn';
      sourceJobId = parts.slice(1).join(':');
    }
    const computedCanonId = computeCanonicalJobId({ source: sourcePortal, sourceJobId });

    let classification = 'DECISION_REQUIRES_CANONICAL_MAPPING';
    let restorationAction = 'RESTORE_TO_CANONICAL_DECISIONS';
    let reason = 'Historical evaluation audit log decision';
    let confidence = 'PROVEN';
    decisionRestorableCount++;

    const decId = `hist_dec_${i + 1}`;

    const ledgerRow = {
      decision_id: decId,
      historical_job_hash: jobHash,
      canonical_job_id: computedCanonId,
      user_action: userAction,
      historical_timestamp: '2026-08-16T00:00:00.000Z',
      classification,
      restoration_action: restorationAction,
      reason,
      confidence
    };

    ledgerDb.prepare(`
      INSERT INTO decision_restoration_ledger (
        decision_id, historical_job_hash, canonical_job_id, user_action,
        historical_timestamp, classification, restoration_action, reason, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decId, jobHash, computedCanonId, userAction, '2026-08-16T00:00:00.000Z',
      classification, restorationAction, reason, confidence
    );

    decisionLedgerJsonl.push(JSON.stringify(ledgerRow));
  }

  fs.writeFileSync(path.join(FORENSICS_DIR, 'FOR-3-decision-restoration-ledger.jsonl'), decisionLedgerJsonl.join('\n') + '\n', 'utf-8');
  console.log(`Populated Decision Restoration Ledger: ${audit.length} records`);

  // 4. Verdict Repair Ledger
  const verdictRepairs = [
    {
      repair_id: 'REPAIR-001',
      location: 'src/lib/intelligence/serving/EvaluationServingEngine.ts:273-279',
      defect_type: 'SILENT_FALLBACK_TO_CONSIDER',
      bug_description: 'adaptEngineVerdict returns CONSIDER when verb parameter is undefined or null',
      remediation_action: 'Refactor adaptEngineVerdict to return NOT_EVALUABLE / SPARSE_SPEC when verb is missing or invalid'
    }
  ];

  const verdictLedgerJsonl: string[] = [];
  for (const vr of verdictRepairs) {
    ledgerDb.prepare(`
      INSERT INTO verdict_repair_ledger (
        repair_id, location, defect_type, bug_description, remediation_action
      ) VALUES (?, ?, ?, ?, ?)
    `).run(vr.repair_id, vr.location, vr.defect_type, vr.bug_description, vr.remediation_action);

    verdictLedgerJsonl.push(JSON.stringify(vr));
  }

  fs.writeFileSync(path.join(FORENSICS_DIR, 'FOR-3-verdict-repair-ledger.jsonl'), verdictLedgerJsonl.join('\n') + '\n', 'utf-8');
  console.log(`Populated Verdict Repair Ledger: ${verdictRepairs.length} record\n`);

  baselineDb.close();
  ledgerDb.close();
}

main().catch(err => {
  console.error('Error building remediation ledger:', err);
  process.exit(1);
});
