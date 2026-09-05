/**
 * Gate 3 derived-state repair.
 *
 * Rebuilds the version-scoped content category projection from the canonical
 * readable title and JD text. It does not read or change user, identity,
 * decision, source-document, or evaluation state.
 */
import { getDatabaseAdapter } from "../src/data/database/index.js";
import { classifyOpportunityCategories } from "../src/lib/domain/category_taxonomy.js";

async function main() {
  const db = getDatabaseAdapter();
  const versions = await db.many<{ id: string; job_title: string | null; raw_content: string | null }>(
    `SELECT id, job_title, raw_content
     FROM opportunity_versions
     WHERE lifecycle_state = 'ACTIVE'`,
  );

  for (const version of versions) {
    const categoryIds = classifyOpportunityCategories({
      role: version.job_title ?? "",
      description: version.raw_content ?? "",
    });
    await db.execute(
      `UPDATE opportunity_versions SET category_ids = ? WHERE id = ?`,
      [JSON.stringify(categoryIds), version.id],
    );
  }

  console.log(`Rebuilt category_ids for ${versions.length} active opportunity versions.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
