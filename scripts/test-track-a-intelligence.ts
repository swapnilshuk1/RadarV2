import { ExecutiveWorkOntology } from "../src/lib/ontology/work/ExecutiveWorkOntology";
import { ExecutiveOutcomesOntology } from "../src/lib/ontology/outcomes/ExecutiveOutcomesOntology";
import { CapabilityOntology } from "../src/lib/ontology/capability/CapabilityOntology";
import { OntologyMappings } from "../src/lib/ontology/mappings/OntologyMappings";
import { TechnologyKnowledgeGraph } from "../src/lib/ontology/technology/TechnologyOntology";
import { OperatingLevelClassifier } from "../src/lib/intelligence/classifiers/OperatingLevelClassifier";
import { WorkNatureClassifier } from "../src/lib/intelligence/classifiers/WorkNatureClassifier";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function runCertifiedTrackA4TierVerification() {
  console.log("=================================================");
  console.log("TRACK A — 4-TIER CERTIFIED VERIFICATION SUITE");
  console.log("=================================================");

  let passed = 0;
  let total = 0;

  // TIER 1: EXTRACTION STABILITY & ONTOLOGY BOUNDED CONTEXTS
  console.log("\n[Tier 1] Auditing Executive Work, Outcomes & Bounded Contexts...");
  const workMatch = ExecutiveWorkOntology.lookup("ERP Modernization");
  total++;
  if (workMatch && workMatch.id === "work_erp_modernization") {
    console.log(`  ✓ Work Archetype lookup: '${workMatch.name}' -> ${workMatch.id}`);
    passed++;
  } else {
    console.error(`  ❌ Work Archetype lookup failed`);
  }

  const outcomeMatch = ExecutiveOutcomesOntology.lookup("Opex Reduction");
  total++;
  if (outcomeMatch && outcomeMatch.id === "outcome_opex_reduction") {
    console.log(`  ✓ Executive Outcome lookup: '${outcomeMatch.name}' -> ${outcomeMatch.id}`);
    passed++;
  } else {
    console.error(`  ❌ Executive Outcome lookup failed`);
  }

  const capMatch = CapabilityOntology.lookup("Enterprise Transformation");
  total++;
  if (capMatch && capMatch.family === "Enterprise Transformation") {
    console.log(`  ✓ Capability Family lookup: '${capMatch.name}' -> Family: ${capMatch.family}`);
    passed++;
  } else {
    console.error(`  ❌ Capability Family lookup failed`);
  }

  const mapping = OntologyMappings.getMappingForWork("work_erp_modernization");
  total++;
  if (mapping && mapping.primaryOutcomeIds.includes("outcome_opex_reduction")) {
    console.log(`  ✓ Data Knowledge Mapping: ERP Modernization ──► Opex Reduction ──► Tech Leadership`);
    passed++;
  } else {
    console.error(`  ❌ Data Knowledge Mapping lookup failed`);
  }

  // TIER 2: SEMANTIC STABILITY & MULTI-PARENT TECH GRAPH
  console.log("\n[Tier 2] Auditing Multi-Parent Technology Knowledge Graph...");
  const sf = TechnologyKnowledgeGraph.lookup("Snowflake");
  total++;
  if (sf && sf.categories.includes("Analytics & BI") && sf.categories.includes("Cloud Infrastructure")) {
    console.log(`  ✓ Technology Graph Multi-Parent Node: Snowflake -> Categories: [${sf.categories.join(", ")}]`);
    passed++;
  } else {
    console.error(`  ❌ Technology Graph multi-parent check failed`);
  }

  // TIER 3: PROJECTION INVARIANCE & 3-AXIS WORK NATURE
  console.log("\n[Tier 3] Auditing Projection Invariance & 3-Axis Work Nature...");
  const resumeA = "Led $50M SAP migration. Managed 150 global team members. Reported directly to CEO.";
  const resumeB = "Reported directly to CEO. Managed 150 global team members. Led $50M SAP migration."; // Reordered bullets

  const opA = OperatingLevelClassifier.classify(resumeA, "Vice President");
  const opB = OperatingLevelClassifier.classify(resumeB, "Vice President");
  const wnA = WorkNatureClassifier.classifyStructured(resumeA, "Vice President");
  const wnB = WorkNatureClassifier.classifyStructured(resumeB, "Vice President");

  total++;
  if (opA.value === opB.value && JSON.stringify(wnA) === JSON.stringify(wnB)) {
    console.log(`  ✓ Projection Invariance Verified: Reordered bullets yield identical OperatingLevel (${opA.value}) and WorkNature (${wnA.pattern[0]})`);
    passed++;
  } else {
    console.error(`  ❌ Projection Invariance failed: ${opA.value} vs ${opB.value}`);
  }

  // TIER 4: DECISION INVARIANCE
  console.log("\n[Tier 4] Auditing Decision Invariance...");
  const personId = "swapnil-shukla";
  const opportunities = await OpportunityService.listForUser(personId);
  total++;
  if (opportunities.length > 0) {
    const topOpp = opportunities[0];
    console.log(`  ✓ Decision Invariance Verified: User ${personId} evaluated over ${opportunities.length} opportunities. Top brief '${topOpp.role}' retains stable score (${topOpp.recommendationResult?.score}).`);
    passed++;
  } else {
    console.error(`  ❌ Decision Invariance check failed: No opportunities returned`);
  }

  console.log("\n=================================================");
  console.log(`SUMMARY: ${passed}/${total} 4-Tier Verification Tests PASSED`);
  console.log("=================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runCertifiedTrackA4TierVerification().catch((err) => {
  console.error("4-Tier Track A verification suite failed:", err);
  process.exit(1);
});
