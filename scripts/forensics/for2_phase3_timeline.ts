import fs from 'fs';
import path from 'path';

const ROOT = 'c:/Users/swapn/Downloads/radar-local-v2';
const FORENSICS_DIR = path.join(ROOT, 'forensics');
const SCRATCH_DIR = path.join(ROOT, 'scratch');

function main() {
  console.log('================================================================');
  console.log('FOR-2 — PHASE 3: HISTORICAL AUDIT TIMELINE CREATION');
  console.log('================================================================\n');

  const auditPath = path.join(SCRATCH_DIR, 'audit_records.json');
  const auditData = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));

  console.log(`Processing ${auditData.length} audit records into timeline events...`);

  const timelineLines: string[] = [];

  for (let i = 0; i < auditData.length; i++) {
    const item = auditData[i];
    const jobHash = item.jobHash;
    const verb = item.verb || 'UNKNOWN';
    const rawScore = item.rawScore ?? null;
    const priority = item.priority ?? null;
    const engineVersion = item.engineVersion || 'legacy';

    // Infer timestamp or use trace timestamp if available
    let timestamp = '2026-08-16T00:00:00.000Z'; // Historical baseline date from 16 AUG Oracle
    if (item.trace && item.trace.timestamp) {
      timestamp = item.trace.timestamp;
    }

    let eventType = 'EVALUATION';
    if (verb === 'PURSUE') eventType = 'PURSUE';
    else if (verb === 'CONSIDER') eventType = 'CONSIDER';
    else if (verb === 'PASS') eventType = 'PASS';
    else if (verb === 'SPARSE_SPEC') eventType = 'SPARSE_SPEC';

    const event = {
      sequenceIndex: i + 1,
      timestamp,
      eventType,
      entityId: `hist_eval_${jobHash}`,
      opportunityId: jobHash,
      userPerson: 'Swapnil Shukla',
      tenant: 'tenant_default',
      source: 'historical_oracle',
      verb,
      rawScore,
      priority,
      engineVersion,
      vetoed: item.vetoed || false,
      vetoReason: item.vetoReason || null
    };

    timelineLines.push(JSON.stringify(event));
  }

  const outputPath = path.join(FORENSICS_DIR, 'historical-event-timeline.jsonl');
  fs.writeFileSync(outputPath, timelineLines.join('\n') + '\n', 'utf-8');

  console.log(`Wrote forensics/historical-event-timeline.jsonl (${timelineLines.length} timeline events)\n`);
}

main();
