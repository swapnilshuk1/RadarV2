import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = 'c:/Users/swapn/Downloads/radar-local-v2';
const FORENSICS_DIR = path.join(ROOT, 'forensics');
const SCRATCH_DIR = path.join(ROOT, 'scratch');

function computeFileHash(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function main() {
  console.log('================================================================');
  console.log('FOR-2 — PHASE 1: HISTORICAL ARTIFACT INVENTORY');
  console.log('================================================================\n');

  const targetFiles = [
    'behavioral-fingerprint-oracle.json',
    'audit_records.json',
    'audit_details.json',
    'audit_results.json',
    'pursue_details.json',
    'recent_audit_details.json',
    'executive_judgment_benchmark_raw.json',
    'model_c_records.json',
    'forensic_trace.json',
    'db_descriptions.json'
  ];

  const inventory: Record<string, any>[] = [];

  for (const filename of targetFiles) {
    const fullPath = path.join(SCRATCH_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      console.log(`[NOT FOUND] ${filename}`);
      continue;
    }

    const stats = fs.statSync(fullPath);
    const hash = computeFileHash(fullPath);

    let recordCount = 0;
    let containsOpportunities = false;
    let containsDecisions = false;
    let containsEvaluations = false;
    let sampleKeys: string[] = [];

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        recordCount = parsed.length;
        if (parsed.length > 0) {
          sampleKeys = Object.keys(parsed[0]);
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        sampleKeys = Object.keys(parsed);
        recordCount = sampleKeys.length;
      }

      const str = content.toLowerCase();
      containsOpportunities = str.includes('opportunity') || str.includes('job') || str.includes('title');
      containsDecisions = str.includes('decision') || str.includes('action') || str.includes('pursue') || str.includes('consider') || str.includes('pass');
      containsEvaluations = str.includes('evaluation') || str.includes('verdict') || str.includes('score');
    } catch (err: any) {
      console.warn(`Error parsing ${filename}:`, err.message);
    }

    const item = {
      filename,
      path: `scratch/${filename}`,
      fileSizeBytes: stats.size,
      fileSizeMb: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
      sha256Hash: hash,
      recordCount,
      containsOpportunities,
      containsDecisions,
      containsEvaluations,
      sampleKeys
    };

    inventory.push(item);
    console.log(`Discovered: ${filename.padEnd(40)} | Size: ${item.fileSizeMb.padStart(8)} | Records: ${String(recordCount).padStart(6)} | Hash: ${hash.substring(0, 12)}...`);
  }

  const outputPath = path.join(FORENSICS_DIR, 'FOR-2-historical-artifact-inventory.json');
  fs.writeFileSync(outputPath, JSON.stringify(inventory, null, 2), 'utf-8');
  console.log(`\nWrote forensics/FOR-2-historical-artifact-inventory.json (${inventory.length} artifacts inventoried)\n`);
}

main();
