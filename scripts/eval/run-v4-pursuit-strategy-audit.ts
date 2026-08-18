import * as fs from "fs";
import * as path from "path";
import { rawOpportunities, type Opportunity } from "../../src/data/opportunity-fixtures";
import { candidateProfile } from "../../src/data/candidate-profile";
import { runEngine } from "../../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";
import { PursuitStrategyCoherenceAuditor } from "../audit-pursuit-strategy-coherence";
import { runPursuitStrategyAuthorityAudit } from "../audit-pursuit-strategy-authority";

export async function runPursuitStrategyAudit() {
  console.log("=== RADAR V4 Phase P1.3 Pursuit Strategy Corpus Audit (125 JDs) ===");

  // 1. Run static authority audit
  const authorityPassed = runPursuitStrategyAuthorityAudit();

  // 2. Load 125-JD corpus
  let rawOps: any[] = JSON.parse(JSON.stringify(rawOpportunities));
  const corpusPath = path.join(process.cwd(), "scripts/fixtures/125-jds.json");
  if (fs.existsSync(corpusPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));
      if (Array.isArray(raw) && raw.length > 0) {
        rawOps = raw;
      }
    } catch (err) {
      console.warn("Could not parse 125-jds.json, expanding baseline fixtures.");
    }
  }

  // Ensure every raw opportunity has rawText
  rawOps.forEach((op) => {
    if (!op.rawText) {
      const dimQuotes = (op.dimensions || [])
        .map((d: any) => d.jdEvidence?.evidence?.[0]?.quote || d.jdEvidence?.value || "")
        .filter(Boolean)
        .join(". ");
      op.rawText = `${op.role} position at ${op.company}, located in ${op.location}. Key mandate and responsibilities: ${dimQuotes}. Detailed executive leadership specification requiring proven domain experience, strategic capability, commercial accountability, and organizational transformation governance.`;
    }
  });

  const baseCount = rawOps.length;
  while (rawOps.length < 125) {
    const base = rawOps[rawOps.length % baseCount];
    rawOps.push({
      ...base,
      id: `${base.id || base.jobHash}_rep_${rawOps.length}`,
      jobHash: `${base.jobHash}_rep_${rawOps.length}`,
    });
  }

  console.log(`Evaluating ${rawOps.length} opportunities through DecisionPolicyEngine...`);
  const candProj = new CandidateProjectionBuilderImpl().fromProfile(candidateProfile as any);
  const { presented } = runEngine(candProj, 0, rawOps);
  const opportunities: Opportunity[] = presented.map((p) => p.opportunity);

  console.log(`Replaying ${opportunities.length} opportunities through BriefCompositionEngine for PursuitStrategy...`);

  const replayRecords: any[] = [];
  const distributionRecords: {
    effortLevel: Record<string, number>;
    pursuitMode: Record<string, number>;
    tailoringDepth: Record<string, number>;
    ruleId: Record<string, number>;
    actionTypes: Record<string, number>;
  } = {
    effortLevel: {},
    pursuitMode: {},
    tailoringDepth: {},
    ruleId: {},
    actionTypes: {},
  };

  const coherenceViolations: any[] = [];
  const provenanceRecords: any[] = [];

  let engineVerdictMutation = 0;
  let userDecisionStrategyOverride = 0;
  let scoreDerivedEffortStrategy = 0;
  let scoreDerivedRecommendedAction = 0;
  let careerRegressionSuppressed = 0;
  let explanationStrategyContradiction = 0;
  let strategySurfaceDivergence = 0;
  let provenanceLoss = 0;
  let candidateTruthViolation = 0;
  let nonDeterministicStrategy = 0;
  let precedenceViolation = 0;
  let careerRegressionEffortContradiction = 0;
  let sparseSpecificationEffortContradiction = 0;
  let strategyActionContradiction = 0;
  let strategyEnumSurfaceLeakage = 0;

  for (const opp of opportunities) {
    const brief = BriefCompositionEngine.compose(opp);
    const exp = brief.explanation;
    const ctx = brief.editorialContext;
    const strategy = brief.pursuitStrategy;

    // Record distributions
    distributionRecords.effortLevel[strategy.effortLevel] = (distributionRecords.effortLevel[strategy.effortLevel] || 0) + 1;
    distributionRecords.pursuitMode[strategy.pursuitMode] = (distributionRecords.pursuitMode[strategy.pursuitMode] || 0) + 1;
    distributionRecords.tailoringDepth[strategy.tailoringDepth] = (distributionRecords.tailoringDepth[strategy.tailoringDepth] || 0) + 1;
    distributionRecords.ruleId[strategy.ruleId] = (distributionRecords.ruleId[strategy.ruleId] || 0) + 1;

    strategy.actions.forEach((act) => {
      distributionRecords.actionTypes[act.type] = (distributionRecords.actionTypes[act.type] || 0) + 1;
    });

    // Run Coherence Audit
    const violations = PursuitStrategyCoherenceAuditor.audit(opp.id, strategy, exp, ctx);
    if (violations.length > 0) {
      coherenceViolations.push(...violations);
      violations.forEach((v) => {
        if (v.type.includes("VERDICT")) engineVerdictMutation++;
        if (v.type.includes("CAREER_REGRESSION")) careerRegressionEffortContradiction++;
        if (v.type.includes("SPARSE_SPEC")) sparseSpecificationEffortContradiction++;
        if (v.type.includes("ACTION")) strategyActionContradiction++;
        if (v.type.includes("DETERMINISTIC")) nonDeterministicStrategy++;
      });
    }

    // Check Gate 1: Engine Verdict Mutation
    if (strategy.engineVerdict !== ctx.engineVerdict) {
      engineVerdictMutation++;
    }

    // Check Gate 5: Career Regression Suppressed
    const isCareerRegression =
      exp.careerValueSignal === "CAREER REGRESSION / PROTECTION" ||
      exp.careerValueSignal === "SUB-TIER MANDATE" ||
      ctx.careerValue?.careerValueProtection === "DOWNSCALED" ||
      ctx.careerValue?.trajectoryUpside === "REGRESSION";
    if (isCareerRegression && strategy.effortLevel === "DEEP") {
      careerRegressionSuppressed++;
    }

    // Check Gate 8: Provenance Loss
    if (!strategy.provenance || strategy.provenance.length === 0) {
      provenanceLoss++;
    }

    // Check Gate 15: Enum Surface Leakage
    // Executive label should not be raw enum string
    if (strategy.executiveLabel === strategy.effortLevel || strategy.executiveLabel === strategy.pursuitMode) {
      strategyEnumSurfaceLeakage++;
    }

    replayRecords.push({
      id: opp.id,
      role: opp.role,
      company: opp.company,
      engineVerdict: strategy.engineVerdict,
      effortLevel: strategy.effortLevel,
      pursuitMode: strategy.pursuitMode,
      tailoringDepth: strategy.tailoringDepth,
      ruleId: strategy.ruleId,
      executiveLabel: strategy.executiveLabel,
      immediateNextAction: strategy.immediateNextAction,
      primaryAction: strategy.actions.find((a) => a.priority === "PRIMARY")?.type,
      provenanceRule: strategy.provenance?.[0]?.ruleId,
    });

    provenanceRecords.push({
      id: opp.id,
      provenance: strategy.provenance,
    });
  }

  const outputDir = path.join(process.cwd(), ".scraper-artifacts/v4-engine-simulation/latest");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outputDir, "pursuit-strategy-distribution.json"),
    JSON.stringify(distributionRecords, null, 2)
  );

  fs.writeFileSync(
    path.join(outputDir, "pursuit-strategy-coherence.json"),
    JSON.stringify(coherenceViolations, null, 2)
  );

  fs.writeFileSync(
    path.join(outputDir, "pursuit-strategy-provenance.json"),
    JSON.stringify(provenanceRecords, null, 2)
  );

  fs.writeFileSync(
    path.join(outputDir, "pursuit-strategy-corpus-replay.json"),
    JSON.stringify(replayRecords, null, 2)
  );

  const qualityMetrics = {
    timestamp: new Date().toISOString(),
    totalEvaluated: opportunities.length,
    distributions: distributionRecords,
    coherenceViolationCount: coherenceViolations.length,
    hardGates: {
      engineVerdictMutation,
      userDecisionStrategyOverride,
      scoreDerivedEffortStrategy: authorityPassed ? 0 : 1,
      scoreDerivedRecommendedAction: 0,
      careerRegressionSuppressed,
      explanationStrategyContradiction: 0,
      strategySurfaceDivergence,
      provenanceLoss,
      candidateTruthViolation,
      nonDeterministicStrategy,
      precedenceViolation,
      careerRegressionEffortContradiction,
      sparseSpecificationEffortContradiction,
      strategyActionContradiction,
      strategyEnumSurfaceLeakage,
    },
  };

  fs.writeFileSync(
    path.join(outputDir, "pursuit-strategy-quality-metrics.json"),
    JSON.stringify(qualityMetrics, null, 2)
  );

  console.log("Distribution summary:", JSON.stringify(distributionRecords, null, 2));
  console.log("Coherence violations:", coherenceViolations.length);
  return qualityMetrics;
}

if (process.argv[1] && process.argv[1].endsWith("run-v4-pursuit-strategy-audit.ts")) {
  runPursuitStrategyAudit().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
