import Database from 'better-sqlite3';
const db = new Database('radar.sqlite');

function getCount(table: string) {
  try {
    return db.prepare(`SELECT count(1) as c FROM ${table}`).get().c;
  } catch (e) {
    return 0;
  }
}

console.log('Opportunities:', getCount('opportunities'));
console.log('Documents:', getCount('documents'));
console.log('Assessments:', getCount('assessments'));
console.log('Recommendations:', getCount('recommendations'));
console.log('Decisions:', getCount('decisions'));
