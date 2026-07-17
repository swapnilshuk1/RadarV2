import { getRepositories, getDatabase } from "../src/data/sqlite/provider";

export async function validateGraph(isCLI = false) {
  if (isCLI) {
    console.log("\n============================================================");
    console.log("             RADAR GRAPH INTEGRITY VALIDATOR");
    console.log("============================================================\n");
  }

  const repos = getRepositories();
  const db = getDatabase();

  const companiesCount = (db.prepare("SELECT COUNT(*) as c FROM companies").get() as any).c;
  const sourcesCount = (db.prepare("SELECT COUNT(*) as c FROM sources").get() as any).c;
  const opportunitiesCount = (db.prepare("SELECT COUNT(*) as c FROM opportunities").get() as any).c;
  const documentsCount = (db.prepare("SELECT COUNT(*) as c FROM documents").get() as any).c;
  const factsCount = (db.prepare("SELECT COUNT(*) as c FROM facts").get() as any).c;
  const evidenceCount = (db.prepare("SELECT COUNT(*) as c FROM evidence").get() as any).c;
  const claimsCount = (db.prepare("SELECT COUNT(*) as c FROM claims").get() as any).c;
  const assessmentsCount = (db.prepare("SELECT COUNT(*) as c FROM assessments").get() as any).c;
  const recommendationsCount = (db.prepare("SELECT COUNT(*) as c FROM recommendations").get() as any).c;

  // 1. Orphan Checks (Referential Integrity)
  const orphans = {
    opportunities: (db.prepare("SELECT COUNT(*) as c FROM opportunities o LEFT JOIN companies c ON o.company_id = c.id WHERE c.id IS NULL").get() as any).c,
    documents: (db.prepare("SELECT COUNT(*) as c FROM documents d LEFT JOIN sources s ON d.source_id = s.id WHERE s.id IS NULL").get() as any).c,
    evidence: (db.prepare("SELECT COUNT(*) as c FROM evidence e LEFT JOIN documents d ON e.document_id = d.id WHERE d.id IS NULL").get() as any).c,
    facts: (db.prepare("SELECT COUNT(*) as c FROM facts f LEFT JOIN opportunities o ON f.opportunity_id = o.id WHERE o.id IS NULL").get() as any).c,
    claims: (db.prepare("SELECT COUNT(*) as c FROM claims c LEFT JOIN opportunities o ON c.opportunity_id = o.id WHERE o.id IS NULL").get() as any).c,
    assessments: (db.prepare("SELECT COUNT(*) as c FROM assessments a LEFT JOIN matches m ON a.match_id = m.id WHERE m.id IS NULL").get() as any).c,
  };
  const totalOrphans = Object.values(orphans).reduce((a: number, b: number) => a + b, 0);

  // 2. Duplicate Check
  const duplicateFingerprints = (db.prepare(`
    SELECT COUNT(*) as c FROM (
      SELECT fingerprint FROM opportunities GROUP BY fingerprint HAVING COUNT(*) > 1
    )
  `).get() as any).c;

  // 3. Graph Drift (Companies with similar names)
  const similarCompanies = (db.prepare(`
    SELECT a.name as name1, b.name as name2
    FROM companies a
    JOIN companies b ON a.id != b.id
    WHERE a.name LIKE b.name || '%' AND a.name != b.name
    LIMIT 10
  `).all() as any[]);

  // 4. Missing Cardinality
  const emptyDocuments = (db.prepare("SELECT COUNT(*) as c FROM documents d LEFT JOIN evidence e ON d.id = e.document_id WHERE e.id IS NULL").get() as any).c;
  
  // 5. Schema Drift / Historical Averages
  const avgFactsPerDocument = documentsCount ? (factsCount / documentsCount).toFixed(1) : "0";
  const avgClaimsPerOp = opportunitiesCount ? (claimsCount / opportunitiesCount).toFixed(1) : "0";
  
  let schemaDriftDetected = false;
  let schemaDriftMessage = "";
  if (documentsCount > 10) {
    if (parseFloat(avgFactsPerDocument) < 1.0) {
       schemaDriftDetected = true;
       schemaDriftMessage = `Facts per document dropped to ${avgFactsPerDocument}`;
    }
  }

  const passed = totalOrphans === 0 && duplicateFingerprints === 0 && !schemaDriftDetected;

  if (isCLI) {
    console.log(`GRAPH HEALTH`);
    console.log(`Companies...............${companiesCount > 0 ? "OK" : "0"} (${companiesCount})`);
    console.log(`Sources.................${sourcesCount > 0 ? "OK" : "0"} (${sourcesCount})`);
    console.log(`Opportunities...........${opportunitiesCount > 0 ? "OK" : "0"} (${opportunitiesCount})`);
    console.log(`Documents...............${documentsCount > 0 ? "OK" : "0"} (${documentsCount})`);
    console.log(`Evidence................${evidenceCount > 0 ? "OK" : "0"} (${evidenceCount})`);
    console.log(`Facts...................${factsCount > 0 ? "OK" : "0"} (${factsCount})`);
    console.log(`Claims..................${claimsCount > 0 ? "OK" : "0"} (${claimsCount})`);
    console.log(`Recommendations.........${recommendationsCount > 0 ? "OK" : "0"} (${recommendationsCount})`);
    
    console.log(`\nINTEGRITY`);
    console.log(`Orphans.................${totalOrphans === 0 ? "0" : totalOrphans + " ❌"}`);
    console.log(`Duplicate Fingerprints..${duplicateFingerprints === 0 ? "0" : duplicateFingerprints + " ❌"}`);
    console.log(`Empty Documents.........${emptyDocuments === 0 ? "0" : emptyDocuments + " (No evidence)"}`);

    if (schemaDriftDetected) {
      console.log(`\n⚠️  SCHEMA DRIFT DETECTED: ${schemaDriftMessage}`);
    }

    if (similarCompanies.length > 0) {
      console.log(`\n⚠️  GRAPH DRIFT DETECTED`);
      console.log(`Found possible duplicate companies:`);
      similarCompanies.forEach((c: any) => console.log(`   - "${c.name1}" matches "${c.name2}"`));
    }

    console.log(`\nKPIs`);
    console.log(`Average Facts / Document:     ${avgFactsPerDocument}`);
    console.log(`Average Claims / Opportunity: ${avgClaimsPerOp}`);
    
    console.log(`\nOverall Score...........${passed ? "100%" : "FAIL"}`);
    console.log("============================================================\n");
  }

  return {
    passed,
    metrics: {
      companiesCount, opportunitiesCount, documentsCount, factsCount, claimsCount
    },
    integrity: {
      totalOrphans, duplicateFingerprints, emptyDocuments
    },
    drift: {
      schemaDriftDetected, schemaDriftMessage, similarCompaniesCount: similarCompanies.length
    }
  };
}

if (import.meta.url.startsWith("file:") && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() || '')) {
  validateGraph(true).catch(console.error);
}
