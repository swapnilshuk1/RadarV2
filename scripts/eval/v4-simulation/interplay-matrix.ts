/**
 * scripts/eval/v4-simulation/interplay-matrix.ts
 *
 * Engine Interplay Matrix & Category/Seniority Aggregator for RADAR V4 Phase 8.
 * Builds the comprehensive interplay tables, score triangulation patterns, and category summaries.
 */

import type { SimulationRecord, InterplayRow, CategoryAggregate, SeniorityAggregate } from "./types";

export function buildInterplayMatrix(records: SimulationRecord[]): InterplayRow[] {
  return records.map((rec, idx) => {
    const brief = rec.briefModel;
    const policyVerdict = rec.policyResult.verdict;
    const scoreStr = rec.shortlistingPotential.score !== null ? `${rec.shortlistingPotential.score}` : "N/A";
    const careerUpside = rec.policyResult.trajectoryUpside || (rec.isolatedAssessments?.career?.trajectoryFit ? "Aligned Upside" : "Neutral");

    const keyRisk =
      rec.policyResult.decisionRisks?.[0]?.label ||
      brief?.memory?.primaryRisk ||
      "—";

    const keyDriver =
      rec.policyResult.decisionDrivers?.[0]?.label ||
      brief?.memory?.primaryOpportunity ||
      "—";

    const verbatimScoreStr = `${rec.objectiveScores.totalObjectiveScore}/35`;
    const hasContradiction = rec.contradictions.length > 0;

    // Assess overall record: PASS if no contradictions and objective score >= 24; REVIEW if score 18-24; FAIL if contradictions or score < 18 or silent failures
    let assessment: "PASS" | "REVIEW" | "FAIL" = "PASS";
    if (rec.failures.length > 0 || rec.contradictions.some((c) => c.severity === "CRITICAL") || rec.objectiveScores.totalObjectiveScore < 18) {
      assessment = "FAIL";
    } else if (rec.contradictions.length > 0 || rec.objectiveScores.totalObjectiveScore < 24) {
      assessment = "REVIEW";
    }

    return {
      index: idx + 1,
      jobHash: rec.jobHash,
      role: rec.role,
      company: rec.company,
      category: rec.category,
      seniority: rec.seniorityTier,
      policyVerdict,
      score: scoreStr,
      careerUpside,
      keyRisk: keyRisk.slice(0, 40),
      keyDriver: keyDriver.slice(0, 40),
      verbatimScore: verbatimScoreStr,
      hasContradiction,
      assessment,
    };
  });
}

export function computeCategoryAggregates(records: SimulationRecord[]): CategoryAggregate[] {
  const catMap = new Map<string, SimulationRecord[]>();

  for (const r of records) {
    if (!catMap.has(r.category)) {
      catMap.set(r.category, []);
    }
    catMap.get(r.category)!.push(r);
  }

  const aggregates: CategoryAggregate[] = [];

  for (const [cat, recs] of catMap.entries()) {
    const count = recs.length;
    const validScores = recs.map((r) => r.shortlistingPotential.score).filter((s): s is number => s !== null && s > 0);
    const avgScore = validScores.length > 0 ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10 : 0;

    const pursueCount = recs.filter((r) => r.policyResult.verdict === "PURSUE").length;
    const considerCount = recs.filter((r) => r.policyResult.verdict === "CONSIDER").length;
    const passCount = recs.filter((r) => r.policyResult.verdict === "PASS").length;
    const sparseCount = recs.filter((r) => !r.gateResult.passed).length;

    const avgGrounding =
      Math.round(
        (recs.reduce((acc, r) => acc + r.objectiveScores.evidenceGroundingScore, 0) / count) * 10
      ) / 10;

    const contradictionCount = recs.reduce((acc, r) => acc + r.contradictions.length, 0);
    const genericCount = recs.reduce(
      (acc, r) => acc + r.verbatimAudits.filter((a) => a.classification === "GENERIC / LOW-VALUE").length,
      0
    );
    const totalVerbatims = recs.reduce((acc, r) => acc + r.verbatimAudits.length, 0) || 1;
    const genericPhraseRate = Math.round((genericCount / totalVerbatims) * 1000) / 10;

    const unsupportedCount = recs.reduce(
      (acc, r) => acc + r.verbatimAudits.filter((a) => a.classification === "UNSUPPORTED").length,
      0
    );

    const passAssessCount = recs.filter((r) => r.assessmentVerdict === "PASS").length;
    const assessmentPassRate = Math.round((passAssessCount / count) * 1000) / 10;

    aggregates.push({
      category: cat,
      count,
      avgScore,
      pursueCount,
      considerCount,
      passCount,
      sparseCount,
      avgGroundingScore: avgGrounding,
      contradictionCount,
      genericPhraseRate,
      unsupportedClaimCount: unsupportedCount,
      assessmentPassRate,
    });
  }

  // Sort by count descending then alphabetically
  aggregates.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  return aggregates;
}

export function computeSeniorityAggregates(records: SimulationRecord[]): SeniorityAggregate[] {
  const senMap = new Map<string, SimulationRecord[]>();

  for (const r of records) {
    if (!senMap.has(r.seniorityTier)) {
      senMap.set(r.seniorityTier, []);
    }
    senMap.get(r.seniorityTier)!.push(r);
  }

  const aggregates: SeniorityAggregate[] = [];

  for (const [tier, recs] of senMap.entries()) {
    const count = recs.length;
    const validScores = recs.map((r) => r.shortlistingPotential.score).filter((s): s is number => s !== null && s > 0);
    const avgScore = validScores.length > 0 ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10 : 0;

    const pursueCount = recs.filter((r) => r.policyResult.verdict === "PURSUE").length;
    const considerCount = recs.filter((r) => r.policyResult.verdict === "CONSIDER").length;
    const passCount = recs.filter((r) => r.policyResult.verdict === "PASS").length;
    const sparseCount = recs.filter((r) => !r.gateResult.passed).length;
    const contradictionCount = recs.reduce((acc, r) => acc + r.contradictions.length, 0);
    const unsupportedCount = recs.reduce(
      (acc, r) => acc + r.verbatimAudits.filter((a) => a.classification === "UNSUPPORTED").length,
      0
    );

    aggregates.push({
      seniorityTier: tier,
      count,
      avgScore,
      pursueCount,
      considerCount,
      passCount,
      sparseCount,
      contradictionCount,
      unsupportedClaimCount: unsupportedCount,
    });
  }

  aggregates.sort((a, b) => b.count - a.count);
  return aggregates;
}
