import { getDatabaseAdapter } from "../src/data/database/index.js";
import { CanonicalIngestionService } from "../src/lib/acquisition/CanonicalIngestionService.js";

async function runMigration() {
  const db = getDatabaseAdapter();
  const ingestionService = new CanonicalIngestionService(db);

  console.log("=== STEP 1: VERIFY TENANT & SEARCH PLAN CONTEXT ===");
  const activeContext = await db.one<any>(`
    SELECT ec.context_fingerprint, sps.tenant_id, sps.person_id, sps.search_plan_id
    FROM evaluation_contexts ec
    JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
    WHERE sps.tenant_id = 'tenant_default'
    ORDER BY ec.created_at DESC LIMIT 1
  `);
  console.log("Active Evaluation Context:", activeContext);
  if (!activeContext) {
    throw new Error("No active evaluation context found for tenant_default");
  }

  console.log("\n=== STEP 2: IDENTIFY UNMIGRATED OPPORTUNITIES ===");
  const canonicals = await db.many<any>("SELECT id, source, source_job_id FROM canonical_opportunities");
  const canonicalBySourceJobId = new Map<string, any>();
  for (const c of canonicals) {
    canonicalBySourceJobId.set(c.source_job_id, c);
    canonicalBySourceJobId.set(c.source_job_id.toLowerCase(), c);
    canonicalBySourceJobId.set(`${c.source}:${c.source_job_id}`.toLowerCase(), c);
  }

  const legacyOpps = await db.many<any>("SELECT o.id, o.canonical_title, o.company_id, o.location, o.created_at, o.employment_type, c.name as company_name FROM opportunities o LEFT JOIN companies c ON o.company_id = c.id");

  const docRows = await db.many<any>(`
    SELECT 
      opportunity_id,
      json_extract(content, '$.jobHash') as job_hash,
      json_extract(content, '$.url') as url,
      json_extract(content, '$.title') as title,
      json_extract(content, '$.company') as company,
      json_extract(content, '$.location') as location,
      json_extract(content, '$.source') as source,
      json_extract(content, '$.normalizedText') as normalized_text,
      json_extract(content, '$.raw_content') as raw_content,
      json_extract(content, '$.description') as description,
      json_extract(content, '$.posted_at') as posted_at,
      json_extract(content, '$.posted_precision') as posted_precision
    FROM documents 
    WHERE payload_type = 'Structured'
  `);

  const docMap = new Map<string, any>();
  for (const d of docRows) {
    docMap.set(d.opportunity_id, d);
  }

  const toIngest = [];

  for (const opp of legacyOpps) {
    let sourceJobId = "";
    let source = "";

    if (opp.id.startsWith("o_")) {
      const doc = docMap.get(opp.id);
      if (doc && doc.job_hash) {
        sourceJobId = doc.job_hash;
        source = doc.source || (doc.url?.includes("naukri") ? "Naukri" : doc.url?.includes("linkedin") ? "LinkedIn" : "Indeed");
      }
    } else if (opp.id.startsWith("opp_")) {
      sourceJobId = opp.id.replace(/^opp_/, "");
      source = "legacy_opp";
    } else if (opp.id.includes(":")) {
      const parts = opp.id.split(":");
      source = parts[0];
      sourceJobId = parts.slice(1).join(":");
    } else {
      sourceJobId = opp.id;
      source = "legacy";
    }

    const matched = canonicalBySourceJobId.get(sourceJobId) || 
                    canonicalBySourceJobId.get(sourceJobId.toLowerCase()) ||
                    canonicalBySourceJobId.get(opp.id) ||
                    canonicalBySourceJobId.get(opp.id.toLowerCase());

    if (!matched) {
      const doc = docMap.get(opp.id);
      const canonicalSource = source.charAt(0).toUpperCase() + source.slice(1);
      toIngest.push({
        legacyId: opp.id,
        sourcePortal: canonicalSource === "Legacy" ? "Indeed" : canonicalSource,
        sourceJobId,
        canonicalUrl: doc?.url || `https://radar.internal/jobs/${source}/${sourceJobId}`,
        jobTitle: doc?.title || opp.canonical_title,
        companyName: doc?.company || opp.company_name || null,
        location: doc?.location || opp.location || null,
        employmentType: opp.employment_type || null,
        postedAt: doc?.posted_at || null,
        postedPrecision: doc?.posted_precision || "UNKNOWN",
        rawContent: doc?.raw_content || doc?.normalized_text || doc?.description || `${opp.canonical_title} at ${opp.company_name || "Company"}`
      });
    }
  }

  console.log(`Found ${toIngest.length} opportunities to ingest into Canonical V4 schema.`);

  console.log("\n=== STEP 3: PERFORM IDEMPOTENT CANONICAL INGESTION ===");
  let ingestedCount = 0;
  let enqueuedJobsCount = 0;

  for (const item of toIngest) {
    const result = await ingestionService.ingestOpportunity(
      {
        sourcePortal: item.sourcePortal,
        sourceJobId: item.sourceJobId,
        canonicalUrl: item.canonicalUrl,
        jobTitle: item.jobTitle,
        companyName: item.companyName,
        location: item.location,
        employmentType: item.employmentType,
        postedAt: item.postedAt,
        postedPrecision: item.postedPrecision,
        rawContent: item.rawContent
      },
      {
        tenantId: activeContext.tenant_id,
        personId: activeContext.person_id
      }
    );
    ingestedCount++;
    enqueuedJobsCount += result.jobsEnqueued;
    console.log(`[${ingestedCount}/${toIngest.length}] Ingested canonical job: ${result.canonicalJobId} (Version: ${result.opportunityVersion}) - Jobs enqueued: ${result.jobsEnqueued}`);
  }

  console.log("\n=== STEP 4: VERIFY MIGRATION COMPLETION ===");
  const postCounts = await db.one<any>(`
    SELECT
      (SELECT COUNT(*) FROM canonical_opportunities) as canonical_opportunities,
      (SELECT COUNT(*) FROM opportunity_versions) as opportunity_versions,
      (SELECT COUNT(*) FROM search_plan_candidates) as search_plan_candidates,
      (SELECT COUNT(*) FROM evaluation_jobs) as evaluation_jobs,
      (SELECT COUNT(*) FROM evaluation_jobs WHERE status = 'pending') as pending_jobs,
      (SELECT COUNT(*) FROM materialized_evaluations) as materialized_evaluations,
      (SELECT COUNT(*) FROM canonical_decisions) as canonical_decisions
  `);

  console.log("Post-migration Counts:", JSON.stringify(postCounts, null, 2));
}

runMigration().catch(console.error);
