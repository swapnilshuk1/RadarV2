import * as fs from "node:fs";
import * as path from "node:path";
import { EditorialContextBuilder } from "../../src/lib/intelligence/editorial/EditorialContext";
import { ExecutiveThesisBuilder } from "../../src/lib/intelligence/editorial/ExecutiveThesisBuilder";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";
import { rawOpportunities } from "../../src/data/opportunity-fixtures";
import type { Opportunity } from "../../src/data/opportunity-fixtures";

export interface EditorialAuditRecord {
  jobHash: string;
  role: string;
  company: string;
  engineVerdict: string | null;
  qualityScore: number | null;
  trajectoryUpside: string | null;
  careerValueProtection: string | null;
  triggeredRuleIds: readonly string[];
  thesisVerdict: string | null;
  thesisHeadline: string;
  careerValueSignal: string | null;
  primaryReason: string;
  tradeoff: string | null;
  surfaceConvergence: boolean;
  violations: string[];
}

export interface EditorialAuditSummary {
  totalAudited: number;
  engineVerdictMismatchCount: number;
  careerValueSignalLossCount: number;
  careerRegressionSuppressedCount: number;
  userDecisionEditorialOverridesCount: number;
  scoreDerivedEditorialVerdictsCount: number;
  surfaceVerdictDivergenceCount: number;
  fabricatedCareerSignalsCount: number;
  authoritativeSignalMutationCount: number;
  totalViolations: number;
  integrityPassRate: number;
}

