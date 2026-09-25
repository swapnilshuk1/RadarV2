import { describe, expect, it } from "vitest";
import { KnowledgeGraphBuilder } from "../../src/lib/intelligence/KnowledgeGraphBuilder";

describe("knowledge graph provenance truth", () => {
  it("persists the real enrichment provider, prompt version, and scraper run", () => {
    const card:any = {
      portal: "LinkedIn",
      searchUrl: "https://linkedin.test/search",
      detailUrl: "https://linkedin.test/jobs/1",
      title: "Head of Growth",
      company: "Example Co",
      location: "India",
      cardHash: "card-1",
      discoveredAt: "2026-09-25T00:00:00.000Z",
    };
    const providerId = "gemini:gemini-3.5-flash-lite@3.0.0";
    const extraction:any = {
      extractorVersion: "1.2.0",
      promptVersion: "1.1.0",
      jobHash: "job-1",
      role: card.title,
      company: card.company,
      location: card.location,
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      applyUrl: card.detailUrl,
      normalizedText: "Reports to the CEO. India.",
      telemetry: {
        deterministicMs: 1,
        llmMs: 10,
        llmCalled: true,
        providerId,
      },
      dimensions: [
        {
          key: "reportingLine",
          label: "Reporting Line",
          importance: "Core",
          bucket: "Adjacent",
          jdEvidence: {
            value: "CEO",
            status: "Inferred",
            evidence: [],
            provenance: "llm",
            quality: "medium",
            extractorId: providerId,
          },
          candidateProof: { headline: "", detail: "" },
        },
        {
          key: "geography",
          label: "Geography",
          importance: "Supporting",
          bucket: "Matched",
          jdEvidence: {
            value: "India",
            status: "Explicit",
            evidence: [{ quote: "India", source: "detail" }],
            provenance: "explicit",
            quality: "high",
            extractorId: "geography@deterministic",
          },
          candidateProof: { headline: "", detail: "" },
        },
      ],
    };

    const { graph } = new KnowledgeGraphBuilder().build(
      card,
      extraction,
      "run-real-123",
      "1.2.0",
      "canonical-1",
    );

    expect(graph.opportunity.provenance).toMatchObject({
      extractorVersion: "1.2.0",
      promptVersion: "1.1.0",
      model: providerId,
      runId: "run-real-123",
    });
    expect(graph.document.provenance.model).toBe(providerId);

    const inferredFact = graph.facts.find((fact) => fact.attribute === "reportingLine");
    expect(inferredFact?.provenance).toMatchObject({
      promptVersion: "1.1.0",
      model: providerId,
      runId: "run-real-123",
    });

    const explicitFact = graph.facts.find((fact) => fact.attribute === "geography");
    expect(explicitFact?.provenance.model).toBeUndefined();
    expect(explicitFact?.provenance.promptVersion).toBeUndefined();
    expect(explicitFact?.provenance.runId).toBe("run-real-123");
    expect(graph.evidence[0]?.provenance.model).toBeUndefined();
  });

  it("recovers provider identity from LLM dimension provenance for older cached extractions", () => {
    const providerId = "gemini:gemini-3.5-flash-lite@3.0.0";
    const card:any = {
      portal: "Indeed",
      searchUrl: "",
      detailUrl: "https://indeed.test/job",
      title: "Director",
      company: "Example",
      location: "India",
      cardHash: "card-2",
    };
    const extraction:any = {
      extractorVersion: "1.2.0",
      promptVersion: "1.1.0",
      jobHash: "job-2",
      role: card.title,
      company: card.company,
      location: card.location,
      postedRelative: "Posted recently",
      scrapedFrom: "Indeed",
      primaryConcern: null,
      applyUrl: card.detailUrl,
      normalizedText: "",
      telemetry: { deterministicMs: 1, llmMs: 2, llmCalled: true },
      dimensions: [{
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Adjacent",
        jdEvidence: {
          value: "SCALE",
          status: "Inferred",
          evidence: [],
          provenance: "llm",
          quality: "medium",
          extractorId: providerId,
        },
        candidateProof: { headline: "", detail: "" },
      }],
    };
    const { graph } = new KnowledgeGraphBuilder().build(card, extraction, undefined, "1.2.0");
    expect(graph.opportunity.provenance.model).toBe(providerId);
    expect(graph.opportunity.provenance.promptVersion).toBe("1.1.0");
    expect(graph.opportunity.provenance.runId).toBeUndefined();
  });
});
