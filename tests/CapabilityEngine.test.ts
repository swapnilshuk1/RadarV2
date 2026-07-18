import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityEngine, type JobSlice } from "../src/lib/capability/CapabilityEngine";
import { CapabilityOntology } from "../src/lib/ontology/CapabilityOntology";

describe("CapabilityEngine Integration Tests", () => {
  let engine: CapabilityEngine;

  beforeEach(() => {
    CapabilityOntology.resetInstance();
    engine = new CapabilityEngine();
  });

  // ============================================================================
  // 1. Positive Tests
  // ============================================================================
  it("should match CRM Strategy capability successfully when Salesforce and CRM matches", () => {
    const job: JobSlice = {
      jobId: "job-001",
      jobHash: "hash-001",
      graphVersion: "v1",
      dimensions: {
        technologyStack: {
          value: ["Salesforce", "PostgreSQL"],
          confidence: 0.95,
          evidence: "Expert knowledge of Salesforce is required.",
        },
      },
    };

    const results = engine.evaluate(job);
    const crmCap = results.find(c => c.id === "cap_crm_strategy");

    expect(crmCap).toBeDefined();
    expect(crmCap!.strength).toBe("Strong");
    expect(crmCap!.confidence).toBe(0.95);
    expect(crmCap!.supportingEvidence[0].matchedValue).toBe("Salesforce");
    expect(crmCap!.supportingEvidence[0].dimension).toBe("technologyStack");
    expect(crmCap!.supportingEvidence[0].quote).toBe("Expert knowledge of Salesforce is required.");
  });

  it("should generate a high-fidelity template-based explanation for matched capabilities", () => {
    const job: JobSlice = {
      jobId: "job-002",
      jobHash: "hash-002",
      graphVersion: "v1",
      dimensions: {
        technologyStack: {
          value: "HubSpot",
          confidence: 0.90,
          evidence: "Deploy analytical reporting models inside HubSpot CRM.",
        },
      },
    };

    const results = engine.evaluate(job);
    const crmCap = results.find(c => c.id === "cap_crm_strategy");
    expect(crmCap).toBeDefined();

    const ontology = CapabilityOntology.getInstance();
    const config = ontology.getCapability("cap_crm_strategy")!;
    const summary = engine.generateSummary(config, crmCap!);

    expect(summary).toBe("Strong evidence of CRM & Customer Retention Strategy based on matching HubSpot under the technologyStack dimension.");
  });

  // ============================================================================
  // 2. Negative Tests
  // ============================================================================
  it("should not match capability when mandatory technologies or parameters are missing", () => {
    const job: JobSlice = {
      jobId: "job-003",
      jobHash: "hash-003",
      graphVersion: "v1",
      dimensions: {
        technologyStack: {
          value: ["PostgreSQL", "React"],
          confidence: 0.90,
          evidence: "Full stack engineering using React and Postgres.",
        },
      },
    };

    const results = engine.evaluate(job);
    const crmCap = results.find(c => c.id === "cap_crm_strategy");
    expect(crmCap).toBeUndefined(); // Missing Salesforce/HubSpot/Dynamics
  });

  it("should not match Executive Growth & Scale Mandate if reporting line is function head instead of CEO/Board", () => {
    const job: JobSlice = {
      jobId: "job-004",
      jobHash: "hash-004",
      graphVersion: "v1",
      dimensions: {
        mandate: {
          value: "SCALE",
          confidence: 0.90,
          evidence: "Tasked with scaling operations 10x.",
        },
        reportingLine: {
          value: "FUNCTION_HEAD",
          confidence: 0.85,
          evidence: "Reports directly to the VP of Engineering.",
        },
      },
    };

    const results = engine.evaluate(job);
    const execCap = results.find(c => c.id === "cap_executive_growth_scale");
    expect(execCap).toBeUndefined(); // Mandate is matched but reportingLine is FUNCTION_HEAD
  });

  // ============================================================================
  // 3. Borderline & Continuous Threshold Tests
  // ============================================================================
  it("should fail validation if any matched rule lacks a valid, cited evidence quote", () => {
    const job: JobSlice = {
      jobId: "job-005",
      jobHash: "hash-005",
      graphVersion: "v1",
      dimensions: {
        technologyStack: {
          value: "Salesforce",
          confidence: 0.90,
          evidence: "   ", // Blank spaces are invalid evidence quotes
        },
      },
    };

    const results = engine.evaluate(job);
    const crmCap = results.find(c => c.id === "cap_crm_strategy");
    expect(crmCap).toBeUndefined(); // Fails strict rule-level evidence invariant
  });

  // ============================================================================
  // 4. Provenance Invariant Tests
  // ============================================================================
  it("should enforce that every matched capability possesses complete provenance chains and quote details", () => {
    const job: JobSlice = {
      jobId: "job-006",
      jobHash: "hash-006",
      graphVersion: "v1",
      dimensions: {
        commercialAccountability: {
          value: "PL_OWNERSHIP",
          confidence: 0.92,
          evidence: "Full P&L ownership of $150M USD.",
        },
      },
    };

    const results = engine.evaluate(job);
    const stewardCap = results.find(c => c.id === "cap_enterprise_financial_stewardship");

    expect(stewardCap).toBeDefined();
    expect(stewardCap!.supportingEvidence.length).toBeGreaterThan(0);

    for (const ev of stewardCap!.supportingEvidence) {
      expect(ev.dimension).toBe("commercialAccountability");
      expect(ev.quote).toBe("Full P&L ownership of $150M USD.");
      expect(ev.confidence).toBe(0.92);
      expect(ev.matchedValue).toBe("PL_OWNERSHIP");
    }
  });

  // ============================================================================
  // 5. Determinism Tests (Replayability Guarantee)
  // ============================================================================
  it("should produce 100% identical outputs and order when evaluated repeatedly against identical inputs", () => {
    const job: JobSlice = {
      jobId: "job-007",
      jobHash: "hash-007",
      graphVersion: "v1",
      dimensions: {
        mandate: {
          value: "GREENFIELD",
          confidence: 0.95,
          evidence: "Requires a 0-to-1 leader to build APAC operations from scratch.",
        },
        commercialAccountability: {
          value: "PL_OWNERSHIP",
          confidence: 0.90,
          evidence: "The successful candidate has full P&L accountability of $10M.",
        },
      },
    };

    const run1 = engine.evaluate(job);
    const run2 = engine.evaluate(job);

    expect(run1.length).toBe(run2.length);

    for (let i = 0; i < run1.length; i++) {
      const cap1 = run1[i];
      const cap2 = run2[i];

      expect(cap1.id).toBe(cap2.id);
      expect(cap1.name).toBe(cap2.name);
      expect(cap1.strength).toBe(cap2.strength);
      expect(cap1.confidence).toBe(cap2.confidence);
      expect(cap1.sourceDimensions).toEqual(cap2.sourceDimensions);

      expect(cap1.supportingEvidence.length).toBe(cap2.supportingEvidence.length);
      for (let j = 0; j < cap1.supportingEvidence.length; j++) {
        const ev1 = cap1.supportingEvidence[j];
        const ev2 = cap2.supportingEvidence[j];

        expect(ev1.dimension).toBe(ev2.dimension);
        expect(ev1.quote).toBe(ev2.quote);
        expect(ev1.matchedValue).toBe(ev2.matchedValue);
        expect(ev1.confidence).toBe(ev2.confidence);
      }
    }
  });
});
