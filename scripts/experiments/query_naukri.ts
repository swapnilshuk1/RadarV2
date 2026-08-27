import { getDatabaseAdapter } from '../src/data/database/index.js';

async function main() {
    const db = getDatabaseAdapter();
    const rows = await db.many('SELECT original_url FROM opportunities WHERE url_origin LIKE ''%naukri%'' ORDER BY created_at DESC LIMIT 5');
    console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
