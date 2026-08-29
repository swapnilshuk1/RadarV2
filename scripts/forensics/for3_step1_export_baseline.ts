import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { getDatabaseAdapter } from '../../src/data/database/index';

const ROOT = 'c:/Users/swapn/Downloads/radar-local-v2';
const FORENSICS_DIR = path.join(ROOT, 'forensics');
const BASELINE_SNAPSHOT_PATH = path.join(FORENSICS_DIR, 'radar-turso-pre-remediation-2026-08-29.sqlite');

async function main() {
  console.log('================================================================');
  console.log('FOR-3 — STEP 1: PRE-REMEDIATION TURSO BASELINE SNAPSHOT');
  console.log('================================================================\n');

  const adapter = getDatabaseAdapter();

  const tables = await adapter.many<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );

  console.log(`Found ${tables.length} tables in live Turso Cloud database.`);

  if (fs.existsSync(BASELINE_SNAPSHOT_PATH)) {
    fs.unlinkSync(BASELINE_SNAPSHOT_PATH);
  }

  const snapshotDb = new Database(BASELINE_SNAPSHOT_PATH);
  snapshotDb.exec('PRAGMA foreign_keys = OFF;');

  // Step 1: Create all table schemas
  for (const t of tables) {
    const tableName = t.name;
    const schemaRow = await adapter.one<{ sql: string }>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );

    if (schemaRow && schemaRow.sql) {
      snapshotDb.exec(schemaRow.sql);
    }
  }

  // Step 2: Copy rows
  for (const t of tables) {
    const tableName = t.name;
    const rows = await adapter.many<Record<string, unknown>>(`SELECT * FROM "${tableName}"`);
    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insertStmt = snapshotDb.prepare(
        `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
      );

      const insertMany = snapshotDb.transaction((allRows: Record<string, unknown>[]) => {
        for (const row of allRows) {
          const values = columns.map(col => row[col] ?? null);
          insertStmt.run(...values);
        }
      });

      insertMany(rows);
    }
    console.log(`Exported table: ${tableName.padEnd(45)} | Rows: ${rows.length}`);
  }

  snapshotDb.close();

  const fileData = fs.readFileSync(BASELINE_SNAPSHOT_PATH);
  const hash = crypto.createHash('sha256').update(fileData).digest('hex');

  const manifest = {
    snapshotPath: 'forensics/radar-turso-pre-remediation-2026-08-29.sqlite',
    createdAt: new Date().toISOString(),
    fileSizeBytes: fileData.length,
    sha256Hash: hash,
    tablesCaptured: tables.length
  };

  fs.writeFileSync(
    path.join(FORENSICS_DIR, 'pre-remediation-baseline-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );

  console.log(`\nWrote pre-remediation baseline to forensics/radar-turso-pre-remediation-2026-08-29.sqlite`);
  console.log(`Baseline SHA-256 Hash: ${hash}\n`);
}

main().catch(err => {
  console.error('Error exporting baseline snapshot:', err);
  process.exit(1);
});
