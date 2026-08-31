import { getDatabaseAdapter } from "../../src/data/database/index";
import { getRepositories } from "../../src/data/sqlite/provider";
import { resolveScope } from "../../src/lib/intelligence/opportunity-service";
import fs from "fs";

async function diagnoseMismatch() {
  const db = getDatabaseAdapter();
  const repos = getRepositories();

  const goldenData = JSON.parse(fs.readFileSync("tests/fixtures/serving_golden_dataset.json", "utf-8"));
  const goldenMap = new Map(goldenData.records.map((r: any) => [r.jobHash, r]));

  const scope = { tenantId: goldenData.tenantId, personId: goldenData.userId };
  
  // Look at item ace1f1027e78f99b
  const itemHash = "ace1f1027e78f99b";
  const goldenItem = goldenMap.get(itemHash);
  console.log("Golden Item for ace1f1027e78f99b:", goldenItem);

  // Look at raw DB row for ace1f1027e78f99b
  const row = await db.one(
    `SELECT 
       co.source_job_id,
       co.company_name,
       ov.job_title,
       ov.location,
       ov.posted_at,
       me.id as me_id,
       me.evaluation_state,
       me.decision,
       me.quality_score,
       me.vetoed,
       me.evaluation_json,
       d.action as user_action,
       spc.attention_decision
     FROM search_plan_candidates spc
     JOIN canonical_opportunities co ON spc.canonical_job_id = co.id
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id AND spc.opportunity_version = ov.id
     LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id AND me.opportunity_version = spc.opportunity_version AND me.tenant_id = spc.tenant_id AND me.person_id = spc.person_id AND me.evaluation_context_fingerprint = ?
     LEFT JOIN canonical_decisions d ON d.canonical_job_id = spc.canonical_job_id AND d.tenant_id = spc.tenant_id AND d.person_id = spc.person_id
     WHERE co.source_job_id = ? AND spc.tenant_id = ? AND spc.person_id = ?`,
    [goldenData.contextFingerprint, itemHash, scope.tenantId, scope.personId]
  );
  console.log("\nRaw DB Row for ace1f1027e78f99b:", {
    ...row,
    evaluation_json_preview: (row as any)?.evaluation_json ? JSON.stringify(JSON.parse((row as any).evaluation_json)).slice(0, 200) : null
  });

  // Look at unmaterialized item 593151befbd864b5
  const unmatHash = "593151befbd864b5";
  const goldenUnmat = goldenMap.get(unmatHash);
  console.log("\nGolden Item for unmat 593151befbd864b5:", goldenUnmat);
  const rowUnmat = await db.one(
    `SELECT 
       co.source_job_id,
       ov.location,
       ov.posted_at,
       me.id as me_id,
       me.evaluation_state,
       me.decision,
       spc.attention_decision
     FROM search_plan_candidates spc
     JOIN canonical_opportunities co ON spc.canonical_job_id = co.id
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id AND spc.opportunity_version = ov.id
     LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id AND me.opportunity_version = spc.opportunity_version AND me.tenant_id = spc.tenant_id AND me.person_id = spc.person_id AND me.evaluation_context_fingerprint = ?
     WHERE co.source_job_id = ? AND spc.tenant_id = ? AND spc.person_id = ?`,
    [goldenData.contextFingerprint, unmatHash, scope.tenantId, scope.personId]
  );
  console.log("\nRaw DB Row for unmat 593151befbd864b5:", rowUnmat);
}

diagnoseMismatch().catch(console.error);