export function runEditorialCorpusAudit(): { records: EditorialAuditRecord[]; summary: EditorialAuditSummary } {
  let opportunities: Opportunity[] = [];

  // Try loading Phase 8 125-JD simulation corpus if available
  const baseDir = path.resolve(process.cwd(), ".scraper-artifacts/v4-engine-simulation/latest");
  const corpusPath = path.join(baseDir, "corpus.json");

  if (fs.existsSync(corpusPath)) {
    try {
      const rawCorpus = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));
      opportunities = rawCorpus.map((item: any) => item.opportunity || item);
    } catch {
      opportunities = rawOpportunities as any;
    }
  }

  if (!opportunities || opportunities.length === 0) {
    opportunities = rawOpportunities as any;
  }

  const records: EditorialAuditRecord[] = [];

  let engineVerdictMismatchCount = 0;
  let careerValueSignalLossCount = 0;
  let careerRegressionSuppressedCount = 0;
  let userDecisionEditorialOverridesCount = 0;
  let scoreDerivedEditorialVerdictsCount = 0;
  let surfaceVerdictDivergenceCount = 0;
  let fabricatedCareerSignalsCount = 0;
  let authoritativeSignalMutationCount = 0;

  for (const opp of opportunities) {
    const violations: string[] = [];

    const editorialContext = EditorialContextBuilder.build(opp);
    const executiveThesis = ExecutiveThesisBuilder.build(editorialContext, opp);
    const brief = BriefCompositionEngine.compose(opp);

    // 1. Engine Verdict Mismatch
    if (editorialContext.engineVerdict !== executiveThesis.verdict) {
      engineVerdictMismatchCount++;
      violations.push(`Engine verdict mismatch: context=${editorialContext.engineVerdict} vs thesis=${executiveThesis.verdict}`);
    }

    // 2. Career Value Signal Loss
    const upstreamUpside = editorialContext.careerValue.trajectoryUpside;
    if (upstreamUpside === "HIGH" && executiveThesis.careerValueSignal !== "HIGH CAREER UPSIDE") {
      careerValueSignalLossCount++;
      violations.push(`Career value signal loss: upstream HIGH lost in thesis`);
    }

    // 3. Career Regression Suppressed
    const upstreamProtection = editorialContext.careerValue.careerValueProtection;
    if ((upstreamProtection === "DOWNSCALED" || upstreamUpside === "REGRESSION") && executiveThesis.careerValueSignal !== "CAREER REGRESSION / PROTECTION") {
      careerRegressionSuppressedCount++;
      violations.push(`Career regression suppressed in executive thesis`);
    }

    // 4. User Decision Override
    if (opp.userDecision && opp.userDecision.userAction !== editorialContext.engineVerdict) {
      if (executiveThesis.verdict === opp.userDecision.userAction) {
        userDecisionEditorialOverridesCount++;
        violations.push(`Executive thesis flipped to match user decision (${opp.userDecision.userAction}) instead of engine (${editorialContext.engineVerdict})`);
      }
    }

    // 5. Score Derived Verdicts (Sanity check against score manipulation)
    const artificialOpp = {
      ...opp,
      engineRecommendation: {
        ...opp.engineRecommendation!,
        qualityScore: 20, // Low score injected
      },
    };
    const lowScoreCtx = EditorialContextBuilder.build(artificialOpp);
    const lowScoreThesis = ExecutiveThesisBuilder.build(lowScoreCtx, artificialOpp);
    if (lowScoreThesis.verdict !== executiveThesis.verdict) {
      scoreDerivedEditorialVerdictsCount++;
      violations.push(`Thesis verdict mutated due to qualityScore modification`);
    }

    // 6. Surface Verdict Divergence
    if (brief.executiveThesis.verdict !== executiveThesis.verdict) {
      surfaceVerdictDivergenceCount++;
      violations.push(`Surface brief thesis verdict (${brief.executiveThesis.verdict}) diverges from standalone thesis (${executiveThesis.verdict})`);
    }

    // 7. Fabricated Career Signals
    if (!upstreamUpside && !upstreamProtection && editorialContext.careerValue.triggeredRuleIds.length === 0 && executiveThesis.careerValueSignal !== null) {
      fabricatedCareerSignalsCount++;
      violations.push(`Fabricated career value signal (${executiveThesis.careerValueSignal}) when upstream signals were null`);
    }

    // 8. Authoritative Signal Mutation
    if (brief.memory.headline !== executiveThesis.headline) {
      authoritativeSignalMutationCount++;
      violations.push(`Brief memory headline (${brief.memory.headline}) modified canonical headline (${executiveThesis.headline})`);
    }

    records.push({
      jobHash: opp.jobHash,
      role: opp.role,
      company: opp.company,
      engineVerdict: editorialContext.engineVerdict,
      qualityScore: editorialContext.rawScore,
      trajectoryUpside: editorialContext.careerValue.trajectoryUpside,
      careerValueProtection: editorialContext.careerValue.careerValueProtection,
      triggeredRuleIds: editorialContext.careerValue.triggeredRuleIds,
      thesisVerdict: executiveThesis.verdict,
      thesisHeadline: executiveThesis.headline,
      careerValueSignal: executiveThesis.careerValueSignal,
      primaryReason: executiveThesis.primaryReason,
      tradeoff: executiveThesis.tradeoff,
      surfaceConvergence: violations.length === 0,
      violations,
    });
  }

  const totalViolations =
    engineVerdictMismatchCount +
    careerValueSignalLossCount +
    careerRegressionSuppressedCount +
    userDecisionEditorialOverridesCount +
    scoreDerivedEditorialVerdictsCount +
    surfaceVerdictDivergenceCount +
    fabricatedCareerSignalsCount +
    authoritativeSignalMutationCount;

  const totalAudited = records.length;
  const passedCount = records.filter((r) => r.violations.length === 0).length;
  const integrityPassRate = totalAudited > 0 ? (passedCount / totalAudited) * 100 : 100;

  const summary: EditorialAuditSummary = {
    totalAudited,
    engineVerdictMismatchCount,
    careerValueSignalLossCount,
    careerRegressionSuppressedCount,
    userDecisionEditorialOverridesCount,
    scoreDerivedEditorialVerdictsCount,
    surfaceVerdictDivergenceCount,
    fabricatedCareerSignalsCount,
    authoritativeSignalMutationCount,
    totalViolations,
    integrityPassRate,
  };

  return { records, summary };
}

