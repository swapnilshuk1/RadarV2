// src/lib/intelligence/ekb/EKBKnowledgeContract.ts

import { EKBQualityReport, EKBQualityMetricsEngine } from "./EKBQualityMetrics";

export interface KnowledgeContractValidationResult {
  versionId: string;
  report: EKBQualityReport;
  contractSatisfied: boolean;
  promotionGateStatus: "PROMOTED" | "REJECTED_GATED";
  auditSummary: string;
}

export class EKBKnowledgeContract {
  public static validatePromotionGate(
    versionId: string,
    capabilitiesCount: number,
    relationshipCount: number,
    observedTermsCount: number
  ): KnowledgeContractValidationResult {
    const report = EKBQualityMetricsEngine.computeMetrics(
      versionId,
      capabilitiesCount,
      relationshipCount,
      observedTermsCount
    );

    const contractSatisfied = report.passed;
    const promotionGateStatus = contractSatisfied ? "PROMOTED" : "REJECTED_GATED";

    const auditSummary = contractSatisfied
      ? `Knowledge Contract SATISFIED for release ${versionId}. Coverage: ${(report.coverageRatio * 100).toFixed(1)}%, Confidence: ${(report.avgEvidenceConfidence * 100).toFixed(1)}%.`
      : `Knowledge Contract REJECTED for release ${versionId}. Warnings: ${report.diagnosticsWarnings.join("; ")}`;

    return {
      versionId,
      report,
      contractSatisfied,
      promotionGateStatus,
      auditSummary,
    };
  }
}
