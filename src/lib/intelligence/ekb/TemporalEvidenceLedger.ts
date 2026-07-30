// src/lib/intelligence/ekb/TemporalEvidenceLedger.ts

import type { EKBTemporalEvidenceRecord, SqliteEKBStore } from "../../../data/sqlite/repositories/SqliteEKBStore";

export class TemporalEvidenceLedger {

  public static getCurrentYearMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  public static async recordEvidenceObservation(
    store: SqliteEKBStore,
    capabilityId: string,
    sourceType: "CANDIDATE_CV" | "JOB_DESCRIPTION" | "RECRUITER_FEEDBACK",
    extractionConfidence: number = 0.95
  ): Promise<void> {
    const yearMonth = this.getCurrentYearMonth();
    const id = `ev_${capabilityId}_${yearMonth}`;

    const record: EKBTemporalEvidenceRecord = {
      id,
      capability_id: capabilityId,
      year_month: yearMonth,
      cv_frequency: sourceType === "CANDIDATE_CV" ? 1 : 0,
      jd_frequency: sourceType === "JOB_DESCRIPTION" ? 1 : 0,
      recruiter_frequency: sourceType === "RECRUITER_FEEDBACK" ? 1 : 0,
      extraction_confidence: extractionConfidence,
      evidence_confidence: 0.90,
    };

    try {
      await store.saveTemporalEvidence(record);
    } catch (err) {
      console.warn("[TemporalEvidenceLedger] Failed to log temporal evidence:", err);
    }
  }
}
