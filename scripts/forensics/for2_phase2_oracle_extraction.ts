import fs from 'fs';
import path from 'path';

const ROOT = 'c:/Users/swapn/Downloads/radar-local-v2';
const FORENSICS_DIR = path.join(ROOT, 'forensics');
const SCRATCH_DIR = path.join(ROOT, 'scratch');

function main() {
  console.log('================================================================');
  console.log('FOR-2 — PHASE 2: HISTORICAL ORACLE EXTRACTION & VALIDATION');
  console.log('================================================================\n');

  // 1. Load behavioral-fingerprint-oracle.json
  const oraclePath = path.join(SCRATCH_DIR, 'behavioral-fingerprint-oracle.json');
  const oracleData = JSON.parse(fs.readFileSync(oraclePath, 'utf-8'));

  console.log(`Loaded behavioral-fingerprint-oracle.json: ${oracleData.length} records`);

  const oracleVerbs: Record<string, number> = {};
  const oracleJobHashes = new Set<string>();

  for (const item of oracleData) {
    const verb = item.verb || 'UNKNOWN';
    oracleVerbs[verb] = (oracleVerbs[verb] || 0) + 1;
    if (item.jobHash) {
      oracleJobHashes.add(item.jobHash);
    }
  }

  console.log('\nBehavioral Fingerprint Oracle Verb Breakdown:');
  console.table(oracleVerbs);

  // 2. Load audit_records.json
  const auditPath = path.join(SCRATCH_DIR, 'audit_records.json');
  const auditData = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));

  console.log(`Loaded audit_records.json: ${auditData.length} records`);

  const auditVerbs: Record<string, number> = {};
  const auditJobHashes = new Set<string>();

  for (const item of auditData) {
    const verb = item.verb || 'UNKNOWN';
    auditVerbs[verb] = (auditVerbs[verb] || 0) + 1;
    if (item.jobHash) {
      auditJobHashes.add(item.jobHash);
    }
  }

  console.log('\nAudit Records Verb Breakdown:');
  console.table(auditVerbs);

  // 3. Load model_c_records.json
  const modelCPath = path.join(SCRATCH_DIR, 'model_c_records.json');
  const modelCData = JSON.parse(fs.readFileSync(modelCPath, 'utf-8'));

  console.log(`Loaded model_c_records.json: ${modelCData.length} records`);

  const modelCDecisions: Record<string, number> = {};
  for (const item of modelCData) {
    const dec = item.decision || 'UNKNOWN';
    modelCDecisions[dec] = (modelCDecisions[dec] || 0) + 1;
  }

  console.log('\nModel C Decisions Breakdown:');
  console.table(modelCDecisions);

  // Cross-dataset overlap
  let oracleAuditOverlap = 0;
  for (const hash of auditJobHashes) {
    if (oracleJobHashes.has(hash)) {
      oracleAuditOverlap++;
    }
  }

  console.log(`\nJobHash Overlap (Audit Records 1,514 vs Oracle 2,231): ${oracleAuditOverlap} / ${auditJobHashes.size}`);

  const summary = {
    oracleTotal: oracleData.length,
    oracleVerbs,
    auditTotal: auditData.length,
    auditVerbs,
    modelCTotal: modelCData.length,
    modelCDecisions,
    oracleAuditOverlap,
    uniqueOracleHashes: oracleJobHashes.size,
    uniqueAuditHashes: auditJobHashes.size
  };

  fs.writeFileSync(path.join(FORENSICS_DIR, 'historical-oracle-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log('\nWrote forensics/historical-oracle-summary.json\n');
}

main();
