import { getDatabaseAdapter } from '../src/data/database/index.js';
async function run() {
  const db = getDatabaseAdapter();
  const res = await db.many(SELECT o.id, o.fingerprint, COUNT(d.id) as dec_count, COUNT(c.job_hash) as eval_count FROM opportunities o LEFT JOIN decisions d ON d.opportunity_id = o.id LEFT JOIN candidate_evaluations c ON c.job_hash = o.id WHERE o.id LIKE 'o_%' GROUP BY o.id ORDER BY dec_count DESC, eval_count DESC LIMIT 5);
  console.log('o_ opportunities stats:', res);
  
  const res2 = await db.many(SELECT COUNT(*) as c FROM decisions d LEFT JOIN canonical_opportunities c ON d.opportunity_id = c.source_job_id WHERE c.id IS NOT NULL);
  console.log('Decisions matching canonical via source_job_id:', res2);
  
  const res3 = await db.many(SELECT COUNT(*) as c FROM decisions d WHERE d.opportunity_id LIKE 'o_%');
  console.log('Decisions attached to o_ ids:', res3);
}
run().catch(console.error);
