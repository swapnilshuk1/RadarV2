const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const t0 = Date.now();
const db = new Database(':memory:');
console.log('Created :memory: database in', Date.now() - t0, 'ms');

const migrationsDir = path.resolve(process.cwd(), 'src/data/sqlite/migrations');
const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql') && !f.includes('rollback') && !f.includes('recreate'))
  .sort();

console.log('Found migration files:', files.length);
for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  try {
    db.exec(sql);
  } catch (e) {
    console.error('Failed migration:', file, e.message);
  }
}
console.log('All migrations applied in', Date.now() - t0, 'ms');
