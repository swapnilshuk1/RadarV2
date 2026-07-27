import fs from "fs";
import path from "path";
import { ingestIntoSqlite } from "../scraper/persist/ingest";
import { getRepositories } from "../../src/data/sqlite/provider";
import type { DetailedCard, ExtractionResult } from "../scraper/types";

// This would ideally be loaded from a JSON file, but for bootstrapping we generate it in memory
export function getGoldenDataset(): { card: DetailedCard, extraction: ExtractionResult }[] {
  const timestamp = new Date().toISOString();
  
  return [
    {
      card: {
        cardHash: "gold_exec_mktg",
        portal: "linkedin",
        keyword: "Executive Marketing",
        searchUrl: "https://linkedin.com/search",
        detailUrl: "https://linkedin.com/job/1",
        discoveredAt: timestamp,
        title: "VP of Marketing",
        company: "Adobe",
        location: "San Jose, CA",
        rawHtml: "<html><body>...</body></html>",
        rawText: "Lead the global marketing team and transform our digital presence.",
        snapshotSchemaVersion: "1.0",
        scraperVersion: "2.0",
        detail: { fetched: true },
        telemetry: { cardExtractMs: 10, detailExtractMs: 50, totalMs: 60 }
      },
      extraction: {
        extractorVersion: "2.0",
        promptVersion: "v7",
        jobHash: "gold_exec_mktg",
        role: "VP of Marketing",
        company: "Adobe",
        location: "San Jose, CA",
        postedRelative: "2 days ago",
        scrapedFrom: "linkedin",
        primaryConcern: "Growth",
        applyUrl: "https://adobe.com/careers",
        dimensions: [
          {
            key: "commercial_ownership",
            label: "Commercial Ownership",
            importance: "Core",
            bucket: "Matched",
            jdEvidence: {
              value: "Own full marketing P&L",
              status: "Explicit",
              evidence: [{ quote: "transform our digital presence", source: "detail" }],
              provenance: "explicit",
              quality: "high"
            },
            candidateProof: { headline: "", detail: "" }
          }
        ],
        telemetry: { deterministicMs: 5, llmMs: 1000, llmCalled: true }
      }
    },
    // Malformed Edge Case
    {
      card: {
        cardHash: "gold_malformed_jd",
        portal: "indeed",
        keyword: "Marketing",
        searchUrl: "https://indeed.com/search",
        detailUrl: "https://indeed.com/job/2",
        discoveredAt: timestamp,
        title: "Marketing Manager",
        company: "Acme Corp",
        location: "Remote",
        rawHtml: "",
        rawText: "",
        snapshotSchemaVersion: "1.0",
        scraperVersion: "2.0",
        detail: { fetched: true },
        telemetry: { cardExtractMs: 10, detailExtractMs: 50, totalMs: 60 }
      },
      extraction: {
        extractorVersion: "2.0",
        promptVersion: "v7",
        jobHash: "gold_malformed_jd",
        role: "Marketing Manager",
        company: "Acme Corp",
        location: "Remote",
        postedRelative: "1 day ago",
        scrapedFrom: "indeed",
        primaryConcern: "Marketing",
        applyUrl: "https://acme.com",
        dimensions: [
          // Malformed dimension missing evidence
          {
            key: "missing_evidence",
            label: "Missing",
            importance: "Context",
            bucket: "Missing",
            jdEvidence: {
              value: null,
              status: "Missing",
              evidence: [],
              provenance: "explicit",
              quality: "low"
            },
            candidateProof: { headline: "", detail: "" }
          }
        ],
        telemetry: { deterministicMs: 5, llmMs: 100, llmCalled: false }
      }
    }
  ];
}

export function runLayerB() {
  const dataset = getGoldenDataset();
  const iterations = 5;
  let totalFactsCreated = 0;
  let totalDuplicates = 0;
  
  console.log(`\n--- Layer B: Ingestion Qualification ---`);
  console.log(`Testing Determinism & Idempotency (${iterations} iterations on ${dataset.length} Golden records)...`);

  for (let i = 0; i < iterations; i++) {
    for (const record of dataset) {
      const report = await ingestIntoSqlite(record.card, JSON.stringify(record.extraction), "2.0", true);
      if (i === 0) {
        totalFactsCreated += report.factsCreated;
      } else {
        totalDuplicates += report.duplicateFacts;
        if (report.factsCreated > 0 || report.companiesCreated > 0 || report.opportunitiesCreated > 0) {
           console.error(`❌ IDEMPOTENCY FAILURE on Iteration ${i + 1}: Created new entities instead of deduplicating.`);
           return "FAIL";
        }
      }
    }
  }

  // Cross check with SQLite to ensure exactly 1 Company, 1 Opportunity, etc per unique golden record
  const repos = getRepositories();
  const opportunities = repos.opportunities.findOpportunities({});
  
  if (opportunities.length !== dataset.length) {
    console.error(`❌ DETERMINISM FAILURE: Expected ${dataset.length} canonical opportunities, got ${opportunities.length}.`);
    return "FAIL";
  }

  console.log(`✅ Determinism Passed: Database converged perfectly after ${iterations} iterations.`);
  console.log(`✅ Idempotency Passed: Caught ${totalDuplicates} duplicates, 0 anomalous creations.`);
  return "PASS";
}
