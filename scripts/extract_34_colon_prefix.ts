import { getDatabaseAdapter } from "../src/data/database/index";
import { computeCanonicalJobId } from "../src/lib/domain/canonical_identity";

function normalizeSource(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.includes("naukri")) return "naukri";
  if (lower.includes("linkedin")) return "linkedin";
  if (lower.includes("workday")) return "workday";
  if (lower.includes("smartrecruiters")) return "smartrecruiters";
  if (lower.includes("greenhouse")) return "greenhouse";
  if (lower.includes("lever")) return "lever";
  return lower;
}

async function main() {
  const db = getDatabaseAdapter();

  const legacyColonOpps = await db.many<{ id: string; canonical_title: string; location: string }>(
    `SELECT id, canonical_title, location FROM opportunities WHERE id LIKE '%:%' ORDER BY id ASC`
  );

  console.log(`Total colon-prefix legacy opportunities found: ${legacyColonOpps.length}`);

  const canonicalRows = await db.many<{ id: string; source: string; source_job_id: string; company_name: string }>(
    `SELECT id, source, source_job_id, company_name FROM canonical_opportunities`
  );

  const canonicalMap = new Map<string, typeof canonicalRows[0]>();
  for (const row of canonicalRows) {
    canonicalMap.set(row.id, row);
  }

  const report: any[] = [];
  const canonicalIdsSeen = new Set<string>();
  let collisions = 0;
  let missing = 0;

  for (const opp of legacyColonOpps) {
    const colonIdx = opp.id.indexOf(":");
    const rawPrefix = opp.id.substring(0, colonIdx);
    const rawJobId = opp.id.substring(colonIdx + 1);

    const normSource = normalizeSource(rawPrefix);
    const normalizationRule = `Prefix '${rawPrefix}' -> normalizeSource -> '${normSource}'; rawJobId '${rawJobId}' -> computeCanonicalJobId({ source: '${normSource}', sourceJobId: '${rawJobId}' })`;

    const canonicalJobId = computeCanonicalJobId({ source: normSource, sourceJobId: rawJobId });

    if (canonicalIdsSeen.has(canonicalJobId)) {
      collisions++;
    }
    canonicalIdsSeen.add(canonicalJobId);

    const match = canonicalMap.get(canonicalJobId);
    if (!match) {
      missing++;
    }

    report.push({
      legacyOpportunityId: opp.id,
      extractedSource: normSource,
      extractedSourceJobId: rawJobId,
      normalizationRule,
      computedCanonicalJobId: canonicalJobId,
      canonicalOpportunityId: match ? match.id : "MISSING",
      matchedSource: match?.source,
      matchedSourceJobId: match?.source_job_id,
      title: opp.canonical_title,
      isResolvedUniquely: !!match,
    });
  }

  console.log("\n--- 34 COLON PREFIX DETAILED EVIDENCE TABLE ---");
  console.table(report.map(r => ({
    "Legacy ID": r.legacyOpportunityId,
    "Extracted Source": r.extractedSource,
    "Extracted SourceJobId": r.extractedSourceJobId,
    "computeCanonicalJobId()": r.computedCanonicalJobId,
    "canonical_opportunities.id": r.canonicalOpportunityId,
    "Unique": r.isResolvedUniquely
  })));

  console.log("\n--- GATE 4 METRICS ---");
  console.log(`Total Records: ${legacyColonOpps.length}`);
  console.log(`Unique Canonical IDs Generated: ${canonicalIdsSeen.size}`);
  console.log(`Collisions: ${collisions}`);
  console.log(`Missing Matches: ${missing}`);
  console.log(`Fuzzy Matching Used: NONE (Exact deterministic normalization)`);
  console.log(`UI State Dependence: NONE (Pure schema and domain algorithm)`);

  // Output full json for reporting
  console.log("\nFULL_JSON_OUTPUT_START");
  console.log(JSON.stringify(report, null, 2));
  console.log("FULL_JSON_OUTPUT_END");
}

main().catch(console.error);
