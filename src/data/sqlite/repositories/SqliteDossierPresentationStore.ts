import type { DatabaseAdapter } from "../../database/adapter";
import {
  type CanonicalDossierPresentationV2,
  isCanonicalDossierPresentationV2,
} from "../../../lib/domain/dossier_presentation";

export interface DossierPresentationIdentity {
  readonly tenantId: string;
  readonly personId: string;
  readonly canonicalJobId: string;
  readonly opportunityVersion: string;
  readonly evaluationContextFingerprint: string;
  readonly presentationVersion?: string;
}

interface PresentationRow {
  tenant_id: string;
  person_id: string;
  canonical_job_id: string;
  opportunity_version: string;
  evaluation_context_fingerprint: string;
  presentation_version: string;
  source_evaluation_fingerprint: string | null;
  presentation_json: string;
  generated_at: string;
}

export class SqliteDossierPresentationStore {
  constructor(private readonly db: DatabaseAdapter) {}

  async savePresentation(
    presentation: CanonicalDossierPresentationV2,
    sourceEvaluationFingerprint: string | null = presentation.evaluation.fingerprint,
  ): Promise<void> {
    if (!isCanonicalDossierPresentationV2(presentation)) {
      throw new Error("Cannot save invalid CanonicalDossierPresentationV2");
    }

    const { identity } = presentation;
    const presentationVersion = presentation.schemaVersion; // "dossier-v2"
    const presentationJson = JSON.stringify(presentation);

    await this.db.execute(
      `INSERT INTO materialized_dossier_presentations (
        tenant_id,
        person_id,
        canonical_job_id,
        opportunity_version,
        evaluation_context_fingerprint,
        presentation_version,
        source_evaluation_fingerprint,
        presentation_json,
        generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (
        tenant_id,
        person_id,
        canonical_job_id,
        opportunity_version,
        evaluation_context_fingerprint,
        presentation_version
      ) DO UPDATE SET
        source_evaluation_fingerprint = excluded.source_evaluation_fingerprint,
        presentation_json = excluded.presentation_json,
        generated_at = excluded.generated_at`,
      [
        identity.tenantId,
        identity.personId,
        identity.canonicalJobId,
        identity.opportunityVersion,
        identity.evaluationContextFingerprint,
        presentationVersion,
        sourceEvaluationFingerprint,
        presentationJson,
        presentation.generatedAt,
      ],
    );
  }

  async getPresentation(
    identity: DossierPresentationIdentity,
    expectedEvaluationFingerprint: string | null,
  ): Promise<CanonicalDossierPresentationV2 | null> {
    const presentationVersion = identity.presentationVersion ?? "dossier-v2";

    const row = await this.db.one<PresentationRow>(
      `SELECT * FROM materialized_dossier_presentations
       WHERE tenant_id = ?
         AND person_id = ?
         AND canonical_job_id = ?
         AND opportunity_version = ?
         AND evaluation_context_fingerprint = ?
         AND presentation_version = ?`,
      [
        identity.tenantId,
        identity.personId,
        identity.canonicalJobId,
        identity.opportunityVersion,
        identity.evaluationContextFingerprint,
        presentationVersion,
      ],
    );

    if (!row) return null;

    // Exact nullable equality:
    // - If looking for a source-only presentation (expected is null), stored fingerprint must be null.
    // - If looking for an evaluated presentation (expected is string), stored fingerprint must match exactly.
    if (expectedEvaluationFingerprint === null) {
      if (row.source_evaluation_fingerprint !== null) return null;
    } else {
      if (row.source_evaluation_fingerprint !== expectedEvaluationFingerprint) {
        return null;
      }
    }

    try {
      const parsed: unknown = JSON.parse(row.presentation_json);
      if (!isCanonicalDossierPresentationV2(parsed)) {
        return null;
      }
      if (
        parsed.identity.tenantId !== identity.tenantId ||
        parsed.identity.personId !== identity.personId ||
        parsed.identity.canonicalJobId !== identity.canonicalJobId ||
        parsed.identity.opportunityVersion !== identity.opportunityVersion ||
        parsed.identity.evaluationContextFingerprint !== identity.evaluationContextFingerprint ||
        parsed.evaluation.fingerprint !== expectedEvaluationFingerprint
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async deletePresentation(identity: DossierPresentationIdentity): Promise<void> {
    const presentationVersion = identity.presentationVersion ?? "dossier-v2";
    await this.db.execute(
      `DELETE FROM materialized_dossier_presentations
       WHERE tenant_id = ?
         AND person_id = ?
         AND canonical_job_id = ?
         AND opportunity_version = ?
         AND evaluation_context_fingerprint = ?
         AND presentation_version = ?`,
      [
        identity.tenantId,
        identity.personId,
        identity.canonicalJobId,
        identity.opportunityVersion,
        identity.evaluationContextFingerprint,
        presentationVersion,
      ],
    );
  }
}
