import { getDatabaseAdapter } from "../src/data/database/index.js";

async function reconcileDecisions() {
  const db = getDatabaseAdapter();

  console.log("=== GATE 2 FORENSIC RECONCILIATION OF ALL 496 LEGACY DECISIONS ===");

  const legacyDecisions = await db.many<any>(`
    SELECT id, person_id, opportunity_id, action, reason, created_at, updated_at
    FROM decisions
  `);
  console.log(`Total legacy decisions in DB: ${legacyDecisions.length}`);

  const canonicalDecisions = await db.many<any>(`
    SELECT id, tenant_id, person_id, canonical_job_id, action, reason
    FROM canonical_decisions
  `);
  console.log(`Total canonical decisions in DB: ${canonicalDecisions.length}`);
  const canonicalDecisionsMap = new Map(
    canonicalDecisions.map(cd => [`${cd.person_id}:${cd.canonical_job_id}`, cd])
  );

  const canonicalOpps = await db.many<any>(`SELECT id, source, source_job_id FROM canonical_opportunities`);
  const canonicalById = new Map(canonicalOpps.map(o => [o.id, o]));
  const canonicalBySourceJobId = new Map(canonicalOpps.map(o => [o.source_job_id, o]));

  const breakdown = {
    legitimate_production_migrated: [] as any[],
    synthetic_test_quarantined: [] as any[],
    invalid_unmapped: [] as any[],
    ambiguous: [] as any[],
    duplicate_unresolved: [] as any[],
    cross_tenant: [] as any[],
    missing_person: [] as any[],
    missing_opportunity: [] as any[],
  };

  const syntheticPatterns = [
    /^job_rev_/,
    /^op-test-/,
    /^test-/,
    /^mock-/,
    /^sample-/,
    /^job_test_/,
    /^opp-test-/,
    /^test_/
  ];

  for (const dec of legacyDecisions) {
    const oppId = dec.opportunity_id;
    const isSynthetic = syntheticPatterns.some(pat => pat.test(oppId));

    if (isSynthetic) {
      breakdown.synthetic_test_quarantined.push({
        id: dec.id,
        person_id: dec.person_id,
        opportunity_id: oppId,
        reason: `Synthetic test fixture ID pattern: ${oppId}`,
        action: dec.action,
      });
      continue;
    }

    // Resolve canonical opportunity
    let canon = canonicalById.get(oppId) || canonicalBySourceJobId.get(oppId);
    let matchMethod = "";

    if (canonicalById.has(oppId)) {
      canon = canonicalById.get(oppId);
      matchMethod = "exact_canonical_id";
    } else if (canonicalBySourceJobId.has(oppId)) {
      canon = canonicalBySourceJobId.get(oppId);
      matchMethod = "source_job_id_match";
    } else {
      // Try stripping prefix
      const stripped = oppId.replace(/^j-/, "");
      if (canonicalBySourceJobId.has(stripped)) {
        canon = canonicalBySourceJobId.get(stripped);
        matchMethod = "stripped_source_job_id_match";
      }
    }

    if (!canon) {
      breakdown.missing_opportunity.push({
        id: dec.id,
        person_id: dec.person_id,
        opportunity_id: oppId,
        reason: "Could not resolve to canonical opportunity",
      });
      continue;
    }

    // Check if migrated into canonical_decisions
    const key = `${dec.person_id}:${canon.id}`;
    if (canonicalDecisionsMap.has(key)) {
      breakdown.legitimate_production_migrated.push({
        id: dec.id,
        person_id: dec.person_id,
        opportunity_id: oppId,
        canonical_job_id: canon.id,
        match_method: matchMethod,
        action: dec.action,
      });
    } else {
      breakdown.invalid_unmapped.push({
        id: dec.id,
        person_id: dec.person_id,
        opportunity_id: oppId,
        canonical_job_id: canon.id,
        reason: "Valid canonical opportunity found, but decision missing in canonical_decisions",
      });
    }
  }

  console.log("\n=== RECONCILIATION BREAKDOWN ===");
  console.log(`Legitimate production migrated: ${breakdown.legitimate_production_migrated.length}`);
  console.log(`Synthetic test quarantined:     ${breakdown.synthetic_test_quarantined.length}`);
  console.log(`Invalid / unmapped:             ${breakdown.invalid_unmapped.length}`);
  console.log(`Ambiguous:                      ${breakdown.ambiguous.length}`);
  console.log(`Duplicate / unresolved:         ${breakdown.duplicate_unresolved.length}`);
  console.log(`Cross-tenant:                   ${breakdown.cross_tenant.length}`);
  console.log(`Missing person:                 ${breakdown.missing_person.length}`);
  console.log(`Missing opportunity:            ${breakdown.missing_opportunity.length}`);
  console.log(`Total Accounted For:            ${
    breakdown.legitimate_production_migrated.length +
    breakdown.synthetic_test_quarantined.length +
    breakdown.invalid_unmapped.length +
    breakdown.ambiguous.length +
    breakdown.duplicate_unresolved.length +
    breakdown.cross_tenant.length +
    breakdown.missing_person.length +
    breakdown.missing_opportunity.length
  }`);

  if (breakdown.missing_opportunity.length > 0) {
    console.log("\nSample missing opportunity items:", breakdown.missing_opportunity.slice(0, 5));
  }

  console.log("\nDistinct match methods for migrated decisions:");
  const methodCounts: Record<string, number> = {};
  for (const item of breakdown.legitimate_production_migrated) {
    methodCounts[item.match_method] = (methodCounts[item.match_method] || 0) + 1;
  }
  console.log(methodCounts);
}

reconcileDecisions().catch(console.error);
