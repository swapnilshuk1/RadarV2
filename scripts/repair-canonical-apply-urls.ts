/**
 * Repairs legacy canonical_url placeholders from the immutable structured
 * payload already retained with each canonical opportunity.
 *
 * Default mode is read-only. Pass --apply only after reviewing its output.
 * The job intentionally changes URLs only: canonical IDs and source identity
 * remain stable so existing decisions and navigation references are preserved.
 */
import { getDatabaseAdapter } from "../src/data/database";
import { extractExternalPostingUrl } from "../src/lib/acquisition/external-posting-url";

interface PlaceholderRow {
  id: string;
  source: string;
  source_job_id: string;
  canonical_url: string;
  raw_content: string;
}

const APPLY = process.argv.includes("--apply");

async function run(): Promise<void> {
  const db = getDatabaseAdapter();
  const rows = await db.many<PlaceholderRow>(`
    SELECT co.id, co.source, co.source_job_id, co.canonical_url, ov.raw_content
    FROM canonical_opportunities AS co
    JOIN opportunity_versions AS ov
      ON ov.id = (
        SELECT latest.id
        FROM opportunity_versions AS latest
        WHERE latest.canonical_job_id = co.id
        ORDER BY latest.created_at DESC, latest.id DESC
        LIMIT 1
      )
    WHERE co.canonical_url LIKE 'https://radar.internal/%'
  `);

  const repairs = rows.flatMap((row) => {
    const url = extractExternalPostingUrl(row.raw_content);
    return url ? [{ id: row.id, source: row.source, sourceJobId: row.source_job_id, url }] : [];
  });

  console.log(`Internal URL placeholders: ${rows.length}`);
  console.log(`Recoverable external URLs: ${repairs.length}`);
  console.log(`Unrecoverable without re-acquisition: ${rows.length - repairs.length}`);
  for (const repair of repairs.slice(0, 10)) {
    console.log(`${repair.source}:${repair.sourceJobId} -> ${repair.url}`);
  }

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write recoverable URLs.");
    return;
  }

  let updated = 0;
  for (const repair of repairs) {
    const result = await db.execute(
      `UPDATE canonical_opportunities
       SET canonical_url = ?, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ? AND canonical_url LIKE 'https://radar.internal/%'`,
      [repair.url, repair.id],
    );
    updated += result.rowsAffected;
  }
  console.log(`Updated canonical URLs: ${updated}`);
}

run().catch((error) => {
  console.error("Canonical URL repair failed:", error);
  process.exitCode = 1;
});
