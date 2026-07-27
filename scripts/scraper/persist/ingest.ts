import { getRepositories } from "../../../src/data/sqlite/provider";
import type { DetailedCard } from "../types";
import { KnowledgeGraphBuilder } from "../../../src/lib/intelligence/KnowledgeGraphBuilder";
import { KnowledgeGraphIngestService } from "../../../src/lib/intelligence/KnowledgeGraphIngestService";
import type { KnowledgeGraphBuildReport } from "../../../src/lib/intelligence/KnowledgeGraphBuilder";

export async function ingestIntoSqlite(
  card: DetailedCard, 
  extractionJson: string, 
  extractorVersion: string,
  persist: boolean = true
): Promise<KnowledgeGraphBuildReport> {
  
  const runId = "run_" + new Date().toISOString().split("T")[0]; // Stub run ID for now

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
  const { graph, report } = builder.build(card, parsedExtraction, runId, extractorVersion);

  if (!persist) {
    // Dry Run Mode: Just validate and return what *would* have been built
    report.warnings.push("DRY RUN: SQLite persistence skipped.");
    return report;
  }

  // 2. Ingestion & Idempotency (Talks to SQLite)
  const repos = getRepositories();
  const service = new KnowledgeGraphIngestService(repos);
  
  const finalReport = await service.ingest(graph, report);

  // 3. Telemetry: OpportunityDiscovery
  // In a real run, executionId is passed down. For now, if we found new opportunities, log their discovery.
  if (finalReport.opportunitiesCreated > 0) {
    try {
      const opp = graph.opportunity;
      repos.acquisition.logDiscovery({
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
