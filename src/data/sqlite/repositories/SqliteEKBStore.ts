// src/data/sqlite/repositories/SqliteEKBStore.ts

import type { DatabaseAdapter } from "../../database/adapter";

export interface EKBPublishedVersionRecord {
  id: string;
  major: number;
  minor: number;
  patch: number;
  status: string;
  quality_report_json: string;
  promoted_by?: string;
  published_at?: string;
}

export interface EKBPublishedCapabilityRecord {
  id: string;
  version_id: string;
  canonical_name: string;
  domain_id: string;
  discipline_id: string;
  description?: string;
}

export interface EKBTemporalEvidenceRecord {
  id: string;
  capability_id: string;
  year_month: string;
  cv_frequency: number;
  jd_frequency: number;
  recruiter_frequency: number;
  extraction_confidence: number;
  evidence_confidence: number;
}

export class SqliteEKBStore {
  constructor(private db: DatabaseAdapter) {}

  public async publishVersion(version: EKBPublishedVersionRecord): Promise<void> {
    const sql = `
      INSERT INTO ekb_published_versions (id, major, minor, patch, status, quality_report_json, promoted_by, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        status = EXCLUDED.status,
        quality_report_json = EXCLUDED.quality_report_json,
        published_at = CURRENT_TIMESTAMP
    `;
    await this.db.execute(sql, [
      version.id,
      version.major,
      version.minor,
      version.patch,
      version.status,
      version.quality_report_json,
      version.promoted_by || "COMPILER_AUTO_PROMOTION",
    ]);
  }

  public async saveCapability(cap: EKBPublishedCapabilityRecord): Promise<void> {
    const sql = `
      INSERT INTO ekb_published_capabilities (id, version_id, canonical_name, domain_id, discipline_id, description)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_name = EXCLUDED.canonical_name,
        domain_id = EXCLUDED.domain_id,
        discipline_id = EXCLUDED.discipline_id,
        description = EXCLUDED.description
    `;
    await this.db.execute(sql, [
      cap.id,
      cap.version_id,
      cap.canonical_name,
      cap.domain_id,
      cap.discipline_id,
      cap.description || null,
    ]);
  }

  public async saveAlias(id: string, versionId: string, capabilityId: string, aliasTerm: string, normalizedStem: string): Promise<void> {
    const sql = `
      INSERT INTO ekb_published_aliases (id, version_id, capability_id, alias_term, normalized_stem)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        alias_term = EXCLUDED.alias_term,
        normalized_stem = EXCLUDED.normalized_stem
    `;
    await this.db.execute(sql, [id, versionId, capabilityId, aliasTerm, normalizedStem]);
  }

  public async saveTemporalEvidence(evidence: EKBTemporalEvidenceRecord): Promise<void> {
    const sql = `
      INSERT INTO ekb_temporal_evidence (id, capability_id, year_month, cv_frequency, jd_frequency, recruiter_frequency, extraction_confidence, evidence_confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cv_frequency = cv_frequency + EXCLUDED.cv_frequency,
        jd_frequency = jd_frequency + EXCLUDED.jd_frequency,
        recruiter_frequency = recruiter_frequency + EXCLUDED.recruiter_frequency,
        updated_at = CURRENT_TIMESTAMP
    `;
    await this.db.execute(sql, [
      evidence.id,
      evidence.capability_id,
      evidence.year_month,
      evidence.cv_frequency,
      evidence.jd_frequency,
      evidence.recruiter_frequency,
      evidence.extraction_confidence,
      evidence.evidence_confidence,
    ]);
  }

  public async getLatestPublishedVersion(): Promise<EKBPublishedVersionRecord | null> {
    const sql = `SELECT * FROM ekb_published_versions WHERE status = 'PUBLISHED' ORDER BY major DESC, minor DESC, patch DESC LIMIT 1`;
    return await this.db.one<EKBPublishedVersionRecord>(sql);
  }

  public async getCapabilitiesForVersion(versionId: string): Promise<EKBPublishedCapabilityRecord[]> {
    const sql = `SELECT * FROM ekb_published_capabilities WHERE version_id = ?`;
    return await this.db.many<EKBPublishedCapabilityRecord>(sql, [versionId]);
  }
}
