import { getRepositories } from "../../../src/data/sqlite/provider";
import type { DetailedCard } from "../types";
import { KnowledgeGraphBuilder } from "../../../src/lib/intelligence/KnowledgeGraphBuilder";
import { KnowledgeGraphIngestService } from "../../../src/lib/intelligence/KnowledgeGraphIngestService";
import type { KnowledgeGraphBuildReport } from "../../../src/lib/intelligence/KnowledgeGraphBuilder";

import type { StorageProvider } from "../../../src/domain/repositories";
import { getDatabaseAdapter, type DatabaseAdapter } from "../../../src/data/database";

export async function ingestIntoSqlite(
  card: DetailedCard, 
  extractionJson: string, 
  extractorVersion: string,
  persist: boolean = true,
  repos?: StorageProvider,
  resolvedCanonicalId?: string,
  adapter?: DatabaseAdapter,
  runId?: string
): Promise<KnowledgeGraphBuildReport> {

  let parsedExtraction;
  try {
    parsedExtraction = JSON.parse(extractionJson);
  } catch (e) {
    return {
      companiesCreated: 0,
      companiesMatched: 0,
      opportunitiesCreated: 0,
      documentsCreated: 0,
      factsCreated: 0,
      duplicateFacts: 0,
      skippedFacts: 0,
      warnings: ["Failed to parse extraction JSON"]
    };
  }

  // 1. Domain Object Construction (No persistence knowledge)
  const builder = new KnowledgeGraphBuilder();
  const { graph, report } = builder.build(card, parsedExtraction, runId, extractorVersion, resolvedCanonicalId);

  if (!persist) {
    // Dry Run Mode: Just validate and return what *would* have been built
    report.warnings.push("DRY RUN: SQLite persistence skipped.");
    return report;
  }

  // 2. Ingestion & Idempotency (Talks to SQLite)
  const actualRepos = repos ?? getRepositories();
  // Canonical admission and its legacy knowledge-graph projection are separate
  // stores. A missing projection is repairable only with exact persisted proof.
  let verifiedAdmissionId: string | undefined;
  const binding = card.evaluationEvidence;
  // Blob payloads retain the immutable identity tuple but older writers did
  // not persist the UI-only `state` marker. Treat the complete tuple itself
  // as bound evidence, then verify it exactly against canonical storage.
  if (binding?.canonicalJobId && binding.opportunityVersion && binding.contentHash) {
    if (!resolvedCanonicalId || binding.canonicalJobId !== resolvedCanonicalId) {
      throw new Error('ENRICHMENT_CANONICAL_ADMISSION_MISMATCH');
    }
    const admitted = await (adapter || getDatabaseAdapter()).one<{id:string}>(
      `SELECT ov.id FROM opportunity_versions ov JOIN canonical_opportunities co ON co.id=ov.canonical_job_id
       WHERE co.id=? AND ov.id=? AND ov.content_hash=?`,
      [resolvedCanonicalId,binding.opportunityVersion,binding.contentHash]
    );
    if (!admitted) throw new Error('ENRICHMENT_CANONICAL_ADMISSION_MISMATCH');
    verifiedAdmissionId = resolvedCanonicalId;
  }
  const service = new KnowledgeGraphIngestService(actualRepos, verifiedAdmissionId);
  
  const finalReport = await service.ingest(graph, report, resolvedCanonicalId);

  // 3. Telemetry: OpportunityDiscovery
  // In a real run, executionId is passed down. For now, if we found new opportunities, log their discovery.
  if (finalReport.opportunitiesCreated > 0) {
    try {
      const opp = graph.opportunity;
      actualRepos.acquisition.logDiscovery({
        id: "disc_" + Math.random().toString(36).substring(2, 9),
        opportunityId: opp.id,
        executionId: "exec_unknown", // Stub until ExecutionPlan is fully wired
        sourceName: card.portal,
        firstPortal: card.portal,
        firstDefinition: card.keyword || "unknown_definition"
      });
    } catch (err) {
      console.warn("Failed to log OpportunityDiscovery:", err);
    }
  }
  
  return finalReport;
}
