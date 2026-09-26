import type { DatabaseAdapter } from "../../database/adapter";
import type { EvidenceGraph } from "../../../domain/evidence";
import type { AuthorizedPersonScope } from "../../../lib/security/auth";

export interface CandidateDocumentRecord {
  id: string;
  tenantId: string;
  personId: string;
  filename: string;
  storageUri: string;
  mimeType: string;
  documentHash: string;
  status: "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED";
  stage: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CareerIntentRecord {
  id?: string;
  personId: string;
  version?: number;
  currency?: "INR" | "USD" | "EUR" | "GBP";
  targetSalaryAmount?: number;
  minSalaryUsd?: number;
  normalizedSalaryUsd?: number | null;
  normalization?: {
    sourceCurrency: string;
    targetCurrency: "USD";
    rate: number;
    rateSource: string;
    effectiveAt: string;
  } | null;
  preferredLocations: string[];
  targetTitles: string[];
  preferredWorkModel?: "HYBRID" | "REMOTE" | "ON_SITE" | "ANY";
  travelTolerance?: "HIGH" | "MEDIUM" | "LOW";
  createdAt?: string;
}

export class SqliteDocumentStore {
  constructor(private db: DatabaseAdapter) {}

  private assertScope(scope: AuthorizedPersonScope, personId: string) {
    if (scope.personId !== personId) throw new Error("DOCUMENT_SCOPE_PERSON_MISMATCH");
  }

  async saveDocument(scope: AuthorizedPersonScope, doc: CandidateDocumentRecord): Promise<void> {
    this.assertScope(scope, doc.personId);
    if (scope.tenantId !== doc.tenantId) throw new Error("DOCUMENT_SCOPE_TENANT_MISMATCH");
    const result = await this.db.execute(
      `
      INSERT INTO candidate_documents (
        id, tenant_id, person_id, filename, storage_uri, mime_type, document_hash, status, stage, error_message, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        filename = excluded.filename,
        storage_uri = excluded.storage_uri,
        status = excluded.status,
        stage = excluded.stage,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
      WHERE candidate_documents.tenant_id = excluded.tenant_id AND candidate_documents.person_id = excluded.person_id
      `,
      [
        doc.id,
        scope.tenantId,
        doc.personId,
        doc.filename,
        doc.storageUri,
        doc.mimeType,
        doc.documentHash,
        doc.status,
        doc.stage,
        doc.errorMessage || null,
        doc.createdAt,
        doc.updatedAt
      ]
    );
    if (result.rowsAffected !== 1) {
      throw new Error(`DOCUMENT_OWNERSHIP_COLLISION: ${doc.id} is not owned by ${doc.personId}.`);
    }
  }