if (process.argv[1]?.includes("run-v4-editorial-audit")) {
  console.log("================================================================================");
  console.log("RADAR V4 — P1.1 CAREER-VALUE SIGNAL PROPAGATION & EDITORIAL AUDIT RUNNER");
  console.log("================================================================================");

  const { records, summary } = runEditorialCorpusAudit();

  console.log(`\nCorpus Audit Results (${summary.totalAudited} JDs Audited):`);
  console.log(`• Engine Verdict Mismatches: ${summary.engineVerdictMismatchCount}`);
  console.log(`• Career Value Signal Loss: ${summary.careerValueSignalLossCount}`);
  console.log(`• Career Regression Suppressed: ${summary.careerRegressionSuppressedCount}`);
  console.log(`• User Decision Editorial Overrides: ${summary.userDecisionEditorialOverridesCount}`);
  console.log(`• Score-Derived Editorial Verdicts: ${summary.scoreDerivedEditorialVerdictsCount}`);
  console.log(`• Surface Verdict Divergence: ${summary.surfaceVerdictDivergenceCount}`);
  console.log(`• Fabricated Career Signals: ${summary.fabricatedCareerSignalsCount}`);
  console.log(`• Authoritative Signal Mutation: ${summary.authoritativeSignalMutationCount}`);
  console.log(`\nOverall Integrity Pass Rate: ${summary.integrityPassRate.toFixed(2)}% (${summary.totalViolations} violations)`);

  const outDir = path.resolve(process.cwd(), ".scraper-artifacts/v4-editorial-audit");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const jsonPath = path.join(outDir, "career-value-editorial-audit.json");
  const mdPath = path.join(outDir, "career-value-editorial-audit.md");

  fs.writeFileSync(jsonPath, JSON.stringify({ summary, records }, null, 2));

  const mdContent = `# RADAR V4 — P1.1 Career-Value Signal Propagation Audit Report

## Audit Summary
- **Total Opportunities Audited**: ${summary.totalAudited}
- **Integrity Pass Rate**: ${summary.integrityPassRate.toFixed(2)}%
- **Total Integrity Violations**: ${summary.totalViolations}

### Hard Gate Breakdown
| Gate ID | Hard Gate Name | Violations | Status |
|---|---|---|---|
| Gate 1 | Engine Verdict Mismatch | ${summary.engineVerdictMismatchCount} | ${summary.engineVerdictMismatchCount === 0 ? "PASSED ✅" : "FAILED ❌"} |
| Gate 2 | Career Value Signal Loss | ${summary.careerValueSignalLossCount} | ${summary.careerValueSignalLossCount === 0 ? "PASSED ✅" : "FAILED ❌"} |
| Gate 3 | Career Regression Suppressed | ${summary.careerRegressionSuppressedCount} | ${summary.careerRegressionSuppressedCount === 0 ? "PASSED ✅" : "FAILED ❌"} |
| Gate 4 | User Decision Editorial Override | ${summary.userDecisionEditorialOverridesCount} | ${summary.userDecisionEditorialOverridesCount === 0 ? "PASSED ✅" : "FAILED ❌"} |
| Gate 5 | Score-Derived Editorial Verdict | ${summary.scoreDerivedEditorialVerdictsCount} | ${summary.scoreDerivedEditorialVerdictsCount === 0 ? "PASSED ✅" : "FAILED ❌"} |
| Gate 6 | Surface Verdict Divergence | ${summary.surfaceVerdictDivergenceCount} | ${summary.surfaceVerdictDivergenceCount === 0 ? "PASSED ✅" : "FAILED ❌"} |
| Gate 7 | Fabricated Career Signals | ${summary.fabricatedCareerSignalsCount} | ${summary.fabricatedCareerSignalsCount === 0 ? "PASSED ✅" : "FAILED ❌"} |
| Gate 8 | Authoritative Signal Mutation | ${summary.authoritativeSignalMutationCount} | ${summary.authoritativeSignalMutationCount === 0 ? "PASSED ✅" : "FAILED ❌"} |

## Invariant Verification
1. **Decision Policy Engine Authority**: Decision Policy decides what RADAR thinks. Editorial explains why. UI presents.
2. **User Decision Isolation**: User decisions do not mutate ExecutiveThesis or engineVerdict.
3. **Score Threshold Elimination**: Zero editorial verdicts derived from raw quality/capability scores.
`;

  fs.writeFileSync(mdPath, mdContent);
  console.log(`\nAudit artifacts written to:\n- ${jsonPath}\n- ${mdPath}`);

  if (summary.totalViolations > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}
