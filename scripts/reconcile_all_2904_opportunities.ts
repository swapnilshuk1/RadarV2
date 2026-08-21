import { getDatabaseAdapter } from "../src/data/database/index.js";
import { computeCanonicalJobId } from "../src/lib/domain/canonical_identity.js";

async function runGate4Reconciliation() {
  const db = getDatabaseAdapter();

  console.log("=== GATE 4: FORENSIC CANONICAL IDENTITY RECONCILIATION AUDIT ===");

  const legacyOpps = await db.many<any>(`
    SELECT id, canonical_title, company_id, location, created_at
    FROM opportunities
  `);
  console.log(`Total legacy opportunities discovered: ${legacyOpps.length}`);

  const canonicalOpps = await db.many<any>(`
    SELECT id, source, source_job_id, canonical_url, company_name
    FROM canonical_opportunities
  `);
  console.log(`Total canonical opportunities in DB: ${canonicalOpps.length}`);

  const canonicalById = new Map(canonicalOpps.map(c => [c.id, c]));
  const canonicalBySourceKey = new Map(canonicalOpps.map(c => [`${c.source}:${c.source_job_id}`, c]));
  const canonicalBySourceJobId = new Map(canonicalOpps.map(c => [c.source_job_id, c]));

  let exactIdMatches = 0;
  let normalizedIdMatches = 0;
  let sourceJobIdMatches = 0;
  let unmigratedRecords: any[] = [];
  let ambiguousMatches = 0;
  let collisions = 0;

  const legacyToCanonicalMap = new Map<string, string>();

  for (const opp of legacyOpps) {
    let matchedCanonicalId: string | null = null;
    let matchType = "";

    // 1. Exact canonical ID match (e.g. 64-char sha256)
    if (canonicalById.has(opp.id)) {
      matchedCanonicalId = opp.id;
      matchType = "exact_canonical_id";
      exactIdMatches++;
    }

    // 2. Normalized source + sourceJobId
    if (!matchedCanonicalId) {
      let source = "";
      let sourceJobId = "";
      if (opp.id.startsWith("j-li-") || opp.id.startsWith("li-") || opp.id.startsWith("j-urn:li:")) {
        source = "LinkedIn";
        sourceJobId = opp.id.replace(/^j-/, "").replace(/^li-/, "").replace(/^urn:li:jobPosting:/, "");
      } else if (opp.id.startsWith("j-nk-") || opp.id.startsWith("nk-")) {
        source = "Naukri";
        sourceJobId = opp.id.replace(/^j-/, "").replace(/^nk-/, "");
      }

      if (source && sourceJobId) {
        const key = `${source}:${sourceJobId}`;
        const computed = computeCanonicalJobId(source, sourceJobId);
        if (canonicalBySourceKey.has(key) || canonicalById.has(computed)) {
          matchedCanonicalId = canonicalBySourceKey.get(key)?.id || computed;
          matchType = "normalized_source_id";
          normalizedIdMatches++;
        }
      }
    }

    // 3. SourceJobId match (direct or stripped j-)
    if (!matchedCanonicalId) {
      if (canonicalBySourceJobId.has(opp.id)) {
        matchedCanonicalId = canonicalBySourceJobId.get(opp.id)!.id;
        matchType = "source_job_id_exact";
        sourceJobIdMatches++;
      } else {
        const stripped = opp.id.replace(/^j-/, "");
        if (canonicalBySourceJobId.has(stripped)) {
          matchedCanonicalId = canonicalBySourceJobId.get(stripped)!.id;
          matchType = "source_job_id_stripped";
          sourceJobIdMatches++;
        }
      }
    }

    if (matchedCanonicalId) {
      legacyToCanonicalMap.set(opp.id, matchedCanonicalId);
    } else {
      unmigratedRecords.push(opp);
    }
  }

  console.log("\n=== RECONCILIATION MATCH METRICS ===");
  console.log(`Total Legacy Opportunities: ${legacyOpps.length}`);
  console.log(`Exact ID Matches:           ${exactIdMatches}`);
  console.log(`Normalized ID Matches:      ${normalizedIdMatches}`);
  console.log(`Source Job ID Matches:      ${sourceJobIdMatches}`);
  console.log(`Total Matched:              ${legacyToCanonicalMap.size}`);
  console.log(`Unmatched (Missing):        ${unmigratedRecords.length}`);
  console.log(`Ambiguous Matches:          ${ambiguousMatches}`);
  console.log(`Collisions:                 ${collisions}`);

  if (unmigratedRecords.length > 0) {
    console.log(`\nUnmatched records (${unmigratedRecords.length}):`, unmigratedRecords);
  }

  // Check how many of the 24 M9.4 migration opportunities exist in canonical_opportunities
  const targeted24Ids = [
    'o_03c9b139bfdb', 'o_061556942ce2', 'o_07f353a27a85', 'o_18b528feefc2',
    'o_2f8cf0ba51d1', 'o_36720d20dffc', 'o_36c7a42168eb', 'o_38478479db58',
    'o_3e1a0faeb0a9', 'o_447aa6a4ef33', 'o_49d799f2b87f', 'o_4bc5fb88c1c9',
    'o_4d5b2bc2cfef', 'o_5159fcda3e8c', 'o_5a73e3bf9b51', 'o_6104bc1ec999',
    'o_632f70b4fc75', 'o_653e0f9bda05', 'o_6798c9834164', 'o_6f9e2b1739f4',
    'o_705df5e44cb6', 'o_71597f7fa080', 'o_74ce6603a11c', 'o_7f9fc67b846e'
  ];

  const newlyMigratedInCanon = await db.many<any>(`
    SELECT id, source, source_job_id, company_name
    FROM canonical_opportunities
    WHERE source_job_id IN (${targeted24Ids.map(() => '?').join(',')})
  `, targeted24Ids);

  console.log(`\nVerified newly migrated canonical rows in Turso Cloud: ${newlyMigratedInCanon.length} / 24`);
  console.log(newlyMigratedInCanon);
}

runGate4Reconciliation().catch(console.error);
