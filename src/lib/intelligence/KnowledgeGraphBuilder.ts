import type { 
  Company, Opportunity, Source, Document, Evidence, Fact, Provenance
} from "../../domain/entities";
import type { DetailedCard, ExtractionResult } from "../../../scripts/scraper/types";

export interface KnowledgeGraph {
  source: Source;
  company: Company;
  opportunity: Opportunity;
  document: Document;
  evidence: Evidence[];
  facts: Fact[];
}

export interface KnowledgeGraphBuildReport {
  companiesCreated: number;
  companiesMatched: number; // For the IngestService to fill out, or we can just say "Companies Extracted"
  opportunitiesCreated: number;
  documentsCreated: number;
  factsCreated: number;
  duplicateFacts: number;
  skippedFacts: number;
  warnings: string[];
  dimensionsExtracted?: number;
  dimensionsMissing?: number;
  dimensionsMalformed?: number;
  dimensionsSchemaErrors?: number;
}

export class KnowledgeGraphBuilder {
  /**
   * Constructs an in-memory Canonical Knowledge Graph from scraper output.
   * Performs normalization, deterministic identity resolution, and provenance attachment.
   * It has zero knowledge of SQLite or persistence repositories.
   */
  public build(
    card: DetailedCard, 
    extraction: ExtractionResult,
    runId: string,
    extractorVersion: string
  ): { graph: KnowledgeGraph, report: KnowledgeGraphBuildReport } {
    
    const warnings: string[] = [];
    const timestamp = new Date().toISOString();

    const provenance: Provenance = {
      schemaVersion: "1.0",
      extractorVersion,
      model: "gpt-4o-mini", // Sourced from extraction conceptually
      runId,
      timestamp
    };

    // 1. Source (Identity: Portal Name)
    const source: Source = {
      id: card.portal,
      type: card.portal as any,
      name: card.portal,
      url: card.searchUrl,
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance
    };

    // 2. Company (Identity: Deterministic Hash of Normalized Name)
    const rawCompanyName = card.company || "Unknown Company";
    const normalizedCompany = this.normalizeCompanyName(rawCompanyName);
    const companyId = "c_" + this.deterministicHash(normalizedCompany);

    const company: Company = {
      id: companyId,
      name: normalizedCompany,
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance
    };

    // 3. Opportunity (Identity: Company + Canonical Title + Employment Type + Location + Fingerprint)
    const canonicalTitle = card.title || "Unknown Role";
    const employmentType = "Full-Time"; // Default for now
    const location = card.location || "Unknown";
    // For identity, we use the scraper's stable fingerprint hash
    const fingerprint = card.cardHash; 
    
    const opportunityId = "o_" + this.deterministicHash(`${companyId}:${canonicalTitle}:${employmentType}:${location}:${fingerprint}`);

    const opportunity: Opportunity = {
      id: opportunityId,
      companyId: company.id,
      canonicalTitle,
      location,
      employmentType,
      postingWindow: card.discoveredAt || "Recently",
      fingerprint,
      lifecycle: "Discovered",
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance
    };

    // 4. Document (Identity: Source + Content Hash)
    const rawJsonContent = JSON.stringify(extraction);
    const contentHash = this.deterministicHash(rawJsonContent);
    const documentId = "doc_" + this.deterministicHash(`${source.id}:${contentHash}`);

    const document: Document = {
      id: documentId,
      sourceId: source.id,
      opportunityId: opportunity.id,
      payloadType: "Structured",
      content: rawJsonContent,
      lifecycle: "Parsed",
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance
    };

    // 5. Evidence & Facts
    const evidenceList: Evidence[] = [];
    const facts: Fact[] = [];
    
    let skippedFacts = 0;
    let dimensionsExtracted = 0;
    let dimensionsMissing = 0;
    let dimensionsMalformed = 0;
    let dimensionsSchemaErrors = 0;
    
    if (extraction.dimensions) {
      for (const dim of extraction.dimensions) {
        if (!dim.key || !dim.jdEvidence) {
          warnings.push(`Skipped malformed dimension (schema error): ${dim?.key || 'unknown'}`);
          dimensionsSchemaErrors++;
          skippedFacts++;
          continue;
        }

        if (dim.jdEvidence.value === undefined) {
          warnings.push(`Skipped malformed dimension: ${dim.key}`);
          dimensionsMalformed++;
          skippedFacts++;
          continue;
        }

        if (dim.jdEvidence.value === null || dim.jdEvidence.status === "Missing") {
          dimensionsMissing++;
          continue;
        }

        if (dim.jdEvidence.value === "") {
          dimensionsMissing++;
          continue;
        }
        
        dimensionsExtracted++;

        const evidenceIds: string[] = [];
        
        // Evidence (Identity: Document + Quote Hash)
        if (dim.jdEvidence.evidence && Array.isArray(dim.jdEvidence.evidence)) {
          for (const ev of dim.jdEvidence.evidence) {
            const evId = "ev_" + this.deterministicHash(`${document.id}:${ev.quote}`);
            evidenceIds.push(evId);
            
            // Deduplicate in-memory if multiple facts use the exact same quote
            if (!evidenceList.some(e => e.id === evId)) {
              evidenceList.push({
                id: evId,
                documentId: document.id,
                text: ev.quote,
                qualityScore: 0.9,
                createdAt: timestamp,
                updatedAt: timestamp,
                provenance
              });
            }
          }
        }

        // Fact (Identity: Opportunity + Fact Type + Normalized Value)
        let dimValue = dim.jdEvidence.value;
        if (typeof dimValue === "string" && dimValue.startsWith("{") && dimValue.includes('"')) {
          try {
            const parsed = JSON.parse(dimValue);
            dimValue = parsed.value || parsed.canonicalValue || parsed.rawValue || dimValue;
          } catch {}
        }
        const normalizedValue = typeof dimValue === "string" ? dimValue.trim().toLowerCase() : JSON.stringify(dimValue);
        const factId = "f_" + this.deterministicHash(`${opportunity.id}:${dim.key}:${normalizedValue}`);
        
        facts.push({
          id: factId,
          opportunityId: opportunity.id,
          attribute: dim.key,
          value: dimValue,
          evidenceIds,
          createdAt: timestamp,
          updatedAt: timestamp,
          provenance
        });
      }
    }

    if (facts.length > 0) {
      opportunity.lifecycle = "Normalized";
    }

    const report: KnowledgeGraphBuildReport = {
      companiesCreated: 1,
      companiesMatched: 0,
      opportunitiesCreated: 1,
      documentsCreated: 1,
      factsCreated: facts.length,
      duplicateFacts: 0, // Ingest service calculates true duplicates against SQLite
      skippedFacts,
      warnings,
      dimensionsExtracted,
      dimensionsMissing,
      dimensionsMalformed,
      dimensionsSchemaErrors
    };

    return {
      graph: {
        source,
        company,
        opportunity,
        document,
        evidence: evidenceList,
        facts
      },
      report
    };
  }

  private normalizeCompanyName(raw: string): string {
    return raw
      .replace(/[,.]/g, "")
      .replace(/\s+(Inc|LLC|Ltd|Corp|Corporation)$/i, "")
      .trim();
  }

  private deterministicHash(input: string): string {
    // A simple deterministic string hash (djb2) for identity generation
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }
}
