import { getDatabaseAdapter } from '../src/data/database/index.ts';

async function main() {
  const db = await getDatabaseAdapter();
  
  // Pre-flight: update email to match Google account
  const result = await db.execute(
    "UPDATE people SET email = 'swapnilshuk@gmail.com' WHERE id = 'swapnil-shukla'"
  );
  console.log('ROWS_UPDATED:', result.rowsAffected);
  
  // Verify
  const row = await db.one<{ id: string; email: string }>(
    'SELECT id, email FROM people WHERE id = ?',
    ['swapnil-shukla']
  );
  console.log('EMAIL_NOW:', row?.email);
  
  const cnt = await db.one<{ count: number }>(
    'SELECT COUNT(*) as count FROM decisions WHERE person_id = ?',
    ['swapnil-shukla']
  );
  console.log('DECISIONS_INTACT:', cnt?.count);
}

main();
