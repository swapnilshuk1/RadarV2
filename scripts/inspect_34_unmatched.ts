import { getDatabaseAdapter } from "../src/data/database/index.js";
import { computeCanonicalJobId } from "../src/lib/domain/canonical_identity.js";

async function inspect34Unmatched() {
  const db = getDatabaseAdapter();

  const ids = [
    'naukri:e9cc11ecf1d5358b',
    'naukri:b340b6a35a8346ad',
    'linkedin:167a504162240956',
    'linkedin:7a3208c76f65447c',
    'linkedin:76a3e57ce3d4658d',
    'linkedin:8031402a9750e4a3',
    'linkedin:3ae48060faf5ce82',
    'linkedin:8a87c9a240c5df07',
    'linkedin:1207cd06f051751d',
    'linkedin:82e79391445b2638'
  ];

  for (const rawId of ids) {
    const [src, sJobId] = rawId.split(':');
    const source = src === 'naukri' ? 'Naukri' : 'LinkedIn';
    const computed = computeCanonicalJobId({ source, sourceJobId: sJobId });

    const foundById = await db.one<any>(`SELECT id, source, source_job_id, company_name FROM canonical_opportunities WHERE id = ?`, [computed]);
    const foundBySourceJobId = await db.one<any>(`SELECT id, source, source_job_id, company_name FROM canonical_opportunities WHERE source_job_id = ?`, [sJobId]);
    const foundByRaw = await db.one<any>(`SELECT id, source, source_job_id, company_name FROM canonical_opportunities WHERE source_job_id = ?`, [rawId]);

    console.log(`Checking ${rawId}:`);
    console.log(`  Computed ID (${computed}):`, foundById ? "FOUND" : "NOT FOUND");
    console.log(`  SourceJobId (${sJobId}):`, foundBySourceJobId ? `FOUND (id: ${foundBySourceJobId.id})` : "NOT FOUND");
    console.log(`  Raw (${rawId}):`, foundByRaw ? `FOUND (id: ${foundByRaw.id})` : "NOT FOUND");
  }
}

inspect34Unmatched().catch(console.error);
