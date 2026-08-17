/**
 * RADAR V4 Phase 5 — Live-Path Executive Certification Harness
 *
 * Certifies the EXACT live editorial composition pipeline used in production views:
 * Opportunity Record -> present.ts -> BriefCompositionEngine.compose() -> Final Executive Brief
 *
 * Enforces Invariants 1 through 8.
 */

import { runEngine } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import { EditorialContextBuilder } from "../src/lib/intelligence/editorial/EditorialContext";
import { rawOpportunities } from "../src/data/opportunity-fixtures";
import { present } from "../src/lib/intelligence/present";

const BLACKLIST_PATTERNS = [
  { name: "Hype/Corporate Cliché", regex: /\b(exciting|dynamic|fast-paced|strategic role|unusually concentrated|great fit)\b/i },
  { name: "Internal Telemetry", regex: /\b(ESG|graph path|transferability|extractorVersion|matching score|\+.*Brand Capital|-[0-9]+.*Scope Risk)\b/i },
  { name: "Generic AI Hedges", regex: /\b(appears to|seems to|may potentially|likely could)\b/i },
];

async function runLiveCertification() {
  console.log("================================================================================");
  console.log("     RADAR V4 PHASE 5 — LIVE-PATH EDITORIAL INTEGRITY CERTIFICATION HARNESS    ");
  console.log("================================================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const candidateProjection = builder.fromProfile(candidateProfile);
  const { presented, records } = runEngine(candidateProjection, 0);

  let passed = 0;
  let failed = 0;

  console.log(`[SUITE 1] Auditing ${records.length} Engine Records via BriefCompositionEngine.compose()...\n`);

  for (const record of records) {
    const item = presented.find((p) => p.record.jobHash === record.jobHash);
    if (!item) continue;

    const opp = item.opportunity;
    const brief = BriefCompositionEngine.compose(opp, { bypassHistory: true });

    let caseFailed = false;
    const failures: string[] = [];

    // Invariant 2 Check: Policy Verdict Immutability
    const expectedVerdict = record.verb === "PURSUE" ? "PURSUE" : record.verb === "CONSIDER" ? "CONSIDER" : "PASS";
    if (brief.memory.decision !== expectedVerdict) {
      caseFailed = true;
      failures.push(`Invariant 2 Violation: Brief decision "${brief.memory.decision}" !== Policy verdict "${expectedVerdict}" (raw verb: ${record.verb})`);
    }

    // Invariant 3 Check: Career Value Protection Guidance
    const hasCvpRule = (record.triggeredRuleIds || []).includes("R-CONSIDER-CAREER-VALUE-PROTECTION");
    if (hasCvpRule) {
      const watchForText = brief.oneMinuteTLDR.watchFor.join(" ");
      const bottomLineText = brief.oneMinuteTLDR.bottomLine;
      const cvpSurfaced = watchForText.includes("interview probability") || bottomLineText.includes("limited career step-up") || brief.memory.primaryRisk.includes("step-up");
      if (!cvpSurfaced) {
        caseFailed = true;
        failures.push(`Invariant 3 Violation: CVP rule triggered but warning not surfaced in brief`);
      }
    }

    // Anti-Pattern / Blacklist Check
    const prose = [
      brief.memory.headline,
      brief.memory.primaryOpportunity,
      brief.memory.primaryRisk,
      brief.memory.recommendedAction,
      brief.oneMinuteTLDR.bottomLine,
      ...brief.oneMinuteTLDR.whyPursue,
      ...brief.oneMinuteTLDR.watchFor,
    ].join(" ");

    for (const pattern of BLACKLIST_PATTERNS) {
      if (pattern.regex.test(prose)) {
        caseFailed = true;
        failures.push(`Anti-Pattern Violation [${pattern.name}]: matched "${prose.match(pattern.regex)?.[0]}"`);
      }
    }

    if (caseFailed) {
      failed++;
      console.log(`❌ [FAIL] ${opp.company} - ${opp.role}`);
      failures.forEach((f) => console.log(`     - ${f}`));
    } else {
      passed++;
      console.log(`✅ [PASS] ${opp.company} - ${opp.role} (Verdict: ${brief.memory.decision}, Pattern: ${brief.pattern?.id || "DEFAULT"})`);
    }
  }

  console.log("\n[SUITE 2] Epistemic Self-Inference & Provenance Isolation Check...\n");

  // Verify EditorialContextBuilder ignores primaryDriver/primaryConcern pollution
  const pollutedOpp = {
    jobHash: "test-polluted-1",
    role: "Marketing Manager",
    company: "Acme Corp",
    location: "Bengaluru",
    primaryDriver: "Massive P&L ownership of $100M with turnaround mandate",
    primaryConcern: "High turnaround risk in P&L structure",
    dimensions: [],
  };

  const context = EditorialContextBuilder.build(pollutedOpp as any);
  if (context.hasPnlOwnership === true && context.pnlProvenance !== "ENGINE_VERIFIED") {
    failed++;
    console.log("❌ [FAIL] Epistemic Self-Inference: EditorialContextBuilder parsed generated primaryDriver text!");
  } else {
    passed++;
    console.log("✅ [PASS] Epistemic Self-Inference Blocked: Context ignored narrative text pollution.");
  }

  console.log("\n[SUITE 3] Phase 6 Adversarial Contradictions & Invariant Audit...\n");
  const { runAdversarialCorpus } = await import("./test-phase6-contradictions");
  const advRes = await runAdversarialCorpus();
  passed += advRes.passed;
  failed += advRes.failed;

  console.log("\n================================================================================");
  console.log(` CERTIFICATION RESULT: ${failed === 0 ? "🟢 CERTIFIED & PASSED" : "🔴 FAILED"}`);
  console.log(` Passed: ${passed} | Failed: ${failed}`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runLiveCertification().catch((err) => {
  console.error("Certification error:", err);
  process.exit(1);
});
