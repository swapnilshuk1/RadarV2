import { getDatabaseAdapter } from "../src/data/database/index.js";

async function queryWithRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`Retry ${i + 1}/${retries}...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("Failed after retries");
}

async function runAudit() {
  const db = getDatabaseAdapter();

  console.log("=== PHASE 1: INVENTORY ===");
  const counts = await queryWithRetry(() => db.one<any>(`
    SELECT
      (SELECT COUNT(*) FROM opportunities) as legacy_opportunities,
      (SELECT COUNT(*) FROM documents) as legacy_documents,
      (SELECT COUNT(*) FROM candidate_evaluations) as legacy_evaluations,
      (SELECT COUNT(*) FROM decisions) as legacy_decisions,
      (SELECT COUNT(*) FROM canonical_opportunities) as canonical_opportunities,
      (SELECT COUNT(*) FROM opportunity_versions) as opportunity_versions,
      (SELECT COUNT(*) FROM evaluation_contexts) as evaluation_contexts,
      (SELECT COUNT(*) FROM search_plan_candidates) as search_plan_candidates,
      (SELECT COUNT(*) FROM evaluation_jobs) as evaluation_jobs,
      (SELECT COUNT(*) FROM materialized_evaluations) as materialized_evaluations,
      (SELECT COUNT(*) FROM canonical_decisions) as canonical_decisions
  `));
  console.log("Database Counts:", JSON.stringify(counts, null, 2));

  console.log("\n=== PHASE 2: OPPORTUNITY MAPPING ANALYSIS ===");
  const canonicals = await queryWithRetry(() => db.many<any>("SELECT id, source, source_job_id, canonical_url, company_name FROM canonical_opportunities"));
  const canonicalMap = new Map<string, any>();
  for (const c of canonicals) {
    canonicalMap.set(`${c.source}:${c.source_job_id}`, c.id);
    canonicalMap.set(c.source_job_id, c.id);
  }

  const legacyOpps = await queryWithRetry(() => db.many<any>("SELECT o.id, o.canonical_title, o.company_id, o.location, o.created_at, o.employment_type, c.name as company_name FROM opportunities o LEFT JOIN companies c ON o.company_id = c.id"));

  console.log("Fetching document metadata via json_extract...");
  const docRows = await queryWithRetry(() => db.many<any>(`
    SELECT 
      opportunity_id,
      json_extract(content, '$.jobHash') as job_hash,
      json_extract(content, '$.url') as url,
      json_extract(content, '$.title') as title,
      json_extract(content, '$.company') as company,
      json_extract(content, '$.location') as location,
      json_extract(content, '$.source') as source
    FROM documents 
    WHERE payload_type = 'Structured'
  `));

  const docMap = new Map<string, any>();
  for (const d of docRows) {
    docMap.set(d.opportunity_id, d);
  }

  let oppExactMatch = 0;
  let oppNewCanonical = 0;
  let oppAmbiguous = 0;
  let oppOrphan = 0;

  const newCanonicalList: any[] = [];

  for (const opp of legacyOpps) {
    let source = "";
    let sourceJobId = "";

    if (opp.id.startsWith("o_")) {
      const doc = docMap.get(opp.id);
      if (doc && doc.job_hash) {
        sourceJobId = doc.job_hash;
        source = doc.source || (doc.url?.includes("naukri") ? "naukri" : doc.url?.includes("linkedin") ? "linkedin" : "indeed");
      }
    } else if (opp.id.includes(":")) {
      const parts = opp.id.split(":");
      source = parts[0];
      sourceJobId = parts.slice(1).join(":");
    } else {
      sourceJobId = opp.id;
    }

    if (!sourceJobId) {
      oppOrphan++;
      continue;
    }

    const matchedId = canonicalMap.get(`${source}:${sourceJobId}`) || canonicalMap.get(sourceJobId);
    if (matchedId) {
      oppExactMatch++;
    } else if (source && sourceJobId) {
      oppNewCanonical++;
      const doc = docMap.get(opp.id);
      newCanonicalList.push({
        legacyId: opp.id,
        source,
        sourceJobId,
        title: doc?.title || opp.canonical_title,
        company: doc?.company || opp.company_name || null,
        location: doc?.location || opp.location,
        canonicalUrl: doc?.url || null,
      });
    } else {
      oppAmbiguous++;
    }
  }

  console.log("Opportunity Analysis:", {
    totalLegacyOpps: legacyOpps.length,
    oppExactMatch,
    oppNewCanonical,
    oppAmbiguous,
    oppOrphan
  });

  console.log("\n=== PHASE 3: DECISIONS MAPPING ANALYSIS ===");
  const legacyDecisions = await queryWithRetry(() => db.many<any>("SELECT * FROM decisions"));
  let decExactMatch = 0;
  let decTestOrphan = 0;
  let decUnmapped = 0;

  for (const d of legacyDecisions) {
    if (d.opportunity_id.startsWith("job_") || d.opportunity_id.startsWith("op-test")) {
      decTestOrphan++;
      continue;
    }
    const matchedId = canonicalMap.get(d.opportunity_id);
    if (matchedId) {
      decExactMatch++;
    } else {
      decUnmapped++;
    }
  }

  console.log("Decisions Analysis:", {
    totalLegacyDecisions: legacyDecisions.length,
    decExactMatch,
    decTestOrphan,
    decUnmapped
  });

  console.log("\n=== PHASE 4: EVALUATIONS MAPPING ANALYSIS ===");
  const legacyEvals = await queryWithRetry(() => db.many<any>("SELECT person_id, job_hash, engine_verdict, quality_score FROM candidate_evaluations"));
  let evalExactMatch = 0;
  let evalTestOrphan = 0;
  let evalUnmapped = 0;

  for (const e of legacyEvals) {
    if (e.job_hash.startsWith("job_") || e.job_hash.startsWith("j-mock")) {
      evalTestOrphan++;
      continue;
    }
    const matchedId = canonicalMap.get(e.job_hash);
    if (matchedId) {
      evalExactMatch++;
    } else {
      evalUnmapped++;
    }
  }

  console.log("Evaluations Analysis:", {
    totalLegacyEvals: legacyEvals.length,
    evalExactMatch,
    evalTestOrphan,
    evalUnmapped
  });

  console.log("\n=== SUMMARY OF NEW CANONICAL OPPS ===");
  console.log(`Count: ${newCanonicalList.length}`);
  console.log("Sample:", newCanonicalList.slice(0, 5));
}

runAudit().catch(console.error);
