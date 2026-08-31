import { getDatabaseAdapter } from "../src/data/database";

async function main() {
  const db = getDatabaseAdapter();
  console.log("Connecting to database...");

  const queueCount = await db.one<{ c: number }>("SELECT count(*) as c FROM recovery_queue");
  console.log("Recovery queue total:", queueCount?.c);

  const byStatus = await db.many<{ status: string; c: number }>("SELECT status, count(*) as c FROM recovery_queue GROUP BY status");
  console.log("Recovery queue by status:", byStatus);

  const bySource = await db.many<{ source: string; c: number }>("SELECT source, count(*) as c FROM recovery_queue GROUP BY source");
  console.log("Recovery queue by source:", bySource);

  const versionsCount = await db.one<{ c: number }>("SELECT count(*) as c FROM opportunity_versions WHERE acquisition_status = 'RECOVERY_PENDING' OR acquisition_quality = 'MINIMAL'");
  console.log("Corrupted/Minimal opportunity_versions count:", versionsCount?.c);

  const sample = await db.many<{
    id: string;
    canonical_job_id: string;
    source: string;
    canonical_url: string;
    status: string;
    reason: string;
  }>("SELECT id, canonical_job_id, source, canonical_url, status, reason FROM recovery_queue LIMIT 10");
  console.log("Sample recovery queue rows:", sample);
}

main().catch(console.error);
