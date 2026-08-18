import { getDatabaseAdapter } from "../src/data/database";

// Policy dimensions we want to score against
const POLICY_DIMENSIONS = [
  { key: "leadershipLevel", expectedAttribute: "requiredLevel", label: "Leadership Level" },
  { key: "mandate", expectedAttribute: "mandate", label: "Mandate / Directives" },
  { key: "transformation", expectedAttribute: "mandate", label: "Transformation" }, // derived from mandate
  { key: "commercialAccountability", expectedAttribute: "commercialAccountability", label: "Commercial Accountability" },
  { key: "geography", expectedAttribute: "geography", label: "Geography" },
  { key: "technologyStack", expectedAttribute: "technologyStack", label: "Technology Stack" },
  { key: "functionalScope", expectedAttribute: "functionalScope", label: "Functional Scope" },
  { key: "workModel", expectedAttribute: "workModel", label: "Work Model" },
  { key: "reportingLine", expectedAttribute: "reportingLine", label: "Reporting Line" }
];

async function main() {
  const db = getDatabaseAdapter();

  try {
    // Get total opportunities
    const totalJobsRow = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunities WHERE lifecycle IN ('Normalized', 'Verified')");
    const totalJobs = totalJobsRow ? totalJobsRow.count : 0;
    console.log(`Total Opportunities: ${totalJobs}\n`);

    // Fetch facts grouped by opportunity
    const factRows = await db.many<any>("SELECT opportunity_id, attribute, value FROM facts");
    const factsByJob = new Map<string, Record<string, any>>();
    for (const fact of factRows) {
      if (!factsByJob.has(fact.opportunity_id)) {
        factsByJob.set(fact.opportunity_id, {});
      }
      try {
        const parsed = JSON.parse(fact.value);
        factsByJob.get(fact.opportunity_id)![fact.attribute] = parsed?.value ?? parsed ?? null;
      } catch {
        factsByJob.get(fact.opportunity_id)![fact.attribute] = fact.value;
      }
    }

    console.log(`======================================================================`);
    console.log(`                   KNOWLEDGE GRAPH COVERAGE AUDIT`);
    console.log(`======================================================================`);
    console.log(`${"Policy Dimension".padEnd(25)} | ${"KG Attribute".padEnd(25)} | ${"Coverage %".padStart(10)} | ${"Count / Total".padStart(15)}`);
    console.log("-".repeat(82));

    const coverageData: Record<string, number> = {};

    for (const dim of POLICY_DIMENSIONS) {
      let presentCount = 0;
      for (const [_, jobFacts] of factsByJob.entries()) {
        const val = jobFacts[dim.expectedAttribute];
        
        // Special logic for transformation which is derived from the 'mandate' attribute
        if (dim.key === "transformation") {
          if (val && typeof val === "string" && val.toLowerCase().match(/transform|turnaround|pivot|restruct|align/)) {
            presentCount++;
          }
        } else {
          if (val !== undefined && val !== null && val !== "") {
            presentCount++;
          }
        }
      }

      const coveragePct = totalJobs > 0 ? (presentCount / totalJobs) * 100 : 0;
      coverageData[dim.key] = coveragePct;
      console.log(
        `${dim.label.padEnd(25)} | ${dim.expectedAttribute.padEnd(25)} | ${coveragePct.toFixed(1).padStart(9)}% | ${`${presentCount}/${totalJobs}`.padStart(15)}`
      );
    }
    console.log(`======================================================================`);

    // Recommendation Readiness
    console.log(`\n======================================================================`);
    console.log(`                   RECOMMENDATION READINESS REPORT`);
    console.log(`======================================================================`);
    let totalScore = 0;
    for (const dim of POLICY_DIMENSIONS) {
      const pct = coverageData[dim.key];
      const status = pct >= 80 ? "✅ Ready" : pct >= 50 ? "⚠️ Marginal" : "❌ Deficient";
      console.log(`${dim.label.padEnd(30)}: ${status.padEnd(12)} (${pct.toFixed(1)}% coverage)`);
      totalScore += pct;
    }
    const readinessPct = totalScore / POLICY_DIMENSIONS.length;
    console.log(`----------------------------------------------------------------------`);
    console.log(`Overall Readiness Score: ${readinessPct.toFixed(1)}%`);
    console.log(`======================================================================`);

    // Top 20 Missing Dimensions/Alias Recommendations
    console.log(`\n📋 ALIAS MAP AND PERSISTENCE RECOMMENDATIONS:`);
    console.log(`1. 'leadershipLevel' -> Map to 'requiredLevel' (Coverage: ${(coverageData['leadershipLevel'] || 0).toFixed(1)}%)`);
    console.log(`2. 'transformation' -> Derive from 'mandate' containing transformation keywords (e.g. 'transform', 'turnaround')`);
    console.log(`3. 'commercialAccountability' -> Only 28/588 records have this (4.8% coverage). The parser needs enrichment.`);
    console.log(`4. 'reportingLine' -> Only 20/588 records have this (3.4% coverage). Needs parser enrichment.`);

  } catch (err) {
    console.error("Error running audit:", err);
  } finally {
    db.close();
  }
}

main();
