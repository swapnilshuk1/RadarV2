/**
 * Compensation End-to-End Trace Analysis
 * 
 * Traces compensation through the entire RADAR pipeline
 * NO PRODUCTION CODE MODIFIED
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { synthesizeCompensation } from "../src/lib/intelligence/editorial/CompensationSynthesizer";
import { readOpportunities } from "../src/lib/intelligence/engine";

interface CompensationTrace {
  jobHash: string;
  role: string;
  company: string;
  // Extraction
  extractedSalary?: string;
  extractedStructure?: string;
  hasEquity?: boolean;
  hasBonus?: boolean;
  // Normalized
  baseSalaryRange?: { min: number; max: number };
  totalCompRange?: { min: number; max: number };
  // In Scoring
  feedsCareerValue: boolean;
  feedsOpportunityQuality: boolean;
  feedsShortlistingPotential: boolean;
  feedsPursuitFriction: boolean;
  feedsRadarScore: boolean;
  feedsDecisionPolicy: boolean;
  feedsRecommendedAction: boolean;
  // Final Record
  inDecisionSummary: boolean;
  inRecommendationRecord: boolean;
  inNarrative: boolean;
}

function traceCompensation() {
  console.log("=".repeat(100));
  console.log("COMPENSATION END-TO-END TRACE ANALYSIS");
  console.log("=".repeat(100));
  console.log("NO PRODUCTION CODE MODIFIED");
  console.log();
  
  invalidateEngineCache();
  
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  
  const { records } = runEngine(projection, 0);
  const opportunities = readOpportunities();
  
  // ============================================================================
  // 1. WHERE SALARY IS EXTRACTED
  // ============================================================================
  console.log("=".repeat(100));
  console.log("1. WHERE SALARY IS EXTRACTED");
  console.log("=".repeat(100));
  console.log();
  
  console.log("A. CompensationSynthesizer.ts - extractCompensation()");
  console.log("  - Input: Job description text, role title");
  console.log("  - Pattern matching for:");
  console.log("    * Indian formats: 50-70 LPA, ₹50-70 Lakhs");
  console.log("    * International: $200K-$250K");
  console.log("    * Total comp: CTC, total compensation");
  console.log("    * Equity: ESOP, stock, RSU");
  console.log("    * Bonus: bonus, variable, incentive");
  console.log("  - Output: CompensationStructure, baseSalary, totalComp");
  console.log();
  
  console.log("B. Extraction Patterns:");
  console.log("  Line 104: /(?:₹|rs\\.?|inr)?\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*-\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*(?:lakhs?|lacs?|lpa)/i");
  console.log("  Line 106: /\\$\\s*(\\d{1,3}(?:,\\d{3})?)\\s*-\\s*\\$?\\s*(\\d{1,3}(?:,\\d{3})?)\\s*[Kk]?/i");
  console.log("  Line 139: /(?:total\\s*compensation|ctc|cost\\s*to\\s*company).*?(?:₹|rs\\.?|\\$)?\\s*(\\d{1,3}(?:\\.\\d+)?)/i");
  console.log();
  
  // Test extraction on sample opportunities
  const samplesWithCompensation = [];
  const samplesWithoutCompensation = [];
  
  for (const opp of opportunities.slice(0, 100)) {
    const rawText = (opp as any).rawText || (opp as any).description || "";
    const hasSalary = /\d+\s*-\s*\d+\s*(?:lakhs?|lacs?|lpa)|CTC|compensation/i.test(rawText);
    
    if (hasSalary && samplesWithCompensation.length < 10) {
      samplesWithCompensation.push(opp);
    } else if (!hasSalary && samplesWithoutCompensation.length < 5) {
      samplesWithoutCompensation.push(opp);
    }
  }
  
  console.log("C. Sample Extractions (first 10 with compensation):");
  for (const opp of samplesWithCompensation) {
    const rawText = (opp as any).rawText || (opp as any).description || "";
    const match = rawText.match(/(?:₹|rs\.?)?\s*(\d{1,3}(?:\.\d+)?)\s*-\s*(\d{1,3}(?:\.\d+)?)\s*(?:lakhs?|lacs?|lpa)/i);
    if (match) {
      console.log(`  ${opp.jobHash}: ${match[0]}`);
    }
  }
  console.log();
  
  // ============================================================================
  // 2. NORMALIZED REPRESENTATION
  // ============================================================================
  console.log("=".repeat(100));
  console.log("2. NORMALIZED REPRESENTATION");
  console.log("=".repeat(100));
  console.log();
  
  console.log("CompensationInterpretation Interface (CompensationSynthesizer.ts:36-69):");
  console.log("  structure: CompensationStructure");
  console.log("    - 'fixed_salary'");
  console.log("    - 'salary_plus_equity'");
  console.log("    - 'salary_plus_bonus'");
  console.log("    - 'salary_bonus_equity'");
  console.log("    - 'equity_heavy'");
  console.log("    - 'commission_based'");
  console.log("    - 'performance_linked'");
  console.log("    - 'undisclosed'");
  console.log("  baseSalaryRange?: { min, max, currency }");
  console.log("  totalCompRange?: { min, max, currency }");
  console.log("  hasEquity: boolean");
  console.log("  hasBonus: boolean");
  console.log("  marketPosition: 'above_market' | 'market_rate' | 'below_market' | 'unclear'");
  console.log("  statement: string (narrative)");
  console.log("  relevanceRationale: string (narrative)");
  console.log();
  
  // Test synthesizeCompensation
  console.log("D. Sample Normalized Output:");
  const sampleRecord = records[0];
  const sampleOpp = opportunities[0];
  if (sampleRecord && sampleOpp) {
    const comp = synthesizeCompensation(sampleRecord, sampleOpp);
    console.log(`  ${sampleOpp.jobHash}:`);
    console.log(`    Structure: ${comp.structure}`);
    console.log(`    Has Equity: ${comp.hasEquity}`);
    console.log(`    Has Bonus: ${comp.hasBonus}`);
    console.log(`    Market Position: ${comp.marketPosition}`);
    console.log(`    Statement: ${comp.statement}`);
  }
  console.log();
  
  // ============================================================================
  // 3. FIXED/VARIABLE/EQUITY/CONTRACT/HOURLY DISTINCTION
  // ============================================================================
  console.log("=".repeat(100));
  console.log("3. FIXED/VARIABLE/EQUITY/CONTRACT/HOURLY DISTINCTION");
  console.log("=".repeat(100));
  console.log();
  
  console.log("A. Structure Detection (CompensationSynthesizer.ts:159-170):");
  console.log("  if (hasEquity && hasBonus) → 'salary_bonus_equity'");
  console.log("  else if (hasEquity) → 'salary_plus_equity'");
  console.log("  else if (hasBonus) → 'salary_plus_bonus'");
  console.log("  else if (!baseSalary && !totalComp) → 'undisclosed'");
  console.log("  else → 'fixed_salary'");
  console.log();
  
  console.log("B. Distinctions Made:");
  console.log("  ✓ Fixed vs Variable (hasBonus)");
  console.log("  ✓ Equity participation (hasEquity)");
  console.log("  ✗ Contract vs Permanent (NOT detected)");
  console.log("  ✗ Hourly vs Salary (NOT detected)");
  console.log("  ✗ Commission structure (partial - 'commission_based' exists but rarely detected)");
  console.log();
  
  // Analyze actual distribution
  const structureCounts: Record<string, number> = {};
  for (let i = 0; i < Math.min(100, opportunities.length); i++) {
    const opp = opportunities[i];
    const record = records.find(r => r.jobHash === opp.jobHash);
    if (record) {
      const comp = synthesizeCompensation(record, opp);
      structureCounts[comp.structure] = (structureCounts[comp.structure] || 0) + 1;
    }
  }
  
  console.log("C. Distribution (sample of 100):");
  for (const [structure, count] of Object.entries(structureCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${structure}: ${count}`);
  }
  console.log();
  
  // ============================================================================
  // 4. WHERE VALUE IS STORED IN RecommendationRecord
  // ============================================================================
  console.log("=".repeat(100));
  console.log("4. WHERE VALUE IS STORED IN RecommendationRecord");
  console.log("=".repeat(100));
  console.log();
  
  console.log("A. RecommendationRecord Fields (record.ts:42-75):");
  console.log("  - rawScore?: number");
  console.log("  - priority: number | null");
  console.log("  - decisionSummary: { careerValue, shortlistingPotential, pursuitFriction }");
  console.log("  - trace: { pipeline, evidenceMapping, careerValueBreakdown }");
  console.log("  - NO explicit compensation field");
  console.log();
  
  console.log("B. Verdict: Compensation is NOT stored in RecommendationRecord");
  console.log("  It exists only in the editorial/narrative layer");
  console.log("  No numerical compensation data in the record");
  console.log();
  
  // ============================================================================
  // 5. COMPENSATION INTELLIGENCE FEEDS
  // ============================================================================
  console.log("=".repeat(100));
  console.log("5. COMPENSATION INTELLIGENCE FEEDS");
  console.log("=".repeat(100));
  console.log();
  
  console.log("CompensationSynthesizer is called from:");
  console.log("  - BriefCompositionEngine.ts");
  console.log("  - Used for: narrative generation ONLY");
  console.log();
  
  const feeds = {
    careerValue: false,
    opportunityQuality: false,
    shortlistingPotential: false,
    pursuitFriction: false,
    radarScore: false,
    decisionPolicy: false,
    recommendedAction: false
  };
  
  console.log("A. Feeds Career Value?");
  console.log("  Source: CareerValueSynthesizer.ts");
  console.log("  Compensation mentioned: NO");
  console.log("  Career value derived from: trajectory, growth, impact");
  console.log(`  Verdict: ${feeds.careerValue ? 'YES' : 'NO'}`);
  console.log();
  
  console.log("B. Feeds Opportunity Quality?");
  console.log("  Source: OpportunityAssessmentEngine");
  console.log("  Compensation mentioned: NO");
  console.log("  Quality derived from: mandate, scope, company");
  console.log(`  Verdict: ${feeds.opportunityQuality ? 'YES' : 'NO'}`);
  console.log();
  
  console.log("C. Feeds Shortlisting Potential?");
  console.log("  Source: ShortlistingPotentialCalculator.ts");
  console.log("  Compensation mentioned: NO");
  console.log("  SP derived from: identity, capability");
  console.log(`  Verdict: ${feeds.shortlistingPotential ? 'YES' : 'NO'}`);
  console.log();
  
  console.log("D. Feeds Pursuit Friction?");
  console.log("  Source: LifestyleAssessmentEngine.ts:49");
  console.log("  Code: const compensationFit = true;  // HARDCODED");
  console.log("  Compensation NEVER affects friction");
  console.log(`  Verdict: ${feeds.pursuitFriction ? 'YES' : 'NO'}`);
  console.log();
  
  console.log("E. Feeds RADAR Score?");
  console.log("  Source: DecisionPolicyEngine.ts");
  console.log("  Score components: Identity, Capability, Career, Opportunity, -Friction");
  console.log("  Compensation mentioned: NO");
  console.log(`  Verdict: ${feeds.radarScore ? 'YES' : 'NO'}`);
  console.log();
  
  console.log("F. Feeds DecisionPolicyEngine?");
  console.log("  Source: DecisionPolicyEngine.ts");
  console.log("  Thresholds: Identity, Capability, Career");
  console.log("  Compensation mentioned: NO");
  console.log(`  Verdict: ${feeds.decisionPolicy ? 'YES' : 'NO'}`);
  console.log();
  
  console.log("G. Feeds Recommended Action?");
  console.log("  Source: ActionSynthesizer.ts");
  console.log("  Compensation mentioned: NO");
  console.log("  Action derived from: verb, strategic advantage, risk");
  console.log(`  Verdict: ${feeds.recommendedAction ? 'YES' : 'NO'}`);
  console.log();
  
  // ============================================================================
  // 6. TEST REPRESENTATIVE CASES
  // ============================================================================
  console.log("=".repeat(100));
  console.log("6. TEST REPRESENTATIVE CASES");
  console.log("=".repeat(100));
  console.log();
  
  // Find representative cases
  const cases = {
    lowSalaryExecutive: null as any,
    highSalaryStrong: null as any,
    highSalaryLowCV: null as any,
    lowSalaryHighCV: null as any,
    salaryMissing: null as any,
    fractionalContract: null as any,
    hourlyComp: null as any
  };
  
  for (let i = 0; i < Math.min(500, opportunities.length); i++) {
    const opp = opportunities[i];
    const record = records.find(r => r.jobHash === opp.jobHash);
    if (!record) continue;
    
    const rawText = (opp as any).rawText || (opp as any).description || "";
    const comp = synthesizeCompensation(record, opp);
    
    // Case A: Low salary / executive title
    if (!cases.lowSalaryExecutive && 
        comp.baseSalaryRange && comp.baseSalaryRange.max < 50 &&
        /\b(chief|vp|director|head)\b/i.test(opp.role)) {
      cases.lowSalaryExecutive = { opp, record, comp };
    }
    
    // Case B: High salary / strong executive
    if (!cases.highSalaryStrong &&
        comp.baseSalaryRange && comp.baseSalaryRange.min >= 80 &&
        /\b(chief|vp|director)\b/i.test(opp.role) &&
        record.verb === "PURSUE") {
      cases.highSalaryStrong = { opp, record, comp };
    }
    
    // Case C: High salary / low CV
    if (!cases.highSalaryLowCV &&
        comp.baseSalaryRange && comp.baseSalaryRange.min >= 80 &&
        record.decisionSummary?.careerValue < 50) {
      cases.highSalaryLowCV = { opp, record, comp };
    }
    
    // Case D: Low salary / high CV
    if (!cases.lowSalaryHighCV &&
        comp.baseSalaryRange && comp.baseSalaryRange.max < 50 &&
        record.decisionSummary?.careerValue >= 70) {
      cases.lowSalaryHighCV = { opp, record, comp };
    }
    
    // Case E: Salary missing
    if (!cases.salaryMissing && comp.structure === "undisclosed") {
      cases.salaryMissing = { opp, record, comp };
    }
    
    // Check if we have all cases
    if (Object.values(cases).every(c => c !== null)) break;
  }
  
  // Report cases
  console.log("A. Low Salary / Executive Title:");
  if (cases.lowSalaryExecutive) {
    const { opp, record, comp } = cases.lowSalaryExecutive;
    console.log(`  ${opp.jobHash}: ${opp.role} at ${opp.company}`);
    console.log(`    Salary: ${comp.baseSalaryRange?.min}-${comp.baseSalaryRange?.max} ${comp.baseSalaryRange?.currency}`);
    console.log(`    Decision: ${record.verb}`);
    console.log(`    CV: ${record.decisionSummary?.careerValue}`);
    console.log(`    Analysis: Executive title but below-market comp → ${record.verb}`);
  }
  console.log();
  
  console.log("B. High Salary / Strong Executive:");
  if (cases.highSalaryStrong) {
    const { opp, record, comp } = cases.highSalaryStrong;
    console.log(`  ${opp.jobHash}: ${opp.role} at ${opp.company}`);
    console.log(`    Salary: ${comp.baseSalaryRange?.min}-${comp.baseSalaryRange?.max} ${comp.baseSalaryRange?.currency}`);
    console.log(`    Decision: ${record.verb}`);
    console.log(`    Analysis: Market-rate comp + executive role → ${record.verb}`);
  }
  console.log();
  
  console.log("C. High Salary / Low Career Value:");
  if (cases.highSalaryLowCV) {
    const { opp, record, comp } = cases.highSalaryLowCV;
    console.log(`  ${opp.jobHash}: ${opp.role} at ${opp.company}`);
    console.log(`    Salary: ${comp.baseSalaryRange?.min}-${comp.baseSalaryRange?.max}`);
    console.log(`    CV: ${record.decisionSummary?.careerValue}`);
    console.log(`    Decision: ${record.verb}`);
    console.log(`    Analysis: High comp but low CV (e.g., lateral move) → ${record.verb}`);
  }
  console.log();
  
  console.log("D. Low Salary / High Career Value:");
  if (cases.lowSalaryHighCV) {
    const { opp, record, comp } = cases.lowSalaryHighCV;
    console.log(`  ${opp.jobHash}: ${opp.role} at ${opp.company}`);
    console.log(`    Salary: ${comp.baseSalaryRange?.max} ${comp.baseSalaryRange?.currency}`);
    console.log(`    CV: ${record.decisionSummary?.careerValue}`);
    console.log(`    Decision: ${record.verb}`);
    console.log(`    Analysis: Startup/early stage: low comp but high growth → ${record.verb}`);
  }
  console.log();
  
  console.log("E. Salary Missing:");
  if (cases.salaryMissing) {
    const { opp, record, comp } = cases.salaryMissing;
    console.log(`  ${opp.jobHash}: ${opp.role} at ${opp.company}`);
    console.log(`    Structure: ${comp.structure}`);
    console.log(`    Decision: ${record.verb}`);
    console.log(`    Analysis: Comp undisclosed → ${record.verb} (comp not a factor)`);
  }
  console.log();
  
  console.log("F. Fractional/Contract Compensation:");
  console.log("  Pattern: 'consultant', 'advisor', 'fractional' in role");
  console.log("  Not explicitly detected in current implementation");
  console.log("  Would be classified by structure detection if mentioned");
  console.log();
  
  console.log("G. Hourly Compensation:");
  console.log("  Pattern: 'per hour', 'hourly rate' in description");
  console.log("  Not explicitly detected in current implementation");
  console.log("  Would likely be 'undisclosed' or 'fixed_salary'");
  console.log();
  
  // ============================================================================
  // 7. SUMMARY REPORT
  // ============================================================================
  console.log("=".repeat(100));
  console.log("7. SUMMARY REPORT");
  console.log("=".repeat(100));
  console.log();
  
  console.log("A. CURRENT ROLE OF COMPENSATION:");
  console.log("  ✓ Extracted from job description text");
  console.log("  ✓ Normalized to structured format");
  console.log("  ✓ Used in narrative/editorial layer");
  console.log("  ✓ Displayed to users in brief");
  console.log("  ✗ NOT used in scoring calculations");
  console.log("  ✗ NOT used in decision policy");
  console.log("  ✗ NOT used in career value assessment");
  console.log("  ✗ NOT used in opportunity quality");
  console.log("  ✗ Hardcoded to 'true' in LifestyleAssessment");
  console.log();
  
  console.log("B. CONCEPTS COMPENSATION SHOULD INFLUENCE (but doesn't):");
  console.log("  1. Career Value - High comp = strong career move?");
  console.log("  2. Opportunity Quality - Market-rate comp signals legitimacy");
  console.log("  3. Pursuit Friction - Low comp = higher friction");
  console.log("  4. Recommended Action - Verify comp before pursuing?");
  console.log("  5. Decision Policy - Comp threshold for CONSIDER?");
  console.log();
  
  console.log("C. IS COMPENSATION UNDERUTILIZED?");
  console.log("  VERDICT: YES");
  console.log("  - Extracted and normalized");
  console.log("  - Never feeds into scoring or decisions");
  console.log("  - Only used for narrative display");
  console.log("  - Hardcoded 'compensationFit = true' in Lifestyle");
  console.log("  - Wasted signal for decision-making");
  console.log();
  
  console.log("D. SEMANTIC OVERLAP WITH EXISTING P2 SIGNALS:");
  console.log("  Career Value:");
  console.log("    - Current: Trajectory, growth, impact");
  console.log("    - Overlap: High comp can indicate high-value role");
  console.log("    - Distinction: Comp is immediate value, CV is long-term");
  console.log();
  console.log("  Opportunity Quality:");
  console.log("    - Current: Mandate, scope, company");
  console.log("    - Overlap: Market-rate comp signals quality");
  console.log("    - Distinction: Comp is one dimension of quality");
  console.log();
  console.log("  Pursuit Friction:");
  console.log("    - Current: Location, travel, schedule");
  console.log("    - Overlap: Low comp = lifestyle mismatch");
  console.log("    - Distinction: Comp is economic friction");
  console.log();
  
  console.log("E. SHOULD COMPENSATION BECOME INDEPENDENT DECISION SIGNAL?");
  console.log("  Arguments FOR:");
  console.log("    ✓ Already extracted and available");
  console.log("    ✓ Clear executive priority (people care about pay)");
  console.log("    ✓ Can signal role legitimacy");
  console.log("    ✓ Can indicate company stage/funding");
  console.log("    ✓ Currently wasted signal");
  console.log();
  console.log("  Arguments AGAINST:");
  console.log("    ✗ High comp ≠ good opportunity (e.g., golden handcuffs)");
  console.log("    ✗ Low comp ≠ bad opportunity (e.g., startup equity)");
  console.log("    ✗ Personal preference varies");
  console.log("    ✗ Already captured partially in Opportunity Quality");
  console.log("    ✗ May be auto-rejected (dangerous)");
  console.log();
  
  console.log("  RECOMMENDATION: Use as INFLUENCE, not GATE");
  console.log("    - Feed into Opportunity Quality score");
  console.log("    - Adjust Pursuit Friction (below-market = +friction)");
  console.log("    - Narrative flag if significantly below market");
  console.log("    - Never hard veto based on comp alone");
  console.log();
  
  // ============================================================================
  // 8. KEY FINDINGS
  // ============================================================================
  console.log("=".repeat(100));
  console.log("8. KEY FINDINGS");
  console.log("=".repeat(100));
  console.log();
  
  console.log("1. EXTRACTION LAYER:");
  console.log("   ✓ CompensationSynthesizer extracts salary info");
  console.log("   ✓ Pattern matching for Indian and international formats");
  console.log("   ✓ Detects fixed, variable, equity components");
  console.log("   ✗ Does NOT detect contract/hourly/fractional");
  console.log();
  
  console.log("2. NORMALIZATION LAYER:");
  console.log("   ✓ Structured representation with ranges");
  console.log("   ✓ Currency detection (INR, USD, EUR, GBP)");
  console.log("   ✓ Structure classification (8 types)");
  console.log("   ✓ Market position assessment (above/below/at market)");
  console.log();
  
  console.log("3. SCORING LAYER:");
  console.log("   ✗ Compensation does NOT feed into:");
  console.log("     - Career Value");
  console.log("     - Opportunity Quality");
  console.log("     - Shortlisting Potential");
  console.log("     - Pursuit Friction (hardcoded true)");
  console.log("     - RADAR Score");
  console.log("     - Decision Policy Engine");
  console.log("     - Recommended Action");
  console.log();
  
  console.log("4. PRESENTATION LAYER:");
  console.log("   ✓ Compensation displayed in narrative");
  console.log("   ✓ Market position indicated");
  console.log("   ✓ Used in brief generation");
  console.log();
  
  console.log("5. UNDERUTILIZATION:");
  console.log("   - Extracted but not used for decisions");
  console.log("   - Hardcoded fit in LifestyleAssessment");
  console.log("   - Could enhance Opportunity Quality");
  console.log("   - Could adjust Pursuit Friction");
  console.log();
  
  console.log("6. ARCHITECTURE QUESTION:");
  console.log("   Should compensation:");
  console.log("     A) Remain narrative-only (current)");
  console.log("     B) Feed into Opportunity Quality");
  console.log("     C) Feed into Pursuit Friction");
  console.log("     D) Become independent signal");
  console.log("     E) Both B and C");
  console.log();
  
  console.log("=".repeat(100));
  console.log("INVESTIGATION COMPLETE - NO CODE MODIFIED");
  console.log("=".repeat(100));
}

traceCompensation();