  async registerDocumentAndJob(scope: AuthorizedPersonScope, doc: CandidateDocumentRecord, job: { id: string; jobHash: string; payloadJson: string }): Promise<void> {
    this.assertScope(scope, doc.personId);
    if (scope.tenantId !== doc.tenantId) throw new Error("DOCUMENT_SCOPE_TENANT_MISMATCH");
    await this.db.transaction(async (tx) => {
      const saved = await tx.execute(`INSERT INTO candidate_documents (id, tenant_id, person_id, filename, storage_uri, mime_type, document_hash, status, stage, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [doc.id, scope.tenantId, scope.personId, doc.filename, doc.storageUri, doc.mimeType, doc.documentHash, doc.status, doc.stage, doc.errorMessage || null, doc.createdAt, doc.updatedAt]);
      if (saved.rowsAffected !== 1) throw new Error("DOCUMENT_REGISTRATION_FAILED");
      const queued = await tx.execute(`INSERT INTO candidate_document_jobs (id, tenant_id, person_id, document_id, job_hash, payload_json, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`, [job.id, scope.tenantId, scope.personId, doc.id, job.jobHash, job.payloadJson]);
      if (queued.rowsAffected !== 1) throw new Error("DOCUMENT_JOB_ENQUEUE_FAILED");
    });
  }

  async updateDocumentStage(scope: AuthorizedPersonScope, id: string, stage: string, status: CandidateDocumentRecord["status"], errorMessage?: string): Promise<void> {
    const now = new Date().toISOString();
    const result = await this.db.execute(
      `UPDATE candidate_documents SET stage = ?, status = ?, error_message = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND person_id = ?`,
      [stage, status, errorMessage || null, now, id, scope.tenantId, scope.personId]
    );
    if (result.rowsAffected !== 1) throw new Error(`DOCUMENT_STAGE_TRANSITION_FAILED: ${id}`);
  }

  async getDocument(scope: AuthorizedPersonScope, id: string): Promise<CandidateDocumentRecord | undefined> {
    const row = await this.db.one<any>(`SELECT * FROM candidate_documents WHERE id = ? AND tenant_id = ? AND person_id = ?`, [id, scope.tenantId, scope.personId]);
    if (!row) return undefined;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      filename: row.filename,
      storageUri: row.storage_uri,
      mimeType: row.mime_type,
      documentHash: row.document_hash,
      status: row.status,
      stage: row.stage,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getLatestDocumentForPerson(scope: AuthorizedPersonScope): Promise<CandidateDocumentRecord | undefined> {
    const row = await this.db.one<any>(
      `SELECT * FROM candidate_documents WHERE tenant_id = ? AND person_id = ? ORDER BY created_at DESC LIMIT 1`,
      [scope.tenantId, scope.personId]
    );
    if (!row) return undefined;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      filename: row.filename,
      storageUri: row.storage_uri,
      mimeType: row.mime_type,
      documentHash: row.document_hash,
      status: row.status,
      stage: row.stage,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async saveEvidenceGraph(scope: AuthorizedPersonScope, graph: EvidenceGraph): Promise<void> {
    this.assertScope(scope, graph.personId);
    const graphJson = JSON.stringify(graph);
    await this.db.execute(
      `
      INSERT INTO evidence_graphs (
        id, tenant_id, person_id, document_id, graph_json, extractor_version, prompt_version, model, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        graph.id,
        scope.tenantId,
        graph.personId,
        graph.provenance.documentId,
        graphJson,
        graph.provenance.extractorVersion,
        graph.provenance.promptVersion,
        graph.provenance.model,
        graph.provenance.createdAt
      ]
    );
  }

  async getLatestEvidenceGraph(scope: AuthorizedPersonScope): Promise<EvidenceGraph | undefined> {
    const row = await this.db.one<any>(
      `SELECT graph_json FROM evidence_graphs WHERE tenant_id = ? AND person_id = ? ORDER BY created_at DESC LIMIT 1`,
      [scope.tenantId, scope.personId]
    );
    if (!row || !row.graph_json) return undefined;
    try {
      return JSON.parse(row.graph_json) as EvidenceGraph;
    } catch {
      return undefined;
    }
  }

  async getEvidenceGraphForDocument(scope: AuthorizedPersonScope, documentId: string): Promise<EvidenceGraph | undefined> {
    const row = await this.db.one<any>(
      `SELECT graph_json FROM evidence_graphs WHERE document_id = ? AND tenant_id = ? AND person_id = ? ORDER BY created_at DESC LIMIT 1`,
      [documentId, scope.tenantId, scope.personId]
    );
    if (!row || !row.graph_json) return undefined;
    try {
      return JSON.parse(row.graph_json) as EvidenceGraph;
    } catch {
      return undefined;
    }
  }

  // --- document_contents methods ---

  async saveDocumentContent(scope: AuthorizedPersonScope, documentId: string, rawText: string, textHash: string): Promise<void> {
    const contentId = `content-${documentId}`;
    const result = await this.db.execute(
      `
        INSERT INTO document_contents (id, tenant_id, person_id, document_id, raw_text, text_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(document_id) DO UPDATE SET
        raw_text = excluded.raw_text,
        text_hash = excluded.text_hash
      WHERE document_contents.tenant_id = excluded.tenant_id
        AND document_contents.person_id = excluded.person_id
      `,
      [contentId, scope.tenantId, scope.personId, documentId, rawText, textHash]
    );
    if (result.rowsAffected !== 1) throw new Error(`DOCUMENT_OWNERSHIP_COLLISION: ${documentId} is outside the authorized scope.`);
  }

  async getDocumentContent(scope: AuthorizedPersonScope, documentId: string): Promise<{ rawText: string; textHash: string } | undefined> {
    const row = await this.db.one<any>(
      `SELECT raw_text, text_hash FROM document_contents WHERE document_id = ? AND tenant_id = ? AND person_id = ?`,
      [documentId, scope.tenantId, scope.personId]
    );
    if (!row) return undefined;
    return { rawText: row.raw_text, textHash: row.text_hash };
  }

  async findExistingEvidenceGraphByTextHash(scope: AuthorizedPersonScope, textHash: string): Promise<EvidenceGraph | undefined> {
    const row = await this.db.one<any>(
      `
      SELECT eg.graph_json 
      FROM document_contents dc
      JOIN evidence_graphs eg ON dc.document_id = eg.document_id
      WHERE dc.text_hash = ? AND eg.tenant_id = ? AND eg.person_id = ?
      ORDER BY eg.created_at DESC LIMIT 1
      `,
      [textHash, scope.tenantId, scope.personId]
    );
    if (!row || !row.graph_json) return undefined;
    try {
      return JSON.parse(row.graph_json) as EvidenceGraph;
    } catch {
      return undefined;
    }
  }

  // --- versioned career_intents methods (ADR-012) ---

  async saveCareerIntent(scope: AuthorizedPersonScope, intent: CareerIntentRecord): Promise<void> {
    this.assertScope(scope, intent.personId);
    const now = new Date().toISOString();
    
    // Get highest version for person
    await this.db.transaction(async (tx) => {
    const latest = await tx.one<any>(`SELECT version FROM career_intents WHERE tenant_id = ? AND person_id = ? ORDER BY version DESC LIMIT 1`, [scope.tenantId, intent.personId]);
    const nextVersion = (latest?.version || 0) + 1;
    const intentId = `intent-${intent.personId}-v${nextVersion}`;
    const saved = await tx.execute(
      `
      INSERT INTO career_intents (
        id, tenant_id, person_id, version, min_salary_usd, currency, target_salary_amount,
        normalized_salary_usd, normalization_source_currency, normalization_target_currency,
        normalization_rate, normalization_rate_source, normalization_effective_at,
        preferred_locations, target_titles, preferred_work_model, travel_tolerance, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        intentId,
        scope.tenantId,
        intent.personId,
        nextVersion,
        intent.minSalaryUsd ?? null,
        intent.currency ?? null,
        intent.targetSalaryAmount ?? null,
        intent.normalizedSalaryUsd ?? null,
        intent.normalization?.sourceCurrency ?? null,
        intent.normalization?.targetCurrency ?? null,
        intent.normalization?.rate ?? null,
        intent.normalization?.rateSource ?? null,
        intent.normalization?.effectiveAt ?? null,
        JSON.stringify(intent.preferredLocations || []),
        JSON.stringify(intent.targetTitles || []),
        intent.preferredWorkModel ?? null,
        intent.travelTolerance ?? null,
        now
      ]
    );
    if (saved.rowsAffected !== 1) throw new Error("CAREER_INTENT_SAVE_FAILED");
    });
  }

  async getLatestCareerIntent(scope: AuthorizedPersonScope): Promise<CareerIntentRecord | undefined> {
    const row = await this.db.one<any>(
      `SELECT * FROM career_intents WHERE tenant_id = ? AND person_id = ? ORDER BY version DESC LIMIT 1`,
      [scope.tenantId, scope.personId]
    );
    if (!row) return undefined;
    const locations: string[] = JSON.parse(row.preferred_locations || "[]");
    
    return {
      id: row.id,
      personId: row.person_id,
      version: row.version,
      currency: row.currency || undefined,
      targetSalaryAmount: row.target_salary_amount ?? undefined,
      minSalaryUsd: row.min_salary_usd ?? undefined,
      normalizedSalaryUsd: row.normalized_salary_usd ?? null,
      normalization: row.normalization_rate != null ? {
        sourceCurrency: row.normalization_source_currency,
        targetCurrency: row.normalization_target_currency,
        rate: row.normalization_rate,
        rateSource: row.normalization_rate_source,
        effectiveAt: row.normalization_effective_at,
      } : null,
      preferredLocations: locations,
      targetTitles: JSON.parse(row.target_titles || "[]"),
      preferredWorkModel: row.preferred_work_model ?? undefined,
      travelTolerance: row.travel_tolerance ?? undefined,
      createdAt: row.created_at
    };
  }

  async enqueueDocumentProcessing(scope: AuthorizedPersonScope, input: {
    id: string;
    documentId: string;
    jobHash: string;
    payloadJson: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO candidate_document_jobs (id, tenant_id, person_id, document_id, job_hash, payload_json, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(job_hash) DO NOTHING`,
        [input.id, scope.tenantId, scope.personId, input.documentId, input.jobHash, input.payloadJson],
      );
    });
  }
}
