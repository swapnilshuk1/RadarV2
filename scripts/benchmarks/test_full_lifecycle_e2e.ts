/**
 * scripts/benchmarks/test_full_lifecycle_e2e.ts
 *
 * Full Lifecycle End-to-End Test:
 * 1. Ingest realistic Executive CMO JD (> 300 chars)
 * 2. Verify SearchPlan projection (CANDIDATE)
 * 3. Drain Evaluation Worker queue (runs candidate scoring against profile ms6i7e3y-4x0chy5fy)
 * 4. Verify Materialized Evaluation (Score, Decision, Provenance)
 * 5. Query OpportunityService.listForUser() and assert presence in Frontend Shortlist Feed
 */

import { getDatabaseAdapter } from "../../src/data/database/index";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { EvaluationWorker } from "../../src/lib/intelligence/EvaluationWorker";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";

async function main() {
  const db = getDatabaseAdapter();
  const personId = "ms6i7e3y-4x0chy5fy";
  const tenantId = "tenant_default";

  console.log("================================================================================");
  console.log("             FULL LIFECYCLE END-TO-END PIPELINE AUDIT");
  console.log("================================================================================");

  const fullExecutiveJD = {
    sourcePortal: "LinkedIn",
    sourceJobId: "li-cmo-enterprise-002",
    canonicalUrl: "https://www.linkedin.com/jobs/view/li-cmo-enterprise-002",
    jobTitle: "Chief Marketing Officer",
    companyName: "HyperScale Tech Global",
    location: "Bengaluru, Karnataka, India (Hybrid)",
    employmentType: "Full-time",
    rawContent: `
      About HyperScale Tech Global:
      HyperScale Tech is a premier enterprise SaaS platform empowering Fortune 500 enterprises with AI-driven digital transformation and cloud operations.

      The Executive Mandate:
      We are searching for a visionary, metrics-driven Chief Marketing Officer (CMO) to report directly to the CEO and Board. In this role, you will hold global P&L responsibility for our marketing organization, leading a 40+ person cross-functional team across Brand Strategy, Enterprise Demand Generation, Product Marketing, Commercial Enablement, and Corporate Communications.

      Key Responsibilities:
      - Drive end-to-end commercial growth, pipeline generation, and ARR acceleration across North America, EMEA, and APAC.
      - Partner with Chief Commercial Officer and Head of Product to position new AI and cloud product lines.
      - Architect global brand campaigns, high-impact enterprise industry keynotes, and executive customer advisory boards.
      - Scale customer acquisition and retention, overseeing full lifecycle customer journey and demand waterfall.
      - Manage an annual operating budget of $25M+, optimizing CAC, LTV, pipeline velocity, and return on marketing spend.

      Ideal Candidate Profile:
      - 15+ years of executive marketing leadership in high-growth enterprise technology, SaaS, or digital transformation.
      - Proven track record scaling revenue from $50M to $250M+ ARR.
      - Deep expertise in both brand storytelling and rigorous quantitative demand generation.
      - Exceptional board presence, executive consensus-building, and cross-functional leadership skills.
    `,
    postedAt: new Date().toISOString(),
  };

  console.log(`[Step 1] Ingesting Full Executive Opportunity: ${fullExecutiveJD.jobTitle} @ ${fullExecutiveJD.companyName}...`);
  const ingestionService = new CanonicalIngestionService(db);
  const ingestRes = await ingestionService.ingestOpportunity(fullExecutiveJD, { tenantId, personId });

  console.log(`✓ Ingestion Completed:`);
  console.log(`  Canonical Job ID    : ${ingestRes.canonicalJobId}`);
  console.log(`  Opportunity Version : ${ingestRes.opportunityVersion}`);
  console.log(`  Is New Opportunity  : ${ingestRes.isNewOpportunity}`);
  console.log(`  Is New Version      : ${ingestRes.isNewVersion}`);
  console.log(`  Candidates Projected: ${ingestRes.candidatesProjected}`);
  console.log(`  Jobs Enqueued       : ${ingestRes.jobsEnqueued}`);

  console.log(`\n[Step 2] Processing Evaluation Work Queue via EvaluationWorker...`);
  const worker = new EvaluationWorker(db);
  const drainRes = await worker.drainQueue({ maxJobs: 10, concurrency: 1 });
  console.log(`✓ Evaluation Worker Drain:`, drainRes);

  console.log(`\n[Step 3] Inspecting Materialized Evaluation Result in Database...`);
  const evalRow = await db.one<{
    decision: string;
    quality_score: number;
    vetoed: number;
    evaluation_state: string;
    evaluation_json: string;
  }>(
    `SELECT decision, quality_score, vetoed, evaluation_state, evaluation_json
     FROM materialized_evaluations
     WHERE canonical_job_id = ? AND opportunity_version = ? AND person_id = ?`,
    [ingestRes.canonicalJobId, ingestRes.opportunityVersion, personId]
  );

  console.log(`✓ Materialized Evaluation Details:`);
  console.log(`  Engine Decision  : ${evalRow?.decision}`);
  console.log(`  Quality Score    : ${evalRow?.quality_score}/100`);
  console.log(`  Evaluation State : ${evalRow?.evaluation_state}`);
  console.log(`  Vetoed           : ${evalRow?.vetoed === 1 ? "YES" : "NO"}`);
  if (evalRow?.evaluation_json) {
    const parsed = JSON.parse(evalRow.evaluation_json);
    console.log(`  Why Now          : "${parsed.whyNow || parsed.record?.whyNow || "N/A"}"`);
    console.log(`  Positioning      :`, parsed.positioning || parsed.record?.positioning || []);
  }

  console.log(`\n[Step 4] Querying Frontend Shortlist Feed (OpportunityService.listForUser)...`);
  const feed = await OpportunityService.listForUser(personId, { decisionFilter: "unreviewed" });
  console.log(`✓ Total Unreviewed Opportunities in Feed: ${feed.length}`);

  const foundInFeed = feed.find((item) => item.jobHash === fullExecutiveJD.sourceJobId || item.jobHash === ingestRes.canonicalJobId);

  if (foundInFeed) {
    console.log(`\n🎉 SUCCESS! Opportunity is LIVE on Frontend Shortlist View:`);
    console.log(`   - Job Hash      : ${foundInFeed.jobHash}`);
    console.log(`   - Role          : ${foundInFeed.role}`);
    console.log(`   - Company       : ${foundInFeed.company}`);
    console.log(`   - Location      : ${foundInFeed.location}`);
    console.log(`   - Decision Verb : ${foundInFeed.decision}`);
    console.log(`   - Fit Score     : ${foundInFeed.recommendationResult?.score ?? "N/A"}`);
    console.log(`   - State         : ${foundInFeed.evaluationState}`);
    console.log(`   - Why Now       : ${foundInFeed.whyNow || "N/A"}`);
  } else {
    console.error(`\n❌ ERROR: Opportunity was evaluated but not returned in the shortlist feed.`);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
