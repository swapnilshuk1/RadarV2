/**
 * scripts/eval/v4-simulation/human-review-compiler.ts
 *
 * Human Executive Review Packet Compiler for RADAR V4 Phase 8.
 * Assembles 80 deep-dive cases across 8 curated cohorts (10 each) for human validation.
 */

import type { SimulationRecord, HumanReviewCase } from "./types";

function mapRecordToReviewCase(record: SimulationRecord, cohort: string): HumanReviewCase {
  const brief = record.briefModel;
  const audits = record.verbatimAudits || [];

  return {
    cohort,
    jobHash: record.jobHash,
    role: record.role,
    company: record.company,
    category: record.category,
    seniority: record.seniorityTier,
    fullJDText: record.fullJDText,
    ontologySummary: (record.extractedDimensions || []).map((d) => ({
      key: d.key,
      label: d.label,
      bucket: d.bucket,
      status: d.jdEvidence?.status,
      value: d.jdEvidence?.value,
      provenance: d.jdEvidence?.provenance,
    })),
    engineOutputsSummary: {
      identity: record.isolatedAssessments?.identity?.seniorityFit,
      capability: record.isolatedAssessments?.capability?.score,
      career: record.isolatedAssessments?.career?.trajectoryFit,
      lifestyle: record.isolatedAssessments?.lifestyle?.compatibilityScore,
      shortlistingPotential: record.shortlistingPotential,
    },
    policyResult: {
      verdict: record.policyResult.verdict,
      vetoed: record.policyResult.vetoed,
      vetoReason: record.policyResult.vetoReason,
      triggeredRuleIds: record.policyResult.triggeredRuleIds,
      drivers: record.policyResult.decisionDrivers,
      risks: record.policyResult.decisionRisks,
    },
    briefText: brief ? JSON.stringify(brief.memory, null, 2) : "No brief generated",
    verbatimAuditSummary: {
      total: audits.length,
      grounded: audits.filter((a) => a.classification === "FACTUAL" || a.classification === "EVIDENCE-GROUNDED INFERENCE").length,
      unsupported: audits.filter((a) => a.classification === "UNSUPPORTED").length,
      contradictory: audits.filter((a) => a.classification === "CONTRADICTORY").length,
      generic: audits.filter((a) => a.classification === "GENERIC / LOW-VALUE").length,
    },
    contradictions: record.contradictions,
    objectiveScoreTotal: record.objectiveScores.totalObjectiveScore,
  };
}

export function compileHumanReviewPacket(records: SimulationRecord[]): HumanReviewCase[] {
  const packet: HumanReviewCase[] = [];

  // Cohort 1: 10 Strongest Outputs (Highest objective quality, pristine policy match)
  const strongest = [...records]
    .filter((r) => r.contradictions.length === 0 && r.gateResult.passed)
    .sort((a, b) => b.objectiveScores.totalObjectiveScore - a.objectiveScores.totalObjectiveScore)
    .slice(0, 10);
  strongest.forEach((r) => packet.push(mapRecordToReviewCase(r, "1. Strongest Outputs (High Grounding & Policy Fidelity)")));

  // Cohort 2: 10 Weakest Outputs (Lowest objective quality or failures)
  const weakest = [...records]
    .sort((a, b) => a.objectiveScores.totalObjectiveScore - b.objectiveScores.totalObjectiveScore)
    .slice(0, 10);
  weakest.forEach((r) => packet.push(mapRecordToReviewCase(r, "2. Weakest Outputs (Low Grounding or Failure Modes)")));

  // Cohort 3: 10 Most Contradictory Outputs (Cases with flagged contradictions)
  const contradictory = [...records]
    .filter((r) => r.contradictions.length > 0)
    .sort((a, b) => b.contradictions.length - a.contradictions.length)
    .slice(0, 10);
  // If fewer than 10 have contradictions, pad with highest risk/tension cases
  if (contradictory.length < 10) {
    const tension = records
      .filter((r) => !contradictory.includes(r) && r.policyResult.decisionRisks.length > 1)
      .slice(0, 10 - contradictory.length);
    contradictory.push(...tension);
  }
  contradictory.slice(0, 10).forEach((r) => packet.push(mapRecordToReviewCase(r, "3. Most Contradictory / High-Tension Cases")));

  // Cohort 4: 10 Highest-Scoring Cases (Top Shortlisting Potential)
  const highestScoring = [...records]
    .filter((r) => r.shortlistingPotential.score !== null)
    .sort((a, b) => (b.shortlistingPotential.score || 0) - (a.shortlistingPotential.score || 0))
    .slice(0, 10);
  highestScoring.forEach((r) => packet.push(mapRecordToReviewCase(r, "4. Highest-Scoring Opportunities")));

  // Cohort 5: 10 Lowest-Scoring Cases (Bottom Shortlisting Potential, excluding sparse specs)
  const lowestScoring = [...records]
    .filter((r) => r.gateResult.passed && r.shortlistingPotential.score !== null)
    .sort((a, b) => (a.shortlistingPotential.score || 0) - (b.shortlistingPotential.score || 0))
    .slice(0, 10);
  lowestScoring.forEach((r) => packet.push(mapRecordToReviewCase(r, "5. Lowest-Scoring Non-Sparse Opportunities")));

  // Cohort 6: 10 Highest-Risk Easy Traps (Career Regression / Lateral Trap)
  const easyTraps = [...records]
    .filter(
      (r) =>
        r.fitSpectrumBucket === "Career Regression / Easy Trap" ||
        r.policyResult.triggeredRuleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION") ||
        r.policyResult.trajectoryUpside === "Limited Career Upside"
    )
    .slice(0, 10);
  if (easyTraps.length < 10) {
    const moreTraps = records
      .filter((r) => !easyTraps.includes(r) && r.seniorityTier === "Senior Manager")
      .slice(0, 10 - easyTraps.length);
    easyTraps.push(...moreTraps);
  }
  easyTraps.slice(0, 10).forEach((r) => packet.push(mapRecordToReviewCase(r, "6. Highest-Risk Easy Traps (Career Regression)")));

  // Cohort 7: 10 Strongest PASS Decisions
  const strongestPass = [...records]
    .filter((r) => r.policyResult.verdict === "PASS")
    .sort((a, b) => b.objectiveScores.totalObjectiveScore - a.objectiveScores.totalObjectiveScore)
    .slice(0, 10);
  strongestPass.forEach((r) => packet.push(mapRecordToReviewCase(r, "7. Strongest PASS Decisions")));

  // Cohort 8: 10 Strongest CONSIDER Decisions
  const strongestConsider = [...records]
    .filter((r) => r.policyResult.verdict === "CONSIDER")
    .sort((a, b) => b.objectiveScores.totalObjectiveScore - a.objectiveScores.totalObjectiveScore)
    .slice(0, 10);
  strongestConsider.forEach((r) => packet.push(mapRecordToReviewCase(r, "8. Strongest CONSIDER Decisions")));

  return packet;
}
