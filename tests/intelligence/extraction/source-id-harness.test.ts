import { describe, it, expect } from "vitest";
import {
  buildRolePromptWithSourceUnits,
  buildCandidatePromptWithSourceUnits,
  getRoleJsonSchemaForVertex,
  getCandidateJsonSchemaForVertex,
  resolveRoleResponseBySourceId,
  resolveCandidateResponseBySourceId,
} from "../../../src/lib/intelligence/extraction/SourceIdExtractionHarness";
import type { SourceUnit } from "../../../src/lib/intelligence/extraction/MechanicalSourceSegmenter";

describe("SourceIdExtractionHarness", () => {
  const sampleRoleUnits: SourceUnit[] = [
    {
      spanId: "S001",
      exactText: "VP of Engineering at Acme Corp.",
      startOffset: 0,
      endOffset: 31
    },
    {
      spanId: "S002",
      exactText: "Reports directly to the Chief Technology Officer.",
      startOffset: 32,
      endOffset: 81
    },
    {
      spanId: "S003",
      exactText: "Lead a high-performing team of 25 distributed software engineers.",
      startOffset: 82,
      endOffset: 147
    }
  ];

  const sampleRoleSource = "VP of Engineering at Acme Corp. Reports directly to the Chief Technology Officer. Lead a high-performing team of 25 distributed software engineers.";

  it("builds role prompt with embedded source unit mappings", () => {
    const prompt = buildRolePromptWithSourceUnits({
      title: "VP of Engineering",
      company: "Acme Corp",
      units: sampleRoleUnits
    });

    expect(prompt).toContain("[S001]");
    expect(prompt).toContain("[S002]");
    expect(prompt).toContain("[S003]");
    expect(prompt).toContain("VP of Engineering at Acme Corp.");
    expect(prompt).toContain("Do NOT emit exact quotes, character offsets");
  });

  it("generates Vertex-compatible role JSON schema using singleton enum instead of const", () => {
    const schema = getRoleJsonSchemaForVertex(sampleRoleUnits) as any;
    
    // Schema must NOT use 'const' keyword which breaks Vertex AI
    expect(schema.properties.schemaVersion.enum).toEqual(["llm-semantic-proposal-envelope/v1"]);
    expect(schema.properties.schemaVersion.const).toBeUndefined();

    // SpanId enum must be restricted to valid unit spanIds
    const proposalProps = schema.properties.output.properties.proposals.items.properties;
    expect(proposalProps.spanId.enum).toEqual(["S001", "S002", "S003"]);
  });

  it("resolves role response with valid span IDs and passes mechanical verification", () => {
    const validResponseJson = JSON.stringify({
      schemaVersion: "llm-semantic-proposal-envelope/v1",
      output: {
        proposals: [
          {
            spanId: "S001",
            semanticType: "ROLE_PURPOSE",
            subject: "ROLE",
            confidence: 1.0
          },
          {
            spanId: "S002",
            semanticType: "REPORTING_LINE",
            subject: "ROLE",
            confidence: 1.0
          },
          {
            spanId: "S003",
            semanticType: "PEOPLE_LEADERSHIP",
            subject: "ROLE",
            confidence: 0.95
          }
        ]
      }
    });

    const result = resolveRoleResponseBySourceId({
      responseText: validResponseJson,
      sourceText: sampleRoleSource,
      canonicalJobId: "job-test-01",
      units: sampleRoleUnits
    });

    expect(result.envelopeValid).toBe(true);
    expect(result.parsedProposals).toBe(3);
    expect(result.validSpanIdCount).toBe(3);
    expect(result.invalidSpanIds).toHaveLength(0);
    expect(result.verificationError).toBeNull();
    expect(result.assembly).not.toBeNull();
    expect(result.assembly!.output.atoms.length).toBeGreaterThanOrEqual(1);
  });

  it("handles response with unknown span ID without crashing", () => {
    const invalidSpanResponseJson = JSON.stringify({
      schemaVersion: "llm-semantic-proposal-envelope/v1",
      output: {
        proposals: [
          {
            spanId: "S999", // Unknown ID
            semanticType: "ROLE_PURPOSE",
            subject: "ROLE",
            confidence: 1.0
          }
        ]
      }
    });

    const result = resolveRoleResponseBySourceId({
      responseText: invalidSpanResponseJson,
      sourceText: sampleRoleSource,
      canonicalJobId: "job-test-01",
      units: sampleRoleUnits
    });

    expect(result.envelopeValid).toBe(true);
    expect(result.parsedProposals).toBe(1);
    expect(result.validSpanIdCount).toBe(0);
    expect(result.invalidSpanIds).toEqual(["S999"]);
  });

  it("handles malformed envelope gracefully", () => {
    const badJson = JSON.stringify({
      unexpectedKey: 123
    });

    const result = resolveRoleResponseBySourceId({
      responseText: badJson,
      sourceText: sampleRoleSource,
      canonicalJobId: "job-test-01",
      units: sampleRoleUnits
    });

    expect(result.envelopeValid).toBe(false);
    expect(result.verificationError).toContain("Invalid envelope schema");
  });

  it("builds candidate prompt and schema and resolves candidate proposals", () => {
    const candidateSource = "### **Senior Vice President** | **VML**\n_Apr 2023 – Present_\n- Managed $8M agency fee book across APAC.";
    const candidateUnits: SourceUnit[] = [
      {
        spanId: "S001",
        exactText: "Senior Vice President | VML",
        startOffset: 4,
        endOffset: 31
      },
      {
        spanId: "S002",
        exactText: "Apr 2023 – Present",
        startOffset: 33,
        endOffset: 51
      },
      {
        spanId: "S003",
        exactText: "Managed $8M agency fee book across APAC.",
        startOffset: 54,
        endOffset: 94
      }
    ];

    const prompt = buildCandidatePromptWithSourceUnits({
      documentId: "CAND_01",
      units: candidateUnits
    });
    expect(prompt).toContain("Document ID: CAND_01");
    expect(prompt).toContain("[S001]");

    const schema = getCandidateJsonSchemaForVertex(candidateUnits) as any;
    expect(schema.properties.schemaVersion.enum).toEqual(["llm-semantic-proposal-envelope/v1"]);

    const responseJson = JSON.stringify({
      schemaVersion: "llm-semantic-proposal-envelope/v1",
      output: {
        proposals: [
          {
            spanId: "S003",
            evidenceClass: "WORK_HISTORY",
            proofTypes: ["OWNERSHIP", "FINANCIAL_SCOPE"]
          }
        ]
      }
    });

    const result = resolveCandidateResponseBySourceId({
      responseText: responseJson,
      sourceText: candidateSource,
      sourceDocumentId: "CAND_01",
      units: candidateUnits
    });

    expect(result.envelopeValid).toBe(true);
    expect(result.parsedProposals).toBe(1);
    expect(result.validSpanIdCount).toBe(1);
  });
});
