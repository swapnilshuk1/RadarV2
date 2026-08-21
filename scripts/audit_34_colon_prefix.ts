import { getDatabaseAdapter } from "../src/data/database/index.js";
import { computeCanonicalJobId } from "../src/lib/domain/canonical_identity.js";

async function main() {
  const db = getDatabaseAdapter();

  const legacyColonOpps = await db.many<{ id: string; canonical_title: string; location: string }>(
    `SELECT id, canonical_title, location FROM opportunities WHERE id LIKE '%:%' ORDER BY id ASC`
  );

  console.log(`Total colon-prefix legacy opportunities found: ${legacyColonOpps.length}`);

  const canonicalRows = await db.many<{ id: string; source: string; source_job_id: string; company_name: string; canonical_url: string }>(
    `SELECT id, source, source_job_id, company_name, canonical_url FROM canonical_opportunities`
  );

  const canonicalById = new Map(canonicalRows.map(c => [c.id, c]));
  const canonicalBySourceKey = new Map(canonicalRows.map(c => [`${c.source.toLowerCase()}:${c.source_job_id}`, c]));

  const results: any[] = [];
  const seenCanonical = new Set<string>();
  let collisions = 0;

  for (const opp of legacyColonOpps) {
    const colonIdx = opp.id.indexOf(":");
    const rawPrefix = opp.id.substring(0, colonIdx);
    const rawJobId = opp.id.substring(colonIdx + 1);

    const lowerKey = `${rawPrefix.toLowerCase()}:${rawJobId}`;
    let match = canonicalBySourceKey.get(lowerKey);

    let canonicalSource = match?.source;
    if (!canonicalSource) {
      if (rawPrefix.toLowerCase() === "naukri") canonicalSource = "Naukri";
      else if (rawPrefix.toLowerCase() === "linkedin") canonicalSource = "LinkedIn";
      else canonicalSource = rawPrefix;
    }

    const computedCanonicalId = computeCanonicalJobId({
      source: canonicalSource,
      sourceJobId: rawJobId
    });

    if (!match && canonicalById.has(computedCanonicalId)) {
      match = canonicalById.get(computedCanonicalId);
    }

    if (match) {
      if (seenCanonical.has(match.id)) {
        collisions++;
      }
      seenCanonical.add(match.id);
    }

    const normalizationRule = `Split on colon -> rawSource='${rawPrefix}', rawJobId='${rawJobId}' -> source='${canonicalSource}' -> computeCanonicalJobId({ source: '${canonicalSource}', sourceJobId: '${rawJobId}' })`;

    results.push({
      legacyOpportunityId: opp.id,
      source: canonicalSource,
      sourceJobId: rawJobId,
      normalizationRule,
      computedCanonicalJobId: computedCanonicalId,
      canonicalOpportunityId: match ? match.id : "UNMAPPED",
      matchFound: !!match,
      canonicalTitle: opp.canonical_title
    });
  }

  console.log(`Matched: ${results.filter(r => r.matchFound).length}/${legacyColonOpps.length}`);
  console.log(`Unique Canonical IDs: ${seenCanonical.size}`);
  console.log(`Collisions: ${collisions}`);
  console.log(`Fuzzy matching: NONE`);
  console.log(`UI dependence: NONE`);

  console.log("\nDETAILED_JSON_START");
  console.log(JSON.stringify(results, null, 2));
  console.log("DETAILED_JSON_END");
}

main().catch(console.error);
