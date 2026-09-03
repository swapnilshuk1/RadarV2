import type { DatabaseAdapter } from "../../database/adapter";
import type {
  AcquisitionStore,
  AcquisitionLedgerItem,
  AcquisitionIngestionLineage,
} from "../../../domain/repositories";
import type { Document } from "../../../domain/entities";

export class SqliteAcquisitionStore implements AcquisitionStore {
  private tableChecked = false;

  constructor(private db: DatabaseAdapter) {}

  private async ensureTableExists(): Promise<void> {
    if (this.tableChecked) return;
    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS acquisition_ledger (
          id TEXT PRIMARY KEY,
          canonical_job_id TEXT NOT NULL,
          source_portal TEXT NOT NULL,
          source_job_id TEXT NOT NULL,
          canonical_url TEXT NOT NULL,
          title TEXT NOT NULL,
          company_name TEXT NOT NULL,
          location TEXT,
          state TEXT NOT NULL DEFAULT 'DISCOVERED',
          terminal_state TEXT,
          claimed_by TEXT,
          claimed_at TEXT,
          lease_expires_at TEXT,
          attempt_count INTEGER DEFAULT 0,
          last_failure_class TEXT,
          last_acquisition_method TEXT,
          acquisition_quality TEXT,
          validation_confidence TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          last_acquired_at TEXT,
          freshness_state TEXT DEFAULT 'NEW',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CONSTRAINT uq_portal_canonical UNIQUE (source_portal, canonical_job_id)
        );
      `);
      this.tableChecked = true;
    } catch (err: any) {
      console.warn("⚠️ [SqliteAcquisitionStore] ensureTableExists warning:", err.message);
    }
  }

  async recordDocument(document: Document): Promise<void> {
    await this.db.execute(
      `
      INSERT INTO documents (
        id, source_id, opportunity_id, payload_type, content, lifecycle,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        lifecycle = excluded.lifecycle,
        updated_at = excluded.updated_at
      `,
      [
        document.id,
        document.sourceId,
        document.opportunityId ?? null,
        document.payloadType,
        document.content,
        document.lifecycle,
        document.createdAt,
        document.updatedAt,
        document.provenance.schemaVersion,
        document.provenance.extractorVersion ?? null,
        document.provenance.promptVersion ?? null,
        document.provenance.model ?? null,
        document.provenance.runId ?? null,
        document.provenance.timestamp
      ]
    );
  }

  async logDiscovery(discovery: {
    id: string;
    opportunityId: string;
    executionId: string;
    sourceName: string;
    firstPortal: string;
    firstDefinition: string;
  }): Promise<void> {
    await this.db.execute(
      `
      INSERT OR IGNORE INTO opportunity_discoveries 
      (id, opportunity_id, execution_id, source_name, first_portal, first_definition) 
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        discovery.id,
        discovery.opportunityId,
        discovery.executionId,
        discovery.sourceName,
        discovery.firstPortal,
        discovery.firstDefinition
      ]
    );
  }

  async upsertDiscoveredJob(
    item: Omit<AcquisitionLedgerItem, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): Promise<AcquisitionLedgerItem> {
    await this.ensureTableExists();
    const now = new Date().toISOString();
    const id = item.id || `acq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    await this.db.execute(
      `
      INSERT INTO acquisition_ledger (
        id, canonical_job_id, source_portal, source_job_id, canonical_url, title, company_name, location,
        state, terminal_state, claimed_by, claimed_at, lease_expires_at, attempt_count,
        last_failure_class, last_acquisition_method, acquisition_quality, validation_confidence,
        first_seen_at, last_seen_at, last_acquired_at, freshness_state, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_portal, canonical_job_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        title = excluded.title,
        company_name = excluded.company_name,
        location = COALESCE(excluded.location, location),
        updated_at = excluded.updated_at
      `,
      [
        id,
        item.canonicalJobId,
        item.sourcePortal,
        item.sourceJobId,
        item.canonicalUrl,
        item.title,
        item.companyName,
        item.location ?? null,
        item.state || "QUEUED",
        item.terminalState ?? null,
        item.claimedBy ?? null,
        item.claimedAt ?? null,
        item.leaseExpiresAt ?? null,
        item.attemptCount ?? 0,
        item.lastFailureClass ?? null,
        item.lastAcquisitionMethod ?? null,
        item.acquisitionQuality ?? null,
        item.validationConfidence ?? null,
        item.firstSeenAt || now,
        item.lastSeenAt || now,
        item.lastAcquiredAt ?? null,
        item.freshnessState || "NEW",
        now,
        now
      ]
    );

    const existing = await this.getLedgerItemByCanonicalId(item.sourcePortal, item.canonicalJobId);
    return existing!;
  }

  async getLedgerItemByCanonicalId(
    sourcePortal: string,
    canonicalJobId: string
  ): Promise<AcquisitionLedgerItem | undefined> {
    await this.ensureTableExists();
    const row = await this.db.one<any>(
      `SELECT * FROM acquisition_ledger WHERE source_portal = ? AND canonical_job_id = ?`,
      [sourcePortal, canonicalJobId]
    );
    if (!row) return undefined;
    return this.mapLedgerRow(row);
  }

  async claimQueuedJobs(
    workerId: string,
    limit = 10,
    leaseMs = 300000 // 5 minutes
  ): Promise<AcquisitionLedgerItem[]> {
    await this.ensureTableExists();
    const now = new Date();
    const leaseExpiry = new Date(now.getTime() + leaseMs).toISOString();
    const nowIso = now.toISOString();

    // Reclaim expired leases first
    await this.reclaimExpiredLeases();

    // Select candidate QUEUED jobs
    const candidateRows = await this.db.many<any>(
      `
      SELECT id FROM acquisition_ledger
      WHERE state = 'QUEUED' AND terminal_state IS NULL
      ORDER BY created_at ASC
      LIMIT ?
      `,
      [limit]
    );

    if (!candidateRows || candidateRows.length === 0) return [];

    const claimedItems: AcquisitionLedgerItem[] = [];

    for (const row of candidateRows) {
      await this.db.execute(
        `
        UPDATE acquisition_ledger
        SET state = 'CLAIMED',
            claimed_by = ?,
            claimed_at = ?,
            lease_expires_at = ?,
            attempt_count = attempt_count + 1,
            updated_at = ?
        WHERE id = ? AND state = 'QUEUED'
        `,
        [workerId, nowIso, leaseExpiry, nowIso, row.id]
      );

      const updated = await this.db.one<any>(`SELECT * FROM acquisition_ledger WHERE id = ?`, [row.id]);
      if (updated) {
        claimedItems.push(this.mapLedgerRow(updated));
      }
    }

    return claimedItems;
  }

  async updateJobState(id: string, updates: Partial<AcquisitionLedgerItem>): Promise<void> {
    await this.ensureTableExists();
    const now = new Date().toISOString();
    const fields: string[] = ["updated_at = ?"];
    const params: any[] = [now];

    if (updates.state !== undefined) {
      fields.push("state = ?");
      params.push(updates.state);
    }
    if (updates.terminalState !== undefined) {
      fields.push("terminal_state = ?");
      params.push(updates.terminalState);
    }
    if (updates.claimedBy !== undefined) {
      fields.push("claimed_by = ?");
      params.push(updates.claimedBy);
    }
    if (updates.claimedAt !== undefined) {
      fields.push("claimed_at = ?");
      params.push(updates.claimedAt);
    }
    if (updates.leaseExpiresAt !== undefined) {
      fields.push("lease_expires_at = ?");
      params.push(updates.leaseExpiresAt);
    }
    if (updates.lastFailureClass !== undefined) {
      fields.push("last_failure_class = ?");
      params.push(updates.lastFailureClass);
    }
    if (updates.lastAcquisitionMethod !== undefined) {
      fields.push("last_acquisition_method = ?");
      params.push(updates.lastAcquisitionMethod);
    }
    if (updates.acquisitionQuality !== undefined) {
      fields.push("acquisition_quality = ?");
      params.push(updates.acquisitionQuality);
    }
    if (updates.validationConfidence !== undefined) {
      fields.push("validation_confidence = ?");
      params.push(updates.validationConfidence);
    }
    if (updates.lastAcquiredAt !== undefined) {
      fields.push("last_acquired_at = ?");
      params.push(updates.lastAcquiredAt);
    }
    if (updates.freshnessState !== undefined) {
      fields.push("freshness_state = ?");
      params.push(updates.freshnessState);
    }

    params.push(id);
    await this.db.execute(`UPDATE acquisition_ledger SET ${fields.join(", ")} WHERE id = ?`, params);
  }

  async reclaimExpiredLeases(): Promise<number> {
    const nowIso = new Date().toISOString();
    const result = await this.db.execute(
      `
      UPDATE acquisition_ledger
      SET state = 'QUEUED',
          claimed_by = NULL,
          claimed_at = NULL,
          lease_expires_at = NULL,
          updated_at = ?
      WHERE state = 'CLAIMED' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
      `,
      [nowIso, nowIso]
    );
    return result.rowsAffected;
  }

  async recordIngestionLineage(
    item: Omit<AcquisitionIngestionLineage, "id" | "createdAt">
  ): Promise<AcquisitionIngestionLineage> {
    return this.db.transaction(async (tx) => {
      const runScope = await tx.one<{ id: string }>(
        `SELECT id FROM scrape_runs
         WHERE id = ? AND tenant_id = ? AND person_id = ?`,
        [item.scrapeRunId, item.tenantId, item.personId]
      );
      if (!runScope) {
        throw new Error(
          `[SqliteAcquisitionStore] scrape run ${item.scrapeRunId} does not belong to the supplied tenant/person scope.`
        );
      }

      const lineageId = `ing_lineage_${crypto.randomUUID()}`;
      await tx.execute(
        `INSERT INTO acquisition_ingestion_lineage (
           id, scrape_run_id, tenant_id, person_id, acquisition_ledger_id,
           card_id, ingestion_attempt, source_portal, source_job_id, source_url,
           capture_state, document_state, content_hash, canonical_job_id,
           opportunity_version, failure_class
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scrape_run_id, card_id, ingestion_attempt) DO NOTHING`,
        [
          lineageId,
          item.scrapeRunId,
          item.tenantId,
          item.personId,
          item.acquisitionLedgerId,
          item.cardId,
          item.ingestionAttempt,
          item.sourcePortal,
          item.sourceJobId,
          item.sourceUrl,
          item.captureState,
          item.documentState,
          item.contentHash ?? null,
          item.canonicalJobId ?? null,
          item.opportunityVersion ?? null,
          item.failureClass ?? null,
        ]
      );

      const row = await tx.one<any>(
        `SELECT * FROM acquisition_ingestion_lineage
         WHERE scrape_run_id = ? AND card_id = ? AND ingestion_attempt = ?`,
        [item.scrapeRunId, item.cardId, item.ingestionAttempt]
      );
      if (!row) {
        throw new Error("[SqliteAcquisitionStore] ingestion lineage insert was not readable after write.");
      }
      const existing = this.mapIngestionLineageRow(row);
      if (!this.matchesIngestionLineage(item, existing)) {
        throw new Error(
          `[SqliteAcquisitionStore] conflicting provenance for ${item.scrapeRunId}/${item.cardId} attempt ${item.ingestionAttempt}.`
        );
      }
      return existing;
    });
  }

  async listIngestionLineageForRun(
    tenantId: string,
    personId: string,
    scrapeRunId: string
  ): Promise<AcquisitionIngestionLineage[]> {
    const rows = await this.db.many<any>(
      `SELECT * FROM acquisition_ingestion_lineage
       WHERE tenant_id = ? AND person_id = ? AND scrape_run_id = ?
       ORDER BY created_at ASC, ingestion_attempt ASC`,
      [tenantId, personId, scrapeRunId]
    );
    return rows.map((row) => this.mapIngestionLineageRow(row));
  }

  private matchesIngestionLineage(
    expected: Omit<AcquisitionIngestionLineage, "id" | "createdAt">,
    actual: AcquisitionIngestionLineage
  ): boolean {
    return expected.scrapeRunId === actual.scrapeRunId
      && expected.tenantId === actual.tenantId
      && expected.personId === actual.personId
      && expected.acquisitionLedgerId === actual.acquisitionLedgerId
      && expected.cardId === actual.cardId
      && expected.ingestionAttempt === actual.ingestionAttempt
      && expected.sourcePortal === actual.sourcePortal
      && expected.sourceJobId === actual.sourceJobId
      && expected.sourceUrl === actual.sourceUrl
      && expected.captureState === actual.captureState
      && expected.documentState === actual.documentState
      && (expected.contentHash ?? undefined) === actual.contentHash
      && (expected.canonicalJobId ?? undefined) === actual.canonicalJobId
      && (expected.opportunityVersion ?? undefined) === actual.opportunityVersion
      && (expected.failureClass ?? undefined) === actual.failureClass;
  }

  private mapLedgerRow(row: any): AcquisitionLedgerItem {
    return {
      id: row.id,
      canonicalJobId: row.canonical_job_id,
      sourcePortal: row.source_portal,
      sourceJobId: row.source_job_id,
      canonicalUrl: row.canonical_url,
      title: row.title,
      companyName: row.company_name,
      location: row.location,
      state: row.state,
      terminalState: row.terminal_state,
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at,
      leaseExpiresAt: row.lease_expires_at,
      attemptCount: row.attempt_count,
      lastFailureClass: row.last_failure_class,
      lastAcquisitionMethod: row.last_acquisition_method,
      acquisitionQuality: row.acquisition_quality,
      validationConfidence: row.validation_confidence,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastAcquiredAt: row.last_acquired_at,
      freshnessState: row.freshness_state,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapIngestionLineageRow(row: any): AcquisitionIngestionLineage {
    return {
      id: row.id,
      scrapeRunId: row.scrape_run_id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      acquisitionLedgerId: row.acquisition_ledger_id,
      cardId: row.card_id,
      ingestionAttempt: row.ingestion_attempt,
      sourcePortal: row.source_portal,
      sourceJobId: row.source_job_id,
      sourceUrl: row.source_url,
      captureState: row.capture_state,
      documentState: row.document_state,
      contentHash: row.content_hash ?? undefined,
      canonicalJobId: row.canonical_job_id ?? undefined,
      opportunityVersion: row.opportunity_version ?? undefined,
      failureClass: row.failure_class ?? undefined,
      createdAt: row.created_at,
    };
  }
}
