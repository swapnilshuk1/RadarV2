import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT = 'c:/Users/swapn/Downloads/radar-local-v2';
const FORENSICS_DIR = path.join(ROOT, 'forensics');
const SNAPSHOT_PATH = path.join(FORENSICS_DIR, 'radar-turso-snapshot-2026-08-29.sqlite');
const LAB_DB_PATH = path.join(FORENSICS_DIR, 'radar-forensic-lab-2026-08-29.sqlite');

function main() {
  console.log('================================================================');
  console.log('FOR-1 — STEP 1, 2 & 3: SCHEMA MAP, TABLE GRAPH & PROFILES');
  console.log('================================================================\n');

  // Open snapshot strictly READ-ONLY
  const snapshotDb = new Database(SNAPSHOT_PATH, { readonly: true });
  console.log(`Opened Immutable Snapshot (READ-ONLY) : ${SNAPSHOT_PATH}`);

  // Open writable lab DB
  const labDb = new Database(LAB_DB_PATH);
  console.log(`Opened Writable Lab Database          : ${LAB_DB_PATH}\n`);

  // STEP 1: REVERSE ENGINEER SCHEMA
  const tables = snapshotDb.prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string; sql: string }[];
  console.log(`Discovered Tables in Snapshot: ${tables.length}`);

  const schemaMap: Record<string, any> = {};
  const tableGraph: Record<string, any>[] = [];
  const tableProfiles: Record<string, any> = {};

  for (const t of tables) {
    const tableName = t.name;
    const tableInfo = snapshotDb.prepare(`PRAGMA table_info("${tableName}")`).all() as any[];
    const foreignKeys = snapshotDb.prepare(`PRAGMA foreign_key_list("${tableName}")`).all() as any[];
    const indexList = snapshotDb.prepare(`PRAGMA index_list("${tableName}")`).all() as any[];

    const columns = tableInfo.map(c => ({
      cid: c.cid,
      name: c.name,
      type: c.type,
      notnull: c.notnull === 1,
      dflt_value: c.dflt_value,
      pk: c.pk
    }));

    const primaryKeys = columns.filter(c => c.pk > 0).map(c => c.name);

    schemaMap[tableName] = {
      tableName,
      createSql: t.sql,
      primaryKeys,
      columns,
      foreignKeys: foreignKeys.map(fk => ({
        id: fk.id,
        seq: fk.seq,
        table: fk.table,
        from: fk.from,
        to: fk.to,
        on_update: fk.on_update,
        on_delete: fk.on_delete,
        match: fk.match
      })),
      indexes: indexList.map(idx => ({
        name: idx.name,
        unique: idx.unique === 1,
        origin: idx.origin,
        partial: idx.partial === 1
      }))
    };

    // FK Relationships
    for (const fk of foreignKeys) {
      tableGraph.push({
        sourceTable: tableName,
        targetTable: fk.table,
        relationshipType: 'EXPLICIT_FOREIGN_KEY',
        sourceColumn: fk.from,
        targetColumn: fk.to,
        onDelete: fk.on_delete,
        onUpdate: fk.on_update
      });
    }

    // Infer explicit column relationships (e.g. tenant_id, person_id, canonical_job_id, search_plan_id, opportunity_id)
    for (const col of columns) {
      const colName = col.name;
      if (colName === 'canonical_job_id' && tableName !== 'canonical_opportunities') {
        tableGraph.push({
          sourceTable: tableName,
          targetTable: 'canonical_opportunities',
          relationshipType: 'EXACT_ID_MATCH',
          sourceColumn: 'canonical_job_id',
          targetColumn: 'id'
        });
      } else if (colName === 'opportunity_id' && tableName !== 'opportunities') {
        tableGraph.push({
          sourceTable: tableName,
          targetTable: 'opportunities',
          relationshipType: 'EXACT_ID_MATCH',
          sourceColumn: 'opportunity_id',
          targetColumn: 'id'
        });
      } else if (colName === 'tenant_id' && tableName !== 'tenants') {
        tableGraph.push({
          sourceTable: tableName,
          targetTable: 'tenants',
          relationshipType: 'EXACT_ID_MATCH',
          sourceColumn: 'tenant_id',
          targetColumn: 'id'
        });
      } else if (colName === 'person_id' && tableName !== 'people') {
        tableGraph.push({
          sourceTable: tableName,
          targetTable: 'people',
          relationshipType: 'EXACT_ID_MATCH',
          sourceColumn: 'person_id',
          targetColumn: 'id'
        });
      } else if (colName === 'search_plan_id' && tableName !== 'search_plans') {
        tableGraph.push({
          sourceTable: tableName,
          targetTable: 'search_plans',
          relationshipType: 'EXACT_ID_MATCH',
          sourceColumn: 'search_plan_id',
          targetColumn: 'id'
        });
      } else if (colName === 'evaluation_context_id' && tableName !== 'evaluation_contexts') {
        tableGraph.push({
          sourceTable: tableName,
          targetTable: 'evaluation_contexts',
          relationshipType: 'EXACT_ID_MATCH',
          sourceColumn: 'evaluation_context_id',
          targetColumn: 'id'
        });
      }
    }

    // STEP 3: TABLE PROFILES
    const rowCount = (snapshotDb.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as any).count;

    const columnProfiles: Record<string, any> = {};
    for (const col of columns) {
      const colName = col.name;
      if (rowCount === 0) {
        columnProfiles[colName] = {
          nullCount: 0,
          nullRate: 0,
          distinctCount: 0
        };
      } else {
        const nullCount = (snapshotDb.prepare(`SELECT COUNT(*) as count FROM "${tableName}" WHERE "${colName}" IS NULL`).get() as any).count;
        const distinctCount = (snapshotDb.prepare(`SELECT COUNT(DISTINCT "${colName}") as count FROM "${tableName}"`).get() as any).count;
        columnProfiles[colName] = {
          nullCount,
          nullRate: parseFloat((nullCount / rowCount).toFixed(4)),
          distinctCount
        };
      }
    }

    tableProfiles[tableName] = {
      tableName,
      rowCount,
      columnCount: columns.length,
      primaryKeys,
      columns: columnProfiles
    };
  }

  // Write Schema Map, Table Graph, Table Profiles
  fs.writeFileSync(path.join(FORENSICS_DIR, 'forensic-schema-map.json'), JSON.stringify(schemaMap, null, 2), 'utf-8');
  fs.writeFileSync(path.join(FORENSICS_DIR, 'forensic-table-graph.json'), JSON.stringify(tableGraph, null, 2), 'utf-8');
  fs.writeFileSync(path.join(FORENSICS_DIR, 'forensic-table-profiles.json'), JSON.stringify(tableProfiles, null, 2), 'utf-8');

  console.log('Wrote forensics/forensic-schema-map.json');
  console.log('Wrote forensics/forensic-table-graph.json');
  console.log('Wrote forensics/forensic-table-profiles.json\n');

  snapshotDb.close();
  labDb.close();
}

main();
