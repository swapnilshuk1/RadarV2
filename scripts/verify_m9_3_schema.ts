import { runMigrations } from '../src/data/sqlite/migrations/runner';
import { getDatabaseAdapter } from '../src/data/database';

async function verify() {
  const db = getDatabaseAdapter();
  console.log('Running migrations...');
  const result = await runMigrations(db);
  console.log('Applied:', result.applied);
  console.log('Skipped:', result.skipped.length);
  
  const columns = await db.many('PRAGMA table_info(canonical_decisions)');
  console.log('\nSchema for canonical_decisions:');
  columns.forEach((c: any) => console.log('- ' + c.name + ' (' + c.type + ') NOT_NULL=' + c.notnull));
  
  const indexes = await db.many('PRAGMA index_list(canonical_decisions)');
  console.log('\nIndexes for canonical_decisions:');
  for (const idx of indexes as any[]) {
      const idxCols = await db.many('PRAGMA index_info(' + idx.name + ')');
      console.log('- ' + idx.name + ' UNIQUE=' + idx.unique + ' COLUMNS=' + idxCols.map((c: any) => c.name).join(', '));
  }
}
verify().catch(console.error);