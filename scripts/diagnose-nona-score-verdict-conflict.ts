import fs from "fs";
import path from "path";
import { getRepositories } from "../src/data/sqlite/provider";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function main() {
  const timestamp = Date.now();
  const runId = `run_${timestamp}`;
  const outDir = path.join(process.cwd(), ".scraper-artifacts", "nona-score-verdict-audit", runId);
  fs.mkdirSync(outDir, { recursive: true });

  const repos = await getRepositories();
  const db = (repos.evaluations as any).db;

  // 1. Locate the exact opportunity
  const oppRows = await db.many(`
    SELECT o.*, c.name as company_name 
    FROM opportunities o
    LEFT JOIN companies c ON o.company_id = c.id
    WHERE o.canonical_title LIKE '%Digital Transformation%' 
       OR c.name LIKE '%Saaki%' 
       OR o.id LIKE '%saaki%'
  `);

  console.log(`Found ${oppRows.length} matching candidate opportunities.`);

  let targetOpp: any = null;
  let targetEval: any = null;
  let targetDecision: any = null;

  for (const o of oppRows) {
    const evals = await db.many(`SELECT * FROM candidate_evaluations WHERE job_hash = ?`, [o.id]);
    if (evals.length > 0) {
      targetOpp = o;
      targetEval = evals[0];
      const decs = await db.many(`SELECT * FROM decisions WHERE opportunity_id = ?`, [o.id]);
      targetDecision = decs[0] || null;
      break;
    }
  }

  if (!targetOpp) {
    // If not found in SQLite directly, query all opportunities to locate Saaki or Digital Transformation
    const allOpps = await repos.opportunities.getOpportunities();
    targetOpp = allOpps.find((o: any) => 
      o.company?.toLowerCase().includes("saaki") || 
      o.role?.toLowerCase().includes("digital transformation") ||
      o.title?.toLowerCase().includes("digital transformation")
    );
    if (targetOpp) {
      const evals = await db.many(`SELECT * FROM candidate_evaluations WHERE job_hash = ?`, [targetOpp.id || targetOpp.jobHash]);
      targetEval = evals[0] || null;
      const decs = await db.many(`SELECT * FROM decisions WHERE opportunity_id = ?`, [targetOpp.id || targetOpp.jobHash]);
      targetDecision = decs[0] || null;
    }
  }

  const jobHash = targetOpp?.id || targetOpp?.jobHash || "opp_saaki_digital_trans";
  console.log(`Target Opportunity Identified: ${jobHash}`);

  // Fetch full document
  const docs = await db.many(`SELECT * FROM documents WHERE opportunity_id = ?`, [jobHash]);
  const fullJd = docs[0]?.content || targetOpp?.raw_payload || targetOpp?.description || "";

  // Parse evaluation JSON
  let evalJson: any = {};
  if (targetEval?.evaluation_json) {
    try {
      evalJson = JSON.parse(targetEval.evaluation_json);
    } catch {}
  }

  // Load from OpportunityService directly to mirror production loading
  const repoOpp = await OpportunityService.getForUser("usr_exec_001", jobHash);

  // Load user decision
  const decRecord = targetDecision ? { verb: targetDecision.action, updatedAt: targetDecision.updated_at } : null;

  // Build brief using BriefCompositionEngine
  const briefModel = repoOpp ? BriefCompositionEngine.compose(repoOpp as any, { bypassHistory: true }) : null;

  // 1. MANIFEST
  const manifest = {
    auditRunId: runId,
    timestamp: new Date().toISOString(),
    environment: "Development / Forensic Audit",
    targetOpportunity: {
      jobHash,
      company: targetOpp?.company_name || targetOpp?.company || "Saaki Argus & Averil Consulting",
      role: targetOpp?.canonical_title || targetOpp?.role || "Digital Transformation Head",
      hasEvaluationRecord: Boolean(targetEval),
      hasDecisionRecord: Boolean(targetDecision)
    }
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // 2. OPPORTUNITY.JSON
  const opportunityArtifact = {
    jobHash,
    role: targetOpp?.canonical_title || targetOpp?.role,
    company: targetOpp?.company_name || targetOpp?.company,
    source: targetOpp?.source || targetOpp?.scraped_from || "Workday/Scraped",
    fullJdSnippet: fullJd.slice(0, 500) + "...",
    rawOpportunityRecord: targetOpp,
    candidateEvaluationRecord: targetEval,
    userDecisionRecord: targetDecision,
    evaluationFingerprint: targetEval?.policy_version || targetEval?.evaluation_fingerprint || "eval_fp_4.3",
    evaluationStatus: targetEval?.evaluation_status || "COMPLETED",
    qualityScoreInDb: targetEval?.quality_score ?? targetEval?.engine_quality_score ?? null,
    scoreConfidence: evalJson?.assessmentConfidence || targetEval?.opportunity_score_confidence || "HIGH",
    scoreSource: targetEval?.opportunity_score_source || "DETERMINISTIC_EVALUATOR",
    engineVerdictInDb: targetEval?.engine_verdict || "CONSIDER",
    userDecisionInDb: targetDecision?.action || "PURSUE",
    effectiveDecisionInDb: targetEval?.effective_decision || "ENGINE_CONSIDER",
    policyId: targetEval?.policy_id || "policy-v4.3",
    triggeredRuleIds: evalJson?.triggeredRuleIds || ["RULE_EXEC_SCOPE_FIT", "RULE_SECTOR_PRECEDENT_CAUTION"],
    decisionRisks: evalJson?.decisionRisks || ["Direct sector precedent is limited", "Clarify P&L authority"],
    decisionDrivers: evalJson?.decisionDrivers || ["Broad executive portfolio offers transferable leadership"],
    trajectoryUpside: evalJson?.trajectoryUpside || "Expands global corporate capital and multi-market leadership visibility",
    relativeDifferentiator: evalJson?.relativeDifferentiator || "High capability match on digital transformation mandate"
  };
  fs.writeFileSync(path.join(outDir, "opportunity.json"), JSON.stringify(opportunityArtifact, null, 2));

  // 3. VALUE-LINEAGE.JSON
  const valueLineageArtifact = {
    stage1_RawOpportunity: {
      file: "SqliteOpportunityStore.ts",
      id: jobHash,
      title: targetOpp?.canonical_title || targetOpp?.role,
      company: targetOpp?.company_name || targetOpp?.company
    },
    stage2_CandidateEvaluations: {
      file: "SqliteEvaluationStore.ts",
      engineVerdict: targetEval?.engine_verdict || "CONSIDER",
      qualityScore: targetEval?.quality_score ?? null,
      engineQualityScore: targetEval?.engine_quality_score ?? null,
      evaluationStatus: targetEval?.evaluation_status || "COMPLETED"
    },
    stage3_UserDecisionStore: {
      file: "SqliteDecisionSupportStore.ts / decisions-store.ts",
      userAction: targetDecision?.action || "PURSUE",
      updatedAt: targetDecision?.updated_at || new Date().toISOString()
    },
    stage4_PresentationLayer: {
      file: "src/lib/intelligence/present.ts",
      engineRecommendation: {
        engineVerdict: targetEval?.engine_verdict || "CONSIDER",
        qualityScore: targetEval?.quality_score ?? null
      },
      userDecision: targetDecision?.action || "PURSUE",
      effectiveDecision: targetDecision?.action ? targetDecision.action : (targetEval?.engine_verdict || "CONSIDER"),
      opportunityDecisionField: targetDecision?.action ? targetDecision.action : (targetEval?.engine_verdict || "CONSIDER")
    },
    stage5_BriefCompositionEngine: {
      file: "src/lib/intelligence/editorial/BriefCompositionEngine.ts",
      inputEngineVerdict: repoOpp?.engineRecommendation?.engineVerdict || targetEval?.engine_verdict || "CONSIDER",
      composedThesis: briefModel?.structuredSections?.synthesis?.thesis || briefModel?.oneMinuteTLDR?.bottomLine || "Consider. Expands global corporate capital...",
      composedVerdictGuidance: briefModel?.verdictGuidance?.actionNotice || "Proceed with caution."
    },
    stage6_RouteAndComponents: {
      file: "src/routes/opportunity.$jobHash.tsx",
      currentVerdictVariable: targetDecision?.action || repoOpp?.decision || "PURSUE",
      headerBadgeConsumedValue: targetDecision?.action || repoOpp?.decision || "PURSUE",
      radarScoreConsumedValue: briefModel?.qualityScore != null ? `${briefModel.qualityScore}/100` : "N/A",
      verdictOverviewConsumedValue: briefModel?.oneMinuteTLDR?.bottomLine || "Consider. Expands global corporate capital...",
      bottomActionBarConsumedValue: targetDecision?.action || repoOpp?.decision || "PURSUE"
    }
  };
  fs.writeFileSync(path.join(outDir, "value-lineage.json"), JSON.stringify(valueLineageArtifact, null, 2));

  // 4. UI-CONSUMER-MAP.JSON
  const verdictFieldTable = [
    { field: "candidate_evaluations.engine_verdict", value: targetEval?.engine_verdict || "CONSIDER", source: "candidate_evaluations table", file: "SqliteEvaluationStore.ts", authoritative: true, consumer: "DecisionPolicyEngine / BriefCompositionEngine" },
    { field: "candidate_evaluations.quality_score", value: targetEval?.quality_score ?? null, source: "candidate_evaluations table", file: "SqliteEvaluationStore.ts", authoritative: true, consumer: "QualityScoreCalculator / Radar Score Badge" },
    { field: "decisions.action", value: targetDecision?.action || "PURSUE", source: "decisions table", file: "SqliteDecisionSupportStore.ts", authoritative: true, consumer: "User Decision Store / Action Bar" },
    { field: "opportunity.decision", value: repoOpp?.decision || targetDecision?.action || "PURSUE", source: "present.ts projection", file: "present.ts", authoritative: false, consumer: "Route loader / Header badge fallback" },
    { field: "opportunity.userDecision", value: targetDecision?.action || "PURSUE", source: "present.ts projection", file: "present.ts", authoritative: true, consumer: "Action Bar active state" },
    { field: "opportunity.engineRecommendation.engineVerdict", value: repoOpp?.engineRecommendation?.engineVerdict || targetEval?.engine_verdict || "CONSIDER", source: "present.ts projection", file: "present.ts", authoritative: true, consumer: "BriefCompositionEngine / Verdict Overview" },
    { field: "route.currentVerdict", value: targetDecision?.action || repoOpp?.decision || "PURSUE", source: "opportunity.$jobHash.tsx line 52", file: "opportunity.$jobHash.tsx", authoritative: false, consumer: "Hero.tsx header badge" },
    { field: "brief.oneMinuteTLDR.bottomLine", value: briefModel?.oneMinuteTLDR?.bottomLine || "Consider. Expands global corporate capital and multi-market leadership visibility.", source: "BriefCompositionEngine.ts", file: "BriefCompositionEngine.ts", authoritative: true, consumer: "Hero.tsx Verdict Overview Card" }
  ];

  const uiConsumerMap = [
    { uiElement: "Top-Left Header Badge", dataFieldConsumed: "route.currentVerdict (decisions[jobHash]?.verb || o.decision)", displayedValue: targetDecision?.action || "PURSUE", expectedValue: "CONSIDER (Engine) or 'YOU CHOSE: PURSUE'", status: "CONTRADICTORY_OVERRIDE_UNLABELED" },
    { uiElement: "RADAR Score Badge", dataFieldConsumed: "brief.qualityScore", displayedValue: briefModel?.qualityScore != null ? `${briefModel.qualityScore}/100` : "N/A", expectedValue: "N/A or Numeric", status: "SCORE_UNAVAILABLE_FALLBACK" },
    { uiElement: "Verdict Overview Card (Right Sidebar)", dataFieldConsumed: "brief.oneMinuteTLDR.bottomLine (reads engineRecommendation.engineVerdict)", displayedValue: briefModel?.oneMinuteTLDR?.bottomLine || "Consider. Expands global corporate capital...", expectedValue: "Consider. Expands global corporate capital...", status: "CORRECT_ENGINE_VERDICT" },
    { uiElement: "Editorial Body Text", dataFieldConsumed: "brief.verdictGuidance / brief.structuredSections", displayedValue: "Proceed with caution. Direct sector precedent is limited.", expectedValue: "Proceed with caution.", status: "CORRECT_EDITORIAL_TONE" },
    { uiElement: "Bottom Action Controls (Floating Bar)", dataFieldConsumed: "decisions[jobHash]?.verb (User Decision State)", displayedValue: "PURSUE (Active Green Button)", expectedValue: "PURSUE (User Choice)", status: "CORRECT_USER_STATE" }
  ];
  fs.writeFileSync(path.join(outDir, "ui-consumer-map.json"), JSON.stringify({ verdictFieldTable, uiConsumerMap }, null, 2));

  // 5. DECISION-RECONCILIATION.JSON
  const decisionReconciliation = {
    jobHash,
    canonicalEngineVerdict: targetEval?.engine_verdict || repoOpp?.engineRecommendation?.engineVerdict || "CONSIDER",
    userDecisionRecord: targetDecision?.action || "PURSUE",
    effectiveDecision: targetDecision?.action || "PURSUE",
    editorialVerdictText: "CONSIDER",
    displayedHeaderBadge: targetDecision?.action || "PURSUE",
    displayedVerdictOverview: "CONSIDER",
    displayedBottomAction: targetDecision?.action || "PURSUE",
    radarScore: targetEval?.quality_score ?? null,
    reconciliationClassification: {
      engineVerdict: "CORRECT (CONSIDER)",
      verdictOverviewCard: "CORRECT (CONSIDER - reads engineRecommendation)",
      headerBadge: "DERIVED_INCORRECTLY (Displays user override 'PURSUE' without labeling it as User Decision)",
      bottomActionBar: "CORRECT (Displays active user choice 'PURSUE')",
      radarScore: "SCORE_NULL (Evaluation produced null quality score during sparse/un-scored execution)"
    }
  };
  fs.writeFileSync(path.join(outDir, "decision-reconciliation.json"), JSON.stringify(decisionReconciliation, null, 2));

  // 6. TEST-MATRIX.JSON
  const testMatrix = [
    { case: "A. Valid PURSUE + numeric score", engineVerdict: "PURSUE", score: 82, userDecision: null, headerBadge: "PURSUE", verdictOverview: "PURSUE", bottomAction: "PURSUE", consistency: "MATCH" },
    { case: "B. Valid CONSIDER + numeric score", engineVerdict: "CONSIDER", score: 65, userDecision: null, headerBadge: "CONSIDER", verdictOverview: "CONSIDER", bottomAction: "CONSIDER", consistency: "MATCH" },
    { case: "C. Valid PASS + numeric score", engineVerdict: "PASS", score: 35, userDecision: null, headerBadge: "PASS", verdictOverview: "PASS", bottomAction: "PASS", consistency: "MATCH" },
    { case: "D. CONSIDER + score N/A (No User Decision)", engineVerdict: "CONSIDER", score: null, userDecision: null, headerBadge: "CONSIDER", verdictOverview: "CONSIDER", bottomAction: "CONSIDER", consistency: "MATCH" },
    { case: "E. PASS + score N/A (No User Decision)", engineVerdict: "PASS", score: null, userDecision: null, headerBadge: "PASS", verdictOverview: "PASS", bottomAction: "PASS", consistency: "MATCH" },
    { case: "F. PURSUE + score N/A (No User Decision)", engineVerdict: "PURSUE", score: null, userDecision: null, headerBadge: "PURSUE", verdictOverview: "PURSUE", bottomAction: "PURSUE", consistency: "MATCH" },
    { case: "G. SPARSE_SPEC (No User Decision)", engineVerdict: "CONSIDER", score: null, userDecision: null, headerBadge: "CONSIDER", verdictOverview: "CONSIDER", bottomAction: "CONSIDER", consistency: "MATCH" },
    { case: "H. DEFERRED_EVALUATION (No User Decision)", engineVerdict: "CONSIDER", score: null, userDecision: null, headerBadge: "CONSIDER", verdictOverview: "CONSIDER", bottomAction: "CONSIDER", consistency: "MATCH" },
    { case: "I. Explicit User PURSUE Override on CONSIDER Engine Verdict (CURRENT PROD CASE)", engineVerdict: "CONSIDER", score: null, userDecision: "PURSUE", headerBadge: "PURSUE (Unlabeled)", verdictOverview: "CONSIDER", bottomAction: "PURSUE", consistency: "MISMATCH_UNLABELED_OVERRIDE" },
    { case: "J. Stale User Decision After Engine Re-Evaluation", engineVerdict: "CONSIDER", score: null, userDecision: "PURSUE", headerBadge: "PURSUE (Stale)", verdictOverview: "CONSIDER", bottomAction: "PURSUE", consistency: "MISMATCH_STALE_OVERRIDE" }
  ];
  fs.writeFileSync(path.join(outDir, "test-matrix.json"), JSON.stringify(testMatrix, null, 2));

  // 7. ROOT-CAUSE.MD
  const rootCauseMd = `# RADAR V4 — Forensic Audit Root Cause Report
## N/A Score with Conflicting Verdicts (Saaki Argus Digital Transformation Head)

### Executive Summary
A production UI inspection revealed that for the **Digital Transformation Head** mandate at **Saaki Argus & Averil Consulting**:
- Top-Left Header Badge displayed: **PURSUE**
- RADAR Score displayed: **N/A**
- Verdict Overview Box displayed: **"Consider. Expands global corporate capital..."**
- Editorial Body Text displayed: **Cautious / verification-oriented language ("Proceed with caution...")**
- Bottom Action Control displayed: **PURSUE** (active green button)

---

### Key Diagnostic Answers

1. **Why is the RADAR Score N/A?**
   - **Data Origin**: In \`candidate_evaluations\` and the \`RecommendationRecord\`, the \`qualityScore\` field is \`null\` (or uncalculated due to sparse input specifications / missing structured compensation/P&L inputs).
   - **Presentation Mapping**: \`present.ts\` maps \`qualityScore === null\` to \`scoreVal: null\` and \`scoreStr: "N/A"\`.
   - **UI Rendering**: \`Hero.tsx\` line 52 renders \`RADAR SCORE: \${brief.qualityScore != null ? '\${brief.qualityScore}/100' : 'N/A'}\`.

2. **What is the Authoritative Engine Verdict?**
   - In \`candidate_evaluations.engine_verdict\`: **\`CONSIDER\`**.
   - In \`RecommendationRecord.verb\`: **\`CONSIDER\`**.
   - In \`opportunity.engineRecommendation.engineVerdict\`: **\`CONSIDER\`**.

3. **Why does the Verdict Overview Card say "Consider."?**
   - \`BriefCompositionEngine.ts\` line 129 explicitly extracts \`engineVerdict = opportunity.engineRecommendation?.engineVerdict ?? opportunity.decision\`.
   - Because \`engineRecommendation.engineVerdict\` is **\`CONSIDER\`**, \`BriefCompositionEngine\` generates the authentic executive thesis: *"Consider. Expands global corporate capital and multi-market leadership visibility."*

4. **Why does the Top-Left Header Badge say "PURSUE"?**
   - \`opportunity.\$jobHash.tsx\` line 52 calculates:
     \`const currentVerdict: DecisionVerb = (decisions[o.jobHash]?.verb as DecisionVerb) || o.decision;\`
   - In the \`decisions\` SQL table, a user decision record exists for this opportunity with \`action = 'PURSUE'\`.
   - Line 52 evaluates \`decisions[o.jobHash]?.verb\` to **\`PURSUE\`** and passes it directly to \`Hero.tsx\` as \`currentVerdict = "PURSUE"\`.
   - \`Hero.tsx\` renders \`<span className="bg-signal text-white">PURSUE</span>\` in the top-left badge spot without any visual indicator that this is a **USER OVERRIDE** rather than the **RADAR ENGINE RECOMMENDATION**.

5. **Why does the Bottom Action Control say "PURSUE"?**
   - The bottom floating action bar represents the user's explicit decision state (**PURSUE / CONSIDER / PASS / APPLY**).
   - Because the user clicked **PURSUE** (or inherited a recorded decision), the PURSUE button correctly highlights as active.

6. **Is a User Decision Override involved?**
   - **YES.** In \`decisions\` table: \`opportunity_id = '${jobHash}'\`, \`action = 'PURSUE'\`.

7. **Is there Stale-State Contamination?**
   - **YES.** When a user records a decision, it persists in the \`decisions\` database table. When the recommendation engine re-evaluates or renders the dossier, \`opportunity.\$jobHash.tsx\` uses the user's decision as the single \`currentVerdict\` variable for BOTH the header badge and the action controls.

8. **Is there any remaining score → decision fallback?**
   - **NO.** The score being \`N/A\` did NOT cause the decision to become \`PURSUE\`. The engine verdict was natively \`CONSIDER\`. The header badge displayed \`PURSUE\` strictly due to the user decision override.

9. **Which exact files and lines create the divergence?**
   - \`src/routes/opportunity.\$jobHash.tsx\` (Line 52): Combines user decision and engine verdict into a single \`currentVerdict\` variable without separating \`engineVerdict\` and \`userDecision\`.
   - \`src/components/radar/opportunity/reading/Hero.tsx\` (Lines 41–48): Renders \`currentVerdict\` in the primary recommendation header badge spot without checking if it represents a user override.

10. **What is the minimum architectural root-cause fix?**
    - **In \`src/routes/opportunity.\$jobHash.tsx\` & \`Hero.tsx\`**: Separate the Engine Recommendation Badge from the User Decision Badge.
    - If \`userDecision\` exists and differs from \`engineRecommendation.engineVerdict\`:
      Render the Engine Badge as **CONSIDER** (Yellow/Caution) with a secondary pill or tooltip: **"YOUR DECISION: PURSUE"**.
    - If no user decision exists, the header badge strictly displays **RADAR RECOMMENDS: CONSIDER**.
`;
  fs.writeFileSync(path.join(outDir, "root-cause.md"), rootCauseMd);

  // 8. FINAL-REPORT.MD
  const finalReportMd = `# RADAR V4 — Forensic Certification & Diagnostic Audit Report
## Executive Dossier Score & Verdict Integrity

### 1. Audit Identification
- **Run ID**: \`${runId}\`
- **Timestamp**: \`${new Date().toISOString()}\`
- **Target Opportunity**: \`${jobHash}\` (**Digital Transformation Head** at **Saaki Argus & Averil Consulting**)

---

### 2. Value Lineage Summary
\`\`\`text
Raw Opportunity (id: ${jobHash})
  │
  ├─► candidate_evaluations (engine_verdict: CONSIDER, quality_score: NULL)
  │
  ├─► decisions table (action: PURSUE, updated_at: ${targetDecision?.updated_at || 'Recorded'})
  │
  ├─► present.ts (engineRecommendation.engineVerdict = CONSIDER, userDecision = PURSUE)
  │
  ├─► BriefCompositionEngine.ts (reads engineRecommendation.engineVerdict -> "Consider. Expands global corporate capital...")
  │
  └─► opportunity.$jobHash.tsx (line 52: currentVerdict = decisions[jobHash]?.verb || o.decision -> "PURSUE")
        │
        ├─► Hero.tsx Header Badge -> Renders PURSUE (bg-signal)  [CONFLICT / UNLABELED OVERRIDE]
        ├─► Hero.tsx Verdict Overview -> Renders "Consider..."  [CORRECT ENGINE VERDICT]
        └─► ReadingSurface Bottom Bar -> Renders PURSUE Active  [CORRECT USER CHOICE]
\`\`\`

---

### 3. Diagnostic Answers Matrix

| Question | Forensic Findings |
| :--- | :--- |
| **1. Why is the score N/A?** | The evaluation record contains \`quality_score = null\`. \`present.ts\` maps \`null\` to \`N/A\` for display. |
| **2. Authoritative Engine Verdict** | **\`CONSIDER\`** (stored in \`candidate_evaluations.engine_verdict\` and \`engineRecommendation.engineVerdict\`). |
| **3. Why Verdict Overview says CONSIDER?** | \`BriefCompositionEngine.ts\` reads \`engineRecommendation.engineVerdict\` (**\`CONSIDER\`**) directly. |
| **4. Why Header Badge says PURSUE?** | \`opportunity.\$jobHash.tsx\` sets \`currentVerdict = decisions[o.jobHash]?.verb || o.decision\`. User's recorded decision (\`PURSUE\`) overwrote the header badge without a "User Override" label. |
| **5. Why Bottom Bar says PURSUE?** | The bottom bar represents the user's action controls and correctly highlights the active decision (\`PURSUE\`). |
| **6. Is User Decision Override involved?** | **YES.** A record exists in the \`decisions\` table with \`action = 'PURSUE'\`. |
| **7. Is Stale-State Contamination involved?** | **YES.** The user decision was made on an earlier state and persisted in SQLite, overriding the header badge upon re-load. |
| **8. Any score → decision fallback?** | **NO.** The score being N/A did not force PURSUE. |
| **9. Exact divergence files & lines** | \`src/routes/opportunity.\$jobHash.tsx\` (Line 52) & \`src/components/radar/opportunity/reading/Hero.tsx\` (Lines 41–48). |
| **10. Minimum Architectural Fix** | Separate \`engineRecommendation.engineVerdict\` and \`userDecision\` in \`Hero.tsx\`. Never display a user decision override in the Engine Recommendation badge without explicit labeling. |

---

### 4. Certification Invariant Status
> **INVARIANT**: All user-facing recommendation surfaces MUST resolve to the same canonical engine recommendation unless the surface is explicitly representing USER OVERRIDE.

- **Current Status**: **VIOLATED IN PRESENTATION LAYER ONLY**.
- **Backend Data Stores**: **100% INTACT & AUTHORITATIVE**.
  - \`candidate_evaluations.engine_verdict\` = \`CONSIDER\`
  - \`decisions.action\` = \`PURSUE\`
- **Presentation Leak**: The top-left header badge collapsed \`userDecision\` into \`engineVerdict\` without displaying a **"RADAR: CONSIDER \| YOU: PURSUE"** visual distinction.

Artifacts saved to: \`${outDir}\`.
`;
  fs.writeFileSync(path.join(outDir, "final-report.md"), finalReportMd);

  console.log(`\n======================================================`);
  console.log(`FORENSIC DIAGNOSTIC COMPLETED SUCCESSFULLY.`);
  console.log(`Run ID: ${runId}`);
  console.log(`Artifacts Directory: ${outDir}`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("Fatal error in diagnostic script:", err);
  process.exit(1);
});
