import type { StorageProvider } from "../../domain/repositories";
import type { KnowledgeGraph, KnowledgeGraphBuildReport } from "./KnowledgeGraphBuilder";

export class KnowledgeGraphIngestService {
  constructor(private repos: StorageProvider) {}

  /**
   * Persists a validated Knowledge Graph into the canonical SQLite stores.
   * Handles idempotency, duplicate detection, and lifecycle supersession.
   */
  public async ingest(graph: KnowledgeGraph, initialReport: KnowledgeGraphBuildReport): Promise<KnowledgeGraphBuildReport> {
    const report = { ...initialReport };

    // 1. Source
    // Source idempotency is handled by the repository ON CONFLICT DO UPDATE
    await this.repos.sources.recordSource(graph.source);

    // 2. Company
    // We check if it already exists to report on it
    const existingCompany = await this.repos.companies.findByName(graph.company.name);
    if (existingCompany) {
      report.companiesCreated = 0;
      report.companiesMatched = 1;
      // Use existing ID to prevent duplication
      graph.company.id = existingCompany.id;
      graph.opportunity.companyId = existingCompany.id;
    } else {
      await this.repos.companies.registerCompany(graph.company);
    }

    // 3. Opportunity
    const existingOps = await this.repos.opportunities.findOpportunities({ companyId: graph.company.id });
    const existingOp = existingOps.find(o => o.fingerprint === graph.opportunity.fingerprint);
    if (existingOp) {
      report.opportunitiesCreated = 0;
      graph.opportunity.id = existingOp.id;
      // Inherit the lifecycle if it was already verified
      if (existingOp.lifecycle === "Verified") {
        graph.opportunity.lifecycle = "Verified";
      }
    }
    await this.repos.opportunities.mergeOpportunity(graph.opportunity);
    
    // Fix foreign keys on child objects if opportunity ID changed
    graph.document.opportunityId = graph.opportunity.id;
    graph.facts.forEach(f => f.opportunityId = graph.opportunity.id);

    // 4. Document
    // Documents are technically immutable logs of a point-in-time capture.
    await this.repos.acquisition.recordDocument(graph.document);

    // 5. Evidence & Facts
    // Idempotency: We check if the exact same fact (by ID, which is a deterministic hash)
    // already exists in SQLite. We don't fetch all facts, we rely on the DB constraints or 
    // fetch them for the opportunity to calculate dupes.
    
    const existingFacts = await this.repos.knowledge.findFactsForOpportunity(graph.opportunity.id);
    const existingFactIds = new Set(existingFacts.map(f => f.id));
    
    let newFactsCount = 0;
    let dupFactsCount = 0;
    
    const factsToInsert = [];

    for (const fact of graph.facts) {
      if (existingFactIds.has(fact.id)) {
        dupFactsCount++;
      } else {
        newFactsCount++;
        factsToInsert.push(fact);
      }
    }

    report.factsCreated = newFactsCount;
    report.duplicateFacts = dupFactsCount;

    if (graph.evidence.length > 0) {
      await this.repos.knowledge.recordEvidence(graph.evidence);
    }
    
    if (factsToInsert.length > 0) {
      await this.repos.knowledge.recordFacts(factsToInsert);
    }

    return report;
  }
}
