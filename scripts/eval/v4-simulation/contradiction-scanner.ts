/**
 * scripts/eval/v4-simulation/contradiction-scanner.ts
 *
 * Contradiction & Policy Authority Invariant Scanner for RADAR V4 Phase 8.
 * Detects policy/editorial divergence, career risk suppression, domain mismatch suppression,
 * mandate gap suppression, and sparse spec false confidence.
 */

import type { SimulationRecord, ContradictionFinding } from "./types";

export function scanContradictions(record: SimulationRecord): ContradictionFinding[] {
  const findings: ContradictionFinding[] = [];
  const policyVerdict = record.policyResult.verdict;
  const brief = record.briefModel;
  const briefDecision = brief?.memory?.decision;
  const presentedDecision = (record.presented as any)?.opportunity?.engineRecommendation?.action;

  // 1. Policy Authority Invariant: Policy Verdict -> Record -> Presented -> Brief Memory Decision
  if (briefDecision && briefDecision !== policyVerdict) {
    findings.push({
      jobHash: record.jobHash,
      type: "POLICY_AUTHORITY_MUTATION",
      severity: "CRITICAL",
      details: `Policy Verdict (${policyVerdict}) was mutated in Brief Memory (${briefDecision})`,
      policyVerdict,
      editorialSnippet: brief?.memory?.headline || "",
    });
  }

  if (presentedDecision && presentedDecision !== policyVerdict) {
    findings.push({
      jobHash: record.jobHash,
      type: "POLICY_AUTHORITY_MUTATION",
      severity: "CRITICAL",
      details: `Policy Verdict (${policyVerdict}) was mutated in Presented Opportunity (${presentedDecision})`,
      policyVerdict,
      editorialSnippet: `engineRecommendation.action: ${presentedDecision}`,
    });
  }

  // 2. Policy vs Editorial Language Mismatch
  if (brief) {
    const briefText = JSON.stringify(brief).toLowerCase();

    if (policyVerdict === "PASS") {
      if (
        briefText.includes("strong pursue recommendation") ||
        briefText.includes("proceed immediately") ||
        briefText.includes("high-priority opportunity")
      ) {
        findings.push({
          jobHash: record.jobHash,
          type: "POLICY_VS_EDITORIAL_VERDICT",
          severity: "CRITICAL",
          details: "Policy is PASS but editorial text contains enthusiastic PURSUE language.",
          policyVerdict,
          editorialSnippet: brief.memory.headline || brief.memory.recommendedAction,
        });
      }
    }

    if (policyVerdict === "PURSUE") {
      if (
        briefText.includes("strategic pass") ||
        briefText.includes("do not apply") ||
        briefText.includes("pass on this opportunity")
      ) {
        findings.push({
          jobHash: record.jobHash,
          type: "POLICY_VS_EDITORIAL_VERDICT",
          severity: "CRITICAL",
          details: "Policy is PURSUE but editorial text contains PASS recommendations.",
          policyVerdict,
          editorialSnippet: brief.memory.headline || brief.memory.recommendedAction,
        });
      }
    }

    // 3. Career Regression / Easy Trap Suppression
    const isEasyTrap =
      record.policyResult.triggeredRuleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION") ||
      record.policyResult.vetoReason === "R-CONSIDER-CAREER-VALUE-PROTECTION" ||
      record.policyResult.trajectoryUpside === "Limited Career Upside";

    if (isEasyTrap) {
      const mentionsTradeoff =
        brief.memory.tradeoff?.toLowerCase().includes("career value") ||
        brief.memory.tradeoff?.toLowerCase().includes("velocity") ||
        brief.memory.tradeoff?.toLowerCase().includes("lateral") ||
        brief.memory.primaryRisk?.toLowerCase().includes("scope") ||
        brief.memory.primaryRisk?.toLowerCase().includes("step-up");

      if (!mentionsTradeoff && briefText.includes("career acceleration")) {
        findings.push({
          jobHash: record.jobHash,
          type: "CAREER_REGRESSION_SUPPRESSION",
          severity: "HIGH",
          details: "Career regression policy rule triggered, but editorial claims career acceleration without flagging step-up limits.",
          policyVerdict,
          editorialSnippet: brief.memory.tradeoff || brief.memory.primaryOpportunity,
        });
      }
    }

    // 4. Domain Mismatch Suppression
    const isDomainMismatch =
      record.policyResult.triggeredRuleIds.includes("R-PASS-DOMAIN-MISMATCH") ||
      record.policyResult.vetoReason === "R-PASS-DOMAIN-MISMATCH" ||
      record.fitSpectrumBucket === "Domain Mismatch";

    if (isDomainMismatch && policyVerdict === "PASS") {
      if (briefText.includes("exceptional capability alignment") && !briefText.includes("domain mismatch") && !briefText.includes("non-commercial")) {
        findings.push({
          jobHash: record.jobHash,
          type: "DOMAIN_MISMATCH_SUPPRESSION",
          severity: "HIGH",
          details: "Domain mismatch identified, but editorial fails to clearly state domain misalignment.",
          policyVerdict,
          editorialSnippet: brief.memory.retentionSentence || brief.memory.headline,
        });
      }
    }

    // 5. Sparse Spec False Confidence
    if (!record.gateResult.passed) {
      if (brief.certaintyLevel === "HIGH" || brief.evidenceQuality === "High Evidence Quality") {
        findings.push({
          jobHash: record.jobHash,
          type: "SPARSE_SPEC_FALSE_CONFIDENCE",
          severity: "HIGH",
          details: "Job is SPARSE_SPEC but editorial reports HIGH certainty / High Evidence Quality.",
          policyVerdict,
          editorialSnippet: `certaintyLevel: ${brief.certaintyLevel}, evidenceQuality: ${brief.evidenceQuality}`,
        });
      }
    }
  }

  return findings;
}
