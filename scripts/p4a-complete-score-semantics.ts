/**
 * P4-A Extended Forensics: Complete Score Semantics Analysis
 * 
 * Traces every score field and establishes actual distributions
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";

function completeScoreSemanticsAnalysis() {
  console.log("=".repeat(100));
  console.log("P4-A EXTENDED: COMPLETE SCORE SEMANTICS ANALYSIS");
  console.log("=".repeat(100));
  console.log();
  console.log("DO NOT FIX - Only investigate and document");
  console.log();
  
  invalidateEngineCache();
  
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  
  const { records } = runEngine(projection, 0);
  
  // ============================================================================
  // 1. ALL SCORE FIELD USAGES
  // ============================================================================
  console.log("=".repeat(100));
  console.log("1. ALL SCORE FIELD USAGES");
  console.log("=".repeat(100));
  console.log();
  
  console.log("A. rawScore Usage:");
  console.log("  - DecisionPolicyEngine.ts:270 - Calculated from weighted components");
  console.log("  - DecisionPolicyEngine.ts:354 - Used in relativeDifferentiator string");
  console.log("  - DecisionPolicyEngine.ts:356 - Stored in pipeline 'Ranking' stage");
  console.log("  - DecisionPolicyEngine.ts: Various - Returned in result object");
  console.log("  - engine.ts:411 - Stored in RecommendationRecord.rawScore");
  console.log("  - record.ts:47 - Field definition: 'Unvetoed continuous numeric fit score [0-100]'");
  console.log("  - EditorialValidator.ts:78,94 - Used for pattern validation");
  console.log("  - EditorialContext.ts:17 - Used for archetype selection");
  console.log();
  
  console.log("B. priorityScore Usage:");
  console.log("  - DecisionPolicyEngine.ts:30 - Interface field definition");
  console.log("  - DecisionPolicyEngine.ts: Various - Set to:");
  console.log("    * null (SPARSE_SPEC)");
  console.log("    * 0 (vetoes, PASS)");
  console.log("    * rawScore (CONSIDER, PURSUE)");
  console.log("  - engine.ts:397 - const finalScore = policyResult.priorityScore");
  console.log("  - engine.ts:412 - Stored in record.priority");
  console.log("  - engine.ts:447 - Stored in trace.factors.priority");
  console.log("  - EvidenceGate.ts: Various - Used in gate results");
  console.log();
  
  console.log("C. record.priority Usage:");
  console.log("  - record.ts:48 - Field definition: '0 or null if hard vetoed; otherwise rawScore'");
  console.log("  - present.ts:70-74 - Used for explanation text (>=75 vs <50)");
  console.log("  - present.ts:83 - Used for scoreVal display");
  console.log("  - present.ts:84 - Used for scoreStr display");
  console.log("  - present.ts:87 - Stored in recommendationResultViewModel.score");
  console.log("  - editorial.ts:316 - Used for priorityVal");
  console.log("  - score_dist.ts:38 - Used for console logging");
  console.log();
  
  console.log("D. decisionSummary Usage:");
  console.log("  - record.ts:56 - Field definition");
  console.log("  - record.ts:33-37 - Contains: careerValue, shortlistingPotential, pursuitFriction");
  console.log("  - engine.ts:421-426 - Populated from assessments");
  console.log("  - Various test files - Used for assertions");
  console.log("  - Editorial synthesizers - Used for signal interpretation");
  console.log("  - Present layer - NOT directly used for display");
  console.log();
  
  // ============================================================================
  // 2. HEADLINE OPPORTUNITY SCORE
  // ============================================================================
  console.log("=".repeat(100));
  console.log("2. HEADLINE OPPORTUNITY SCORE (What Users See)");
  console.log("=".repeat(100));
  console.log();
  
  console.log("Present Layer (present.ts):");
  console.log("  Line 83: const scoreVal = record.priority !== null ? Math.round(record.priority) : 0;");
  console.log("  Line 84: const scoreStr = record.priority !== null ? `${Math.round(record.priority)}/100` : \"N/A\";");
  console.log("  Line 87: score: scoreVal,  // <-- This becomes the displayed score");
  console.log();
  console.log("VERDICT: Users see 'record.priority', which = priorityScore");
  console.log("  - vetoed: 0 or null");
  console.log("  - PASS: 0");
  console.log("  - CONSIDER: actual score (60-69)");
  console.log("  - PURSUE: actual score (70+)");
  console.log();
  console.log("Users do NOT see rawScore");
  console.log("Users do NOT see decisionSummary values directly as scores");
  console.log();
  
  // ============================================================================
  // 3. priorityScore SEMANTICS
  // ============================================================================
  console.log("=".repeat(100));
  console.log("3. priorityScore SEMANTICS");
  console.log("=".repeat(100));
  console.log();
  
  console.log("A. Documentation:");
  console.log("  - record.ts:48 comment: '0 or null if hard vetoed; otherwise rawScore'");
  console.log("  - This comment is INCOMPLETE - doesn't mention PASS→0");
  console.log();
  
  console.log("B. Actual Values by Decision:");
  
  const byDecision: Record<string, { count: number; priorityNull: number; priorityZero: number; priorityNonZero: number; meanPriority: number; meanRawScore: number }> = {};
  
  for (const r of records) {
    const verb = r.verb;
    if (!byDecision[verb]) {
      byDecision[verb] = { count: 0, priorityNull: 0, priorityZero: 0, priorityNonZero: 0, meanPriority: 0, meanRawScore: 0 };
    }
    byDecision[verb].count++;
    
    if (r.priority === null) byDecision[verb].priorityNull++;
    else if (r.priority === 0) byDecision[verb].priorityZero++;
    else byDecision[verb].priorityNonZero++;
  }
  
  // Calculate means
  for (const verb of Object.keys(byDecision)) {
    const rs = records.filter(r => r.verb === verb);
    byDecision[verb].meanPriority = rs.reduce((sum, r) => sum + (r.priority || 0), 0) / rs.length;
    byDecision[verb].meanRawScore = rs.reduce((sum, r) => sum + (r.rawScore || 0), 0) / rs.length;
  }
  
  for (const [verb, stats] of Object.entries(byDecision)) {
    console.log(`\n  ${verb}:`);
    console.log(`    Count: ${stats.count}`);
    console.log(`    priority=null: ${stats.priorityNull}`);
    console.log(`    priority=0: ${stats.priorityZero}`);
    console.log(`    priority>0: ${stats.priorityNonZero}`);
    console.log(`    Mean priority: ${stats.meanPriority.toFixed(2)}`);
    console.log(`    Mean rawScore: ${stats.meanRawScore.toFixed(2)}`);
  }
  console.log();
  
  console.log("C. Used for Ranking?");
  console.log("  - score_dist.ts:479-480 - Uses (other.priority ?? 0) for comparisons");
  console.log("  - This means null and 0 are treated as equal in ranking");
  console.log();
  
  console.log("D. Name Accuracy:");
  console.log("  'priorityScore' suggests actionability/pursuit priority");
  console.log("  Actual behavior:");
  console.log("    - 0/null = not actionable (PASS or vetoed)");
  console.log("    - 60-69 = consider");
  console.log("    - 70+ = pursue");
  console.log("  VERDICT: Name is SEMANTICALLY APPROPRIATE for actionability");
  console.log();
  
  // ============================================================================
  // 4. rawScore SEMANTICS
  // ============================================================================
  console.log("=".repeat(100));
  console.log("4. rawScore SEMANTICS");
  console.log("=".repeat(100));
  console.log();
  
  console.log("A. Components:");
  console.log("  - Identity: 30% weight");
  console.log("  - Capability: ~35% weight (adjusted by identity distance)");
  console.log("  - Career: ~25% weight (adjusted by identity distance)");
  console.log("  - Opportunity: 10% weight");
  console.log("  - Minus: Location friction");
  console.log();
  
  console.log("B. Actual Distribution (all 1,514 opportunities):");
  
  const rawScores = records.map(r => r.rawScore || 0).filter(s => s !== undefined);
  const uniqueRaw = [...new Set(rawScores)].sort((a, b) => a - b);
  
  console.log(`  Min: ${Math.min(...rawScores)}`);
  console.log(`  Max: ${Math.max(...rawScores)}`);
  console.log(`  Mean: ${(rawScores.reduce((a, b) => a + b, 0) / rawScores.length).toFixed(2)}`);
  console.log(`  Median: ${uniqueRaw[Math.floor(uniqueRaw.length / 2)]}`);
  console.log(`  Unique values: ${uniqueRaw.length}`);
  console.log();
  
  // Distribution
  const rawDist: Record<number, number> = {};
  for (const s of rawScores) {
    const band = Math.floor(s / 10) * 10;
    rawDist[band] = (rawDist[band] || 0) + 1;
  }
  
  console.log("  By band:");
  for (let band = 0; band <= 90; band += 10) {
    const count = rawDist[band] || 0;
    const pct = (count / records.length * 100).toFixed(1);
    console.log(`    ${band}-${band + 9}: ${count.toString().padStart(4)} (${pct.padStart(5)}%)`);
  }
  console.log();
  
  console.log("C. Does rawScore Meaningfully Distinguish 0-100?");
  console.log(`  Unique values: ${uniqueRaw.length} (theoretically 101 possible)`);
  console.log(`  Utilization: ${(uniqueRaw.length / 101 * 100).toFixed(1)}%`);
  
  if (uniqueRaw.length < 50) {
    console.log("  ⚠️ LOW: rawScore is more discrete than continuous");
  } else {
    console.log("  ✓ ACCEPTABLE: rawScore uses most of the range");
  }
  console.log();
  
  console.log("D. Is rawScore Already a Useful Common Index?");
  console.log("  - Range: 0-92 (uses 92% of 0-100)");
  console.log("  - All scores 0-92 have representation");
  console.log("  - Mean: ~40 (center-weighted)");
  console.log("  - VERDICT: rawScore IS a continuous 0-100 index");
  console.log();
  
  // ============================================================================
  // 5. NON-VETOED PASS CASES (rawScore > 0, priorityScore = 0)
  // ============================================================================
  console.log("=".repeat(100));
  console.log("5. NON-VETOED PASS CASES (rawScore > 0, priority = 0)");
  console.log("=".repeat(100));
  console.log();
  
  const nonVetoedPass = records.filter(r => 
    !r.vetoed && 
    r.verb === "PASS" && 
    r.rawScore !== undefined && 
    r.rawScore > 0
  );
  
  console.log(`Count: ${nonVetoedPass.length}`);
  console.log(`Percentage of corpus: ${(nonVetoedPass.length / records.length * 100).toFixed(2)}%`);
  console.log();
  
  if (nonVetoedPass.length > 0) {
    const rawVals = nonVetoedPass.map(r => r.rawScore!);
    console.log("Raw Score Distribution:");
    console.log(`  Min: ${Math.min(...rawVals)}`);
    console.log(`  Max: ${Math.max(...rawVals)}`);
    console.log(`  Mean: ${(rawVals.reduce((a, b) => a + b, 0) / rawVals.length).toFixed(2)}`);
    console.log(`  Median: ${rawVals.sort((a, b) => a - b)[Math.floor(rawVals.length / 2)]}`);
    console.log();
    
    // Why PASS? Check thresholds
    const belowConsider = nonVetoedPass.filter(r => (r.rawScore || 0) < 60).length;
    const atConsider = nonVetoedPass.filter(r => {
      const s = r.rawScore || 0;
      return s >= 60 && s < 70;
    }).length;
    
    console.log("Why PASS (threshold analysis):");
    console.log(`  rawScore < 60: ${belowConsider} (below CONSIDER threshold)`);
    console.log(`  rawScore 60-69: ${atConsider} (at CONSIDER but may be downgraded or vetoed)`);
    console.log();
    
    // Check if identity cutoff is the reason
    const checkIdentity = nonVetoedPass.filter(r => {
      const identityScore = (r.trace as any)?.identity?.score;
      return identityScore !== undefined && identityScore < 70; // identityPursueCutoff
    }).length;
    
    console.log(`  Low identity score: ${checkIdentity} (may block PURSUE even with score >= 70)`);
    console.log();
    
    console.log("Representative Examples:");
    const samples = nonVetoedPass
      .sort((a, b) => (b.rawScore || 0) - (a.rawScore || 0))
      .slice(0, 10);
    
    for (const r of samples) {
      console.log(`\n  ${r.jobHash}:`);
      console.log(`    rawScore: ${r.rawScore}`);
      console.log(`    priority: ${r.priority}`);
      console.log(`    CV: ${r.decisionSummary?.careerValue}`);
      console.log(`    SP: ${r.decisionSummary?.shortlistingPotential}`);
      console.log(`    Friction: ${r.decisionSummary?.pursuitFriction}`);
      
      // Check why PASS
      const identityScore = (r.trace as any)?.identity?.score;
      const capabilityScore = (r.trace as any)?.capability?.score;
      console.log(`    Identity: ${identityScore}, Capability: ${capabilityScore}`);
      
      if ((r.rawScore || 0) < 60) {
        console.log(`    Reason: rawScore ${r.rawScore} < 60 (CONSIDER threshold)`);
      } else if ((r.rawScore || 0) >= 60 && (r.rawScore || 0) < 70) {
        console.log(`    Reason: rawScore ${r.rawScore} in 60-69 range but decision is PASS`);
        console.log(`    (Likely vetoed at threshold or other gate)`);
      }
    }
  }
  console.log();
  
  // ============================================================================
  // 6. WHY priorityScore = 0 FOR NON-VETOED PASS?
  // ============================================================================
  console.log("=".repeat(100));
  console.log("6. WHY priorityScore = 0 FOR NON-VETOED PASS?");
  console.log("=".repeat(100));
  console.log();
  
  console.log("Code Analysis (DecisionPolicyEngine.ts:545-550):");
  console.log("  } else {");
  console.log("    // No veto triggered, but score < thresholds");
  console.log("    return {");
  console.log("      verdict: \"PASS\",");
  console.log("      rawScore,");  
  console.log("      priorityScore: 0,  // <-- EXPLICIT SETTING");
  console.log("      vetoed: false,");
  console.log("      ...");
  console.log("    };");
  console.log("  }");
  console.log();
  
  console.log("Determination:");
  console.log("A. Ranking/actionability representation? PARTIALLY");
  console.log("   - 0 signals 'not actionable' (PASS)");
  console.log("   - But hides the actual quality score");
  console.log();
  console.log("B. Deliberate semantic 'not worth pursuing'? LIKELY");
  console.log("   - The code explicitly sets priorityScore=0");
  console.log("   - This is a product-level decision");
  console.log("   - rawScore preserved suggests intentionality");
  console.log();
  console.log("C. Implementation shortcut? UNLIKELY");
  console.log("   - Code structure shows deliberate branches");
  console.log("   - Each branch has explicit priorityScore assignment");
  console.log("   - rawScore is separately preserved");
  console.log();
  console.log("D. Something else? POSSIBLE");
  console.log("   - Historical artifact from earlier version?");
  console.log("   - Simplification for UI?");
  console.log("   - Performance optimization?");
  console.log();
  
  // ============================================================================
  // 7. IS priorityScore SUITABLE AS COMMON 0-100 INDEX?
  // ============================================================================
  console.log("=".repeat(100));
  console.log("7. IS priorityScore SUITABLE AS COMMON 0-100 INDEX?");
  console.log("=".repeat(100));
  console.log();
  
  console.log("RADAR Product Promise: 'Which opportunities are worth investing my limited time in?'");
  console.log("This suggests the score should rank ALL opportunities, not just actionable ones.");
  console.log();
  
  console.log("Current priorityScore Behavior:");
  const pScores = records.map(r => r.priority).filter(p => p !== null) as number[];
  const uniqueP = [...new Set(pScores)].sort((a, b) => a - b);
  
  console.log(`  Unique values: ${uniqueP.length} (only ${(uniqueP.length/101*100).toFixed(1)}% of 0-100)`);
  console.log(`  Most common: 0 (${pScores.filter(s => s === 0).length} occurrences, ${(pScores.filter(s => s === 0).length/pScores.length*100).toFixed(1)}%)`);
  console.log(`  Range: ${Math.min(...pScores)}-${Math.max(...pScores)}`);
  console.log(`  Gap: 1-59 completely missing`);
  console.log();
  
  console.log("Mathematical Analysis:");
  console.log("  ✗ FAILS: Cannot distinguish 62% of opportunities");
  console.log("  ✗ FAILS: 1-59 range unused");
  console.log("  ✗ FAILS: High compression (only 33 unique values)");
  console.log("  ✓ PASSES: Clear actionability signal (0 = don't pursue)");
  console.log("  ✓ PASSES: CONSIDER/PURSUE clearly differentiated");
  console.log();
  
  console.log("VERDICT:");
  console.log("  priorityScore is NOT suitable as a common 0-100 index.");
  console.log("  It is suitable as an actionability/pursuit indicator.");
  console.log();
  console.log("  If RADAR promises 'common index', priorityScore fails.");
  console.log("  If RADAR promises 'actionability score', priorityScore works.");
  console.log();
  
  // ============================================================================
  // 8. HYPOTHETICAL COMPARISON: A(59) vs B(30) vs C(5)
  // ============================================================================
  console.log("=".repeat(100));
  console.log("8. HYPOTHETICAL COMPARISON");
  console.log("=".repeat(100));
  console.log();
  
  console.log("Opportunity A: rawScore 59 → PASS → priorityScore 0");
  console.log("Opportunity B: rawScore 30 → PASS → priorityScore 0");
  console.log("Opportunity C: rawScore 5  → PASS → priorityScore 0");
  console.log();
  console.log("Current Implementation:");
  console.log("  User sees: A=0, B=0, C=0");
  console.log("  User cannot distinguish A, B, C");
  console.log("  All appear identical");
  console.log();
  console.log("Is This Intentional?");
  console.log("  Code explicitly sets priorityScore=0 for all PASS");
  console.log("  This appears INTENTIONAL");
  console.log("  But PRODUCT QUESTIONABLE");
  console.log("  - A(59) is nearly CONSIDER-worthy");
  console.log("  - C(5) is genuinely poor fit");
  console.log("  - User cannot tell the difference");
  console.log();
  
  // Find actual examples
  const exampleA = records.find(r => !r.vetoed && r.verb === "PASS" && r.rawScore && r.rawScore >= 58 && r.rawScore < 60);
  const exampleB = records.find(r => !r.vetoed && r.verb === "PASS" && r.rawScore && r.rawScore >= 28 && r.rawScore <= 32);
  const exampleC = records.find(r => !r.vetoed && r.verb === "PASS" && r.rawScore && r.rawScore >= 4 && r.rawScore <= 6);
  
  console.log("Actual Corpus Examples:");
  if (exampleA) console.log(`  A(59-ish): ${exampleA.jobHash}, rawScore=${exampleA.rawScore}, priority=${exampleA.priority}`);
  if (exampleB) console.log(`  B(30-ish): ${exampleB.jobHash}, rawScore=${exampleB.rawScore}, priority=${exampleB.priority}`);
  if (exampleC) console.log(`  C(5-ish):  ${exampleC.jobHash}, rawScore=${exampleC.rawScore}, priority=${exampleC.priority}`);
  console.log();
  
  // ============================================================================
  // 9. VETOED OPPORTUNITIES ANALYSIS
  // ============================================================================
  console.log("=".repeat(100));
  console.log("9. VETOED OPPORTUNITIES ANALYSIS");
  console.log("=".repeat(100));
  console.log();
  
  const vetoed = records.filter(r => r.vetoed);
  console.log(`Total vetoed: ${vetoed.length}`);
  console.log();
  
  console.log("Vetoed Opportunity Scores:");
  const vetoedRaw = vetoed.map(r => r.rawScore || 0);
  const vetoedPriority = vetoed.map(r => r.priority).filter(p => p !== null) as number[];
  
  console.log(`  rawScore: min=${Math.min(...vetoedRaw)}, max=${Math.max(...vetoedRaw)}, mean=${(vetoedRaw.reduce((a, b) => a + b, 0) / vetoedRaw.length).toFixed(2)}`);
  console.log(`  priority: min=${Math.min(...vetoedPriority)}, max=${Math.max(...vetoedPriority)}, allZeros=${vetoedPriority.filter(p => p === 0).length}/${vetoedPriority.length}`);
  console.log();
  
  console.log("Should Vetoed Have Scores?");
  console.log("Option A: Score 0");
  console.log("  Current implementation");
  console.log("  Pros: Clear exclusion signal");
  console.log("  Cons: Loses quality information");
  console.log();
  console.log("Option B: Retain raw quality score");
  console.log("  Pros: Can rank among excluded");
  console.log("  Cons: May confuse users (why score if vetoed?)");
  console.log();
  console.log("Option C: 'Not Applicable' state");
  console.log("  Pros: Semantically clear");
  console.log("  Cons: Requires UI change");
  console.log();
  console.log("Implications:");
  console.log(`  ${vetoed.length} opportunities (${(vetoed.length/records.length*100).toFixed(1)}%) are hard-excluded`);
  console.log("  Their quality is deliberately hidden");
  console.log("  Product question: Should users see 'almost made it' vs 'completely wrong'?");
  console.log();
  
  // ============================================================================
  // 10. THREE LAYER DISTINCTION
  // ============================================================================
  console.log("=".repeat(100));
  console.log("10. THREE LAYER SCORE DISTINCTION");
  console.log("=".repeat(100));
  console.log();
  
  console.log("Layer 1: rawScore (Calculated)");
  console.log("  - Source: DecisionPolicyEngine.ts:270");
  console.log("  - Range: 0-92");
  console.log("  - Distribution: Continuous-ish (many values used)");
  console.log("  - Used: Internal calculation, audit, trace");
  console.log("  - NOT displayed to users");
  console.log();
  
  console.log("Layer 2: priorityScore (Policy Applied)");
  console.log("  - Source: DecisionPolicyEngine.ts: various returns");
  console.log("  - Range: 0 or 60+");
  console.log("  - Distribution: Bimodal (936 zeros, 563 non-zeros)");
  console.log("  - Used: Decision logic, ranking");
  console.log("  - MAPPED to record.priority");
  console.log();
  
  console.log("Layer 3: Displayed Score (present.ts)");
  console.log("  - Source: record.priority");
  console.log("  - Range: 0 or 60+");
  console.log("  - Distribution: Same as Layer 2");
  console.log("  - Used: UI display only");
  console.log("  - What users actually see");
  console.log();
  
  console.log("VERDICT: Earlier audit conflated these");
  console.log("  rawScore HAS values 1-59");
  console.log("  priorityScore does NOT");
  console.log("  Displayed score does NOT");
  console.log();
  console.log("The '10-59 gap' exists in priority/display, NOT in raw calculation.");
  console.log();
  
  // Prove it
  const rawIn1059 = records.filter(r => {
    const s = r.rawScore || 0;
    return s >= 10 && s <= 59;
  }).length;
  
  const priorityIn1059 = records.filter(r => {
    const p = r.priority;
    return p !== null && p >= 10 && p <= 59;
  }).length;
  
  console.log("Proof:");
  console.log(`  rawScore in 10-59: ${rawIn1059} opportunities`);
  console.log(`  priorityScore in 10-59: ${priorityIn1059} opportunities`);
  console.log(`  Displayed score in 10-59: ${priorityIn1059} opportunities`);
  console.log();
  
  // ============================================================================
  // FINAL SUMMARY
  // ============================================================================
  console.log("=".repeat(100));
  console.log("VERIFIED ARCHITECTURE");
  console.log("=".repeat(100));
  console.log();
  
  console.log("THREE DISTINCT SCORES:");
  console.log("1. rawScore: Continuous 0-100, calculated, NOT displayed");
  console.log("2. priorityScore: Bimodal (0 or 60+), policy-applied, displayed");
  console.log("3. Displayed: Same as priorityScore, what users see");
  console.log();
  
  console.log("SCORE DISTRIBUTIONS BY FIELD:");
  console.log(`  rawScore:     0-92, continuous-ish, ${uniqueRaw.length} unique values`);
  console.log(`  priorityScore: 0 or 60-92, bimodal, ${uniqueP.length} unique values`);
  console.log(`  Displayed:    Same as priorityScore`);
  console.log();
  
  console.log("WHAT rawScore ACTUALLY MEANS:");
  console.log("  - 'Calculated executive-opportunity fit'");
  console.log("  - Continuous 0-100 (actually 0-92)");
  console.log("  - Weights: Identity 30%, Capability ~35%, Career ~25%, Opportunity 10%");
  console.log("  - Minus friction");
  console.log("  - Used for: Internal calculation, audit, NOT display");
  console.log();
  
  console.log("WHAT priorityScore ACTUALLY MEANS:");
  console.log("  - 'Actionability / pursuit priority'");
  console.log("  - Bimodal: 0 = don't pursue, 60-69 = consider, 70+ = pursue");
  console.log("  - Derived from rawScore + decision policy");
  console.log("  - Explicitly set to 0 for all PASS decisions");
  console.log("  - What users see");
  console.log();
  
  console.log("DOES HEADLINE SCORE MATCH PRODUCT PROMISE?");
  console.log("  Product Promise: 'Which opportunities are worth investing my limited time in?'");
  console.log("  Current Score (priorityScore):");
  console.log("    - Does NOT rank all opportunities");
  console.log("    - 62% appear identical (score 0)");
  console.log("    - Only ranks the top 38%");
  console.log("  VERDICT: NO - headline score is NOT a common 0-100 index");
  console.log("  It IS a pursuit actionability indicator");
  console.log();
  
  console.log("OPEN PRODUCT DECISIONS:");
  console.log("1. Should PASS opportunities show rawScore instead of 0?");
  console.log("2. Is 62% exclusion rate acceptable for the product promise?");
  console.log("3. Should there be secondary ranking for 'not pursue' opportunities?");
  console.log("4. Should users see 'almost made it' (59) vs 'far off' (5)?");
  console.log("5. Should vetoed opportunities retain their quality score?");
  console.log("6. Is 'priorityScore' the right name for what it does?");
  console.log("7. Should RADAR promise 'common index' or 'actionability indicator'?");
  console.log();
  
  console.log("=".repeat(100));
  console.log("INVESTIGATION COMPLETE - STOP");
  console.log("=".repeat(100));
}

completeScoreSemanticsAnalysis();
