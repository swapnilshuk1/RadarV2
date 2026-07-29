import type { DatabaseAdapter } from "../../database/adapter";
import type { EvidenceGraph } from "../../../domain/evidence";

export interface CandidateDocumentRecord {
  id: string;
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

export class SqliteDocumentStore {
  constructor(private db: DatabaseAdapter) {}

  async saveDocument(doc: CandidateDocumentRecord): Promise<void> {
    await this.db.execute(
      `
      INSERT INTO candidate_documents (
        id, person_id, filename, storage_uri, mime_type, document_hash, status, stage, error_message, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        filename = excluded.filename,
        storage_uri = excluded.storage_uri,
        status = excluded.status,
        stage = excluded.stage,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
      `,
      [
        doc.id,
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
  }

  async updateDocumentStage(id: string, stage: string, status: CandidateDocumentRecord["status"], errorMessage?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `UPDATE candidate_documents SET stage = ?, status = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      [stage, status, errorMessage || null, now, id]
    );
  }

  async getDocument(id: string): Promise<CandidateDocumentRecord | undefined> {
    const row = await this.db.one<any>(`SELECT * FROM candidate_documents WHERE id = ?`, [id]);
    if (!row) return undefined;
    return {
      id: row.id,
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

  async getLatestDocumentForPerson(personId: string): Promise<CandidateDocumentRecord | undefined> {
    const row = await this.db.one<any>(
      `SELECT * FROM candidate_documents WHERE person_id = ? ORDER BY created_at DESC LIMIT 1`,
      [personId]
    );
    if (!row) return undefined;
    return {
      id: row.id,
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

  async saveEvidenceGraph(graph: EvidenceGraph): Promise<void> {
    const graphJson = JSON.stringify(graph);
    await this.db.execute(
      `
      INSERT INTO evidence_graphs (
        id, person_id, document_id, graph_json, extractor_version, prompt_version, model, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        graph.id,
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

  async getLatestEvidenceGraph(personId: string): Promise<EvidenceGraph | undefined> {
    const row = await this.db.one<any>(
      `SELECT graph_json FROM evidence_graphs WHERE person_id = ? ORDER BY created_at DESC LIMIT 1`,
      [personId]
    );
    if (!row || !row.graph_json) return undefined;
    try {
      return JSON.parse(row.graph_json) as EvidenceGraph;
    } catch {
      return undefined;
    }
  }

  async getEvidenceGraphForDocument(documentId: string): Promise<EvidenceGraph | undefined> {
    const row = await this.db.one<any>(
      `SELECT graph_json FROM evidence_graphs WHERE document_id = ? ORDER BY created_at DESC LIMIT 1`,
      [documentId]
    );
    if (!row || !row.graph_json) return undefined;
    try {
      return JSON.parse(row.graph_json) as EvidenceGraph;
    } catch {
      return undefined;
    }
  }
}
