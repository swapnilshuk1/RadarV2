import type { DatabaseAdapter } from "@/data/database/adapter";
import type { BlobStore } from "@/lib/storage/blob-store";
import type {
  CandidateDocumentSourceRef,
  CanonicalSourceRef,
  OpportunityVersionSourceRef,
} from "@/lib/domain/source_provenance";

export type SourceSnapshotStorage = "DATABASE_TEXT" | "BLOB";

export interface ResolvedSourceSnapshot {
  readonly ref: CanonicalSourceRef;
  readonly storage: SourceSnapshotStorage;
  readonly mediaType: string;
  readonly bytes: Buffer;
  readonly text: string | null;
}

export class SourceSnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSnapshotUnavailableError";
  }
}

export class SourceSnapshotIdentityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSnapshotIdentityMismatchError";
  }
}

interface CandidateSourceRow {
  person_id: string;
  document_hash: string;
  mime_type: string;
  raw_text: string;
  text_hash: string;
}

interface OpportunitySourceRow {
  id: string;
  canonical_job_id: string;
  content_hash: string;
  raw_content: string;
  source_payload_key: string | null;
  source_media_type: string | null;
}

/**
 * Resolves only exact, already-persisted source identities. It never derives a
 * source from "latest" state, mutable profile state, or an implicit blob path.
 */
export class SourceSnapshotResolver {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly blobStore?: BlobStore,
  ) {}

  async captureCandidateDocumentRef(
    personId: string,
    documentId: string,
  ): Promise<CandidateDocumentSourceRef> {
    const row = await this.loadCandidateSource(personId, documentId);
    return {
      kind: "CANDIDATE_DOCUMENT_TEXT",
      personId,
      documentId,
      documentHash: row.document_hash,
      textHash: row.text_hash,
    };
  }

  async captureOpportunityVersionRef(
    canonicalJobId: string,
    opportunityVersion: string,
  ): Promise<OpportunityVersionSourceRef> {
    const row = await this.loadOpportunitySource(canonicalJobId, opportunityVersion);
    return {
      kind: "OPPORTUNITY_VERSION",
      canonicalJobId,
      opportunityVersion,
      contentHash: row.content_hash,
    };
  }

  async resolve(ref: CanonicalSourceRef): Promise<ResolvedSourceSnapshot> {
    if (ref.kind === "CANDIDATE_DOCUMENT_TEXT") {
      return this.resolveCandidateDocument(ref);
    }
    return this.resolveOpportunityVersion(ref);
  }

  private async resolveCandidateDocument(
    ref: CandidateDocumentSourceRef,
  ): Promise<ResolvedSourceSnapshot> {
    const row = await this.loadCandidateSource(ref.personId, ref.documentId);
    if (row.document_hash !== ref.documentHash || row.text_hash !== ref.textHash) {
      throw new SourceSnapshotIdentityMismatchError(
        `Candidate source identity mismatch for ${ref.personId}/${ref.documentId}.`,
      );
    }
    const bytes = Buffer.from(row.raw_text, "utf8");
    return {
      ref,
      storage: "DATABASE_TEXT",
      mediaType: "text/plain; charset=utf-8",
      bytes,
      text: row.raw_text,
    };
  }

  private async resolveOpportunityVersion(
    ref: OpportunityVersionSourceRef,
  ): Promise<ResolvedSourceSnapshot> {
    const row = await this.loadOpportunitySource(ref.canonicalJobId, ref.opportunityVersion);
    if (row.content_hash !== ref.contentHash) {
      throw new SourceSnapshotIdentityMismatchError(
        `Opportunity source identity mismatch for ${ref.canonicalJobId}/${ref.opportunityVersion}.`,
      );
    }

    if (row.source_payload_key) {
      if (!this.blobStore) {
        throw new SourceSnapshotUnavailableError(
          `BlobStore is required to resolve source payload ${row.source_payload_key}.`,
        );
      }
      const bytes = await this.blobStore.get(row.source_payload_key);
      if (!bytes) {
        throw new SourceSnapshotUnavailableError(
          `Source payload is unavailable in BlobStore: ${row.source_payload_key}`,
        );
      }
      return {
        ref,
        storage: "BLOB",
        mediaType: row.source_media_type || "application/octet-stream",
        bytes,
        text: null,
      };
    }

    const text = row.raw_content;
    return {
      ref,
      storage: "DATABASE_TEXT",
      mediaType: row.source_media_type || "text/plain; charset=utf-8",
      bytes: Buffer.from(text, "utf8"),
      text,
    };
  }

  private async loadCandidateSource(personId: string, documentId: string): Promise<CandidateSourceRow> {
    const row = await this.db.one<CandidateSourceRow>(
      `SELECT cd.person_id, cd.document_hash, cd.mime_type, dc.raw_text, dc.text_hash
       FROM candidate_documents cd
       JOIN document_contents dc ON dc.document_id = cd.id
       WHERE cd.id = ? AND cd.person_id = ?`,
      [documentId, personId],
    );
    if (!row) {
      throw new SourceSnapshotUnavailableError(
        `Candidate source snapshot is unavailable for ${personId}/${documentId}.`,
      );
    }
    return row;
  }

  private async loadOpportunitySource(
    canonicalJobId: string,
    opportunityVersion: string,
  ): Promise<OpportunitySourceRow> {
    const row = await this.db.one<OpportunitySourceRow>(
      `SELECT id, canonical_job_id, content_hash, raw_content, source_payload_key, source_media_type
       FROM opportunity_versions
       WHERE id = ? AND canonical_job_id = ?`,
      [opportunityVersion, canonicalJobId],
    );
    if (!row) {
      throw new SourceSnapshotUnavailableError(
        `Opportunity source snapshot is unavailable for ${canonicalJobId}/${opportunityVersion}.`,
      );
    }
    return row;
  }
}
