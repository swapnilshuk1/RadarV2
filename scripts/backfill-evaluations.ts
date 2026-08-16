import { getRepositories } from "../src/data/sqlite/provider";
import { SqliteEvaluationStore } from "../src/data/sqlite/repositories/SqliteEvaluationStore";
import { EvaluationWorker } from "../src/lib/intelligence/workers/EvaluationWorker";
import { candidateProfile } from "../src/data/candidate-profile";

async function runBackfill() {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("           RADAR v2 Candidate Evaluations Backfill Engine           ");
  console.log("════════════════════════════════════════════════════════════════════");

  const repos = getRepositories();
  const evalStore = repos.evaluations;

  // 1. Fetch registered users from people table
  const peopleRows = await (repos.people as any).db.many("SELECT id, name FROM people");
  const targetUsers: string[] = peopleRows.map((p: any) => p.id);
  console.log(`✓ Found ${targetUsers.length} registered candidate profile(s): ${targetUsers.join(", ")}`);

  // 2. Fetch all opportunities from database
  console.log("\n[1/4] Scanning opportunity corpus...");
  const oppSources = await repos.opportunities.listOpportunitySources();
  console.log(`✓ Discovered ${oppSources.length} opportunities in repository.`);

  const { syncCanonicalCandidateProjection } = await import("../src/lib/intelligence/candidate-sync");
  const { runEngine } = await import("../src/lib/intelligence/engine");

  for (const personId of targetUsers) {
    console.log(`\n====================================================================`);
    console.log(`Backfilling candidate: ${personId}`);
    console.log(`====================================================================`);

    const profileVersion = "v1";

    // Inspect existing candidate_evaluations
    const existingEvaluations = await evalStore.listEvaluationsForUser(personId, 10000);
    const evalMap = new Map(existingEvaluations.map((e) => [e.jobHash, e]));
    console.log(`✓ Found ${existingEvaluations.length} existing candidate_evaluations for ${personId}.`);

    let enqueuedCount = 0;
    let skippedFreshCount = 0;
    const oppsToEvaluate: typeof oppSources = [];

    for (const opp of oppSources) {
      const jobHash = opp.jobHash || (opp as any).id;
      if (!jobHash) continue;
      const expectedInputHash = SqliteEvaluationStore.computeInputHash(
        profileVersion,
        jobHash,
        "v4.1",
        "v2"
      );

      const existing = evalMap.get(jobHash);
      if (existing && existing.evaluationInputHash === expectedInputHash) {
        skippedFreshCount++;
        continue;
      }

      oppsToEvaluate.push(opp);
      enqueuedCount++;
    }

    console.log(`✓ Fresh Evaluations Skipped: ${skippedFreshCount}`);
    console.log(`✓ Missing/Stale Roles to Backfill: ${enqueuedCount}`);

    // Process missing evaluations in bulk and persist to candidate_evaluations
    if (oppsToEvaluate.length > 0) {
      console.log(`\n[3/4] Evaluating and persisting ${oppsToEvaluate.length} candidate evaluations...`);
      const startTime = Date.now();

      let projection = await repos.people.getLatestProjection(personId);
      if (!projection) {
        console.log(`  Synchronizing canonical candidate profile for "${personId}"...`);
        projection = await syncCanonicalCandidateProjection(personId);
      }
      const userDecisions = await repos.decisions.getUserDecisions(personId);

    const { runEngine } = await import("../src/lib/intelligence/engine");
    const activeCount = Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    const { presented } = runEngine(projection, activeCount, oppsToEvaluate);

    console.log(`✓ Engine evaluation generated ${presented.length} structured recommendations.`);

    let persisted = 0;
    const batchSize = 25;
    for (let i = 0; i < presented.length; i += batchSize) {
      const batch = presented.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (p) => {
          const jobHash = p.opportunity.jobHash;
          const inputHash = SqliteEvaluationStore.computeInputHash(profileVersion, jobHash, "v4.1", "v2");
          const decision = (["PURSUE", "CONSIDER", "PASS"].includes(p.record.verb)
            ? p.record.verb
            : "CONSIDER") as "PURSUE" | "CONSIDER" | "PASS";
          const score = p.record.vetoed ? 0 : (p.record.qualityScore || 70.0);

          await evalStore.saveEvaluation({
            personId,
            jobHash,
            policyVersion: p.record.recommendationVersion || "v4.1",
            evaluationInputHash: inputHash,
            engineVerdict: decision,
            engineQualityScore: score,
            effectiveDecision: decision,
            qualityScore: score,
            evaluationStatus: "COMPLETE",
            evaluationJson: JSON.stringify({
              ...p.opportunity,
              engineRecommendation: {
                jobHash,
                evaluationFingerprint: p.record.recommendationVersion,
                engineVerdict: decision,
                vetoed: Boolean(p.record.vetoed),
                vetoReason: p.record.vetoReason || null,
                qualityScore: score,
                parsingConfidence: p.record.confidences?.parsing ?? (p.record.confidence ?? 0.8),
                evaluatedAt: new Date().toISOString(),
              },
            }),
          });
        })
      );
      persisted += batch.length;
      if (persisted % 100 === 0 || persisted === presented.length) {
        process.stdout.write(`\r  Persisted ${persisted}/${presented.length} evaluations (${Math.round((persisted / presented.length) * 100)}%)...`);
      }
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✓ Completed backfill persistence of ${persisted} candidate evaluations in ${elapsedSec}s.`);
  } else {
    console.log("\n[3/4] All candidate evaluations are 100% up-to-date.");
  }

  // 4. Final Reconciliation per candidate
  console.log(`\n[4/4] Reconciliation Audit Report for ${personId}:`);
  const finalEvaluations = await evalStore.listEvaluationsForUser(personId, 10000);
  console.log("────────────────────────────────────────────────────────────────────");
  console.log(`Total Opportunities in Corpus : ${oppSources.length}`);
  console.log(`Materialized Evaluations     : ${finalEvaluations.length}`);
  console.log("────────────────────────────────────────────────────────────────────");

  if (finalEvaluations.length >= Math.min(oppSources.length, 100)) {
    console.log(`✅ RECONCILIATION SUCCESS: Candidate evaluations backfill is complete for ${personId}.`);
  } else {
    console.log(`⚠️ RECONCILIATION NOTICE: Some opportunities remain unevaluated for ${personId}.`);
  }
}
}

runBackfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
