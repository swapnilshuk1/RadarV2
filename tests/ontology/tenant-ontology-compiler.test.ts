import { describe, it, expect } from "vitest";
import {
  compileTenantOntology,
  getCanonicalOntology,
  canonicalNormalize,
  deterministicSerialize,
  computeDeterministicHash,
  validateOntologyGraphUniqueness,
} from "../../src/lib/ontology/compiler/OntologyCompiler";
import type { TenantOntologyConfig } from "../../src/lib/ontology/compiler/types";
import canonicalRawJson from "../../src/data/ontology/executive_ontology.json";
import { CapabilityAssessmentEngine } from "../../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { buildCandidateEvaluationContext } from "../../src/lib/intelligence/context";
import type { CandidateProjection } from "../../src/lib/domain/candidate_projection";
import type { JobProjection } from "../../src/lib/domain/job_projection";

describe("Phase M2: Tenant-Aware Ontology Compiler Suite", () => {
  // Test Configurations
  const tenantAConfig: TenantOntologyConfig = {
    tenantId: "tenant_alpha",
    customCapabilities: [
      {
        domainId: "commercial_marketing",
        disciplineId: "performance_growth",
        capability: {
          id: "cap_alpha_growth_hacking",
          name: "Alpha Growth Hacking",
          keywords: ["viral loops", "product led growth loops", "alpha acquisition"],
          responsibilities: ["Lead Alpha Growth"],
        },
      },
    ],
    customKeywords: [
      {
        capabilityId: "perf_mkt",
        keywords: ["alpha paid search"],
      },
    ],
  };

  const tenantBConfig: TenantOntologyConfig = {
    tenantId: "tenant_beta",
    customCapabilities: [
      {
        domainId: "commercial_marketing",
        disciplineId: "brand_communications",
        capability: {
          id: "cap_beta_reputation",
          name: "Beta Crisis Reputation Defense",
          keywords: ["hostile media mitigation", "beta brand defense"],
          responsibilities: ["Lead Beta Reputation"],
        },
      },
    ],
    customKeywords: [
      {
        capabilityId: "brand_strat",
        keywords: ["beta brand narrative"],
      },
    ],
  };

  describe("1. Canonical Immutability Invariant", () => {
    it("CanonicalOntology_before === CanonicalOntology_after across multiple tenant compilations", () => {
      const canonicalBefore = JSON.stringify(canonicalRawJson);

      // Run compilations for different tenants
      const compiledA = compileTenantOntology(canonicalRawJson as any, tenantAConfig);
      const canonicalAfterA = JSON.stringify(canonicalRawJson);

      const compiledB = compileTenantOntology(canonicalRawJson as any, tenantBConfig);
      const canonicalAfterB = JSON.stringify(canonicalRawJson);

      // Verify the canonical source object in memory was never mutated
      expect(canonicalAfterA).toBe(canonicalBefore);
      expect(canonicalAfterB).toBe(canonicalBefore);
      expect(canonicalAfterA).toBe(canonicalAfterB);

      // Verify canonical object returned by helper has zero tenant concepts
      const canonicalFresh = getCanonicalOntology();
      const freshStr = JSON.stringify(canonicalFresh);
      expect(freshStr).not.toContain("cap_alpha_growth_hacking");
      expect(freshStr).not.toContain("cap_beta_reputation");
      expect(freshStr).not.toContain("alpha paid search");
      expect(freshStr).not.toContain("beta brand narrative");
    });
  });

  describe("2. Cross-Tenant Isolation & Contamination Prevention", () => {
    it("Compile(Canonical, TenantA) !== Compile(Canonical, TenantB) when configurations differ", () => {
      const compiledA = compileTenantOntology(canonicalRawJson as any, tenantAConfig);
      const compiledB = compileTenantOntology(canonicalRawJson as any, tenantBConfig);

      expect(compiledA.compiledOntologyHash).not.toBe(compiledB.compiledOntologyHash);
      expect(compiledA.tenantId).toBe("tenant_alpha");
      expect(compiledB.tenantId).toBe("tenant_beta");
    });

    it("Replay Isolation: Compile A -> Compile B -> Compile A yields identical results", () => {
      const compiledA1 = compileTenantOntology(canonicalRawJson as any, tenantAConfig);
      const compiledB = compileTenantOntology(canonicalRawJson as any, tenantBConfig);
      const compiledA2 = compileTenantOntology(canonicalRawJson as any, tenantAConfig);

      expect(compiledA1.compiledOntologyHash).toBe(compiledA2.compiledOntologyHash);
      expect(compiledA1.ontology).toEqual(compiledA2.ontology);
      expect(compiledA1.compiledOntologyHash).not.toBe(compiledB.compiledOntologyHash);
    });

    it("Contamination Test: Tenant A compiled ontology contains X and not Y; Tenant B contains Y and not X; Canonical contains neither", () => {
      const compiledA = compileTenantOntology(canonicalRawJson as any, tenantAConfig);
      const compiledB = compileTenantOntology(canonicalRawJson as any, tenantBConfig);
      const canonical = getCanonicalOntology();

      const strA = JSON.stringify(compiledA);
      const strB = JSON.stringify(compiledB);
      const strCanonical = JSON.stringify(canonical);

      // Tenant A assertions: contains X, strictly does NOT contain Y
      expect(strA).toContain("cap_alpha_growth_hacking");
      expect(strA).toContain("alpha paid search");
      expect(strA).not.toContain("cap_beta_reputation");
      expect(strA).not.toContain("beta brand narrative");

      // Tenant B assertions: contains Y, strictly does NOT contain X
      expect(strB).toContain("cap_beta_reputation");
      expect(strB).toContain("beta brand narrative");
      expect(strB).not.toContain("cap_alpha_growth_hacking");
      expect(strB).not.toContain("alpha paid search");

      // Canonical assertions: strictly contains neither X nor Y
      expect(strCanonical).not.toContain("cap_alpha_growth_hacking");
      expect(strCanonical).not.toContain("alpha paid search");
      expect(strCanonical).not.toContain("cap_beta_reputation");
      expect(strCanonical).not.toContain("beta brand narrative");
    });
  });

  describe("3. Purely Semantic Fingerprint & Determinism", () => {
    it("Two different tenants with identical semantic configurations produce the exact same compiledOntologyHash", () => {
      const configTenant1: TenantOntologyConfig = {
        tenantId: "tenant_org_1",
        customKeywords: [{ capabilityId: "perf_mkt", keywords: ["sem_specialist"] }],
      };

      const configTenant2: TenantOntologyConfig = {
        tenantId: "tenant_org_2",
        customKeywords: [{ capabilityId: "perf_mkt", keywords: ["sem_specialist"] }],
      };

      const compiled1 = compileTenantOntology(canonicalRawJson as any, configTenant1);
      const compiled2 = compileTenantOntology(canonicalRawJson as any, configTenant2);

      // Semantic fingerprint MUST be identical because the compiled ontology is identical
      expect(compiled1.compiledOntologyHash).toBe(compiled2.compiledOntologyHash);
      // But tenant context identity is preserved
      expect(compiled1.tenantId).toBe("tenant_org_1");
      expect(compiled2.tenantId).toBe("tenant_org_2");
    });

    it("Identical configs produce identical hashes regardless of object key order or array order", () => {
      const config1: TenantOntologyConfig = {
        tenantId: "tenant_gamma",
        customKeywords: [
          { capabilityId: "perf_mkt", keywords: ["growth", "b2b"] },
          { capabilityId: "brand_strat", keywords: ["equity", "pr"] },
        ],
      };

      const config2: TenantOntologyConfig = {
        tenantId: "tenant_gamma",
        customKeywords: [
          { capabilityId: "brand_strat", keywords: ["pr", "equity"] }, // Swapped keywords and order
          { capabilityId: "perf_mkt", keywords: ["b2b", "growth"] },
        ],
      };

      const compiled1 = compileTenantOntology(canonicalRawJson as any, config1);
      const compiled2 = compileTenantOntology(canonicalRawJson as any, config2);

      expect(compiled1.compiledOntologyHash).toBe(compiled2.compiledOntologyHash);
      expect(compiled1.ontology).toEqual(compiled2.ontology);
    });

    it("SHA-256 deterministic serialization helper behaves consistently", () => {
      const objA = { z: 1, a: ["second", "first"], m: { b: 2, a: 1 } };
      const objB = { m: { a: 1, b: 2 }, a: ["first", "second"], z: 1 };

      const hashA = computeDeterministicHash(objA);
      const hashB = computeDeterministicHash(objB);

      expect(hashA).toBe(hashB);
      expect(deterministicSerialize(objA)).toBe(deterministicSerialize(objB));
    });

    it("Throws error if duplicate entity IDs are encountered", () => {
      const invalidGraph = {
        version: "3.0.0",
        systemName: "Invalid",
        domains: [
          {
            id: "dup_domain",
            name: "Domain 1",
            disciplines: [],
          },
          {
            id: "dup_domain",
            name: "Domain 2",
            disciplines: [],
          },
        ],
      };

      expect(() => validateOntologyGraphUniqueness(invalidGraph as any)).toThrow(
        "Duplicate domain ID detected"
      );
    });
  });

  describe("4. Exhaustive Legacy Baseline Parity", () => {
    it("Compiling legacy/empty tenant produces exact full structural parity with normalized canonical v3 ontology", () => {
      const compiledEmpty = compileTenantOntology(canonicalRawJson as any, undefined);
      const normalizedCanonical = canonicalNormalize(canonicalRawJson) as any;

      expect(compiledEmpty.tenantId).toBe("canonical");
      expect(compiledEmpty.version).toBe(normalizedCanonical.version);

      // 100% full deep structural equality verification
      expect(compiledEmpty.ontology).toEqual(normalizedCanonical);

      // Verify every domain, discipline, capability, keyword, and responsibility matches exactly
      expect(compiledEmpty.ontology.domains.length).toBe(normalizedCanonical.domains.length);
      for (let i = 0; i < compiledEmpty.ontology.domains.length; i++) {
        const cDom = compiledEmpty.ontology.domains[i];
        const nDom = normalizedCanonical.domains[i];
        expect(cDom.id).toBe(nDom.id);
        expect(cDom.name).toBe(nDom.name);
        expect(cDom.disciplines.length).toBe(nDom.disciplines.length);

        for (let j = 0; j < cDom.disciplines.length; j++) {
          const cDisc = cDom.disciplines[j];
          const nDisc = nDom.disciplines[j];
          expect(cDisc.id).toBe(nDisc.id);
          expect(cDisc.name).toBe(nDisc.name);
          expect(cDisc.capabilities.length).toBe(nDisc.capabilities.length);

          for (let k = 0; k < cDisc.capabilities.length; k++) {
            const cCap = cDisc.capabilities[k];
            const nCap = nDisc.capabilities[k];
            expect(cCap.id).toBe(nCap.id);
            expect(cCap.name).toBe(nCap.name);
            expect(cCap.keywords).toEqual(nCap.keywords);
            expect(cCap.responsibilities).toEqual(nCap.responsibilities);
          }
        }
      }
    });
  });

  describe("5. Extraction & Evaluation Context Isolation Integration", () => {
    it("Same candidate and job evaluated under Tenant A vs Tenant B compiled ontologies produce tenant-isolated extraction behavior", () => {
      // Create Tenant A with a custom relationship graph edge
      const canonicalGraph = getCanonicalOntology();
      const tenantACompiled = compileTenantOntology(canonicalGraph, {
        tenantId: "tenant_alpha_corp",
      });
      // Inject a tenant-specialized graph relationship for Tenant A
      (tenantACompiled.ontology as any).relationshipGraph = [
        {
          source: "growth hacking lead",
          target: "custom_growth_architecture",
          relation: "TENANT_A_SPECIALIZATION",
          cost: 0.1,
        },
      ];

      // Create Tenant B with a different custom relationship edge
      const tenantBCompiled = compileTenantOntology(canonicalGraph, {
        tenantId: "tenant_beta_corp",
      });
      (tenantBCompiled.ontology as any).relationshipGraph = [
        {
          source: "growth hacking lead",
          target: "custom_growth_architecture",
          relation: "TENANT_B_DIVERGENCE",
          cost: 0.9, // Higher cost -> lower score
        },
      ];

      // Standard candidate projection
      const candidate: CandidateProjection = {
        coreCapabilities: ["Growth Hacking Lead"],
        executiveThemes: ["Commercial & Marketing Leadership"],
        operatingLevel: { value: "EXECUTIVE" },
        decisionAuthority: { value: "ENTERPRISE" },
        commercialScope: { value: "ENTERPRISE" },
        workNature: { value: "SCALE" },
      };

      // Job requiring custom_growth_architecture
      const job: JobProjection = {
        capabilities: [
          {
            name: "custom_growth_architecture",
            tier: "CORE_MANDATE",
            source: "explicit",
          },
        ],
        originalOpportunity: {
          id: "job_iso_1",
          rawText: "Lead custom growth architecture and executive marketing.",
        } as any,
      } as any;

      // Evaluate under Tenant A context
      const contextA = buildCandidateEvaluationContext(candidate, tenantACompiled);
      const assessmentA = CapabilityAssessmentEngine.evaluate(candidate, job, contextA);

      // Evaluate under Tenant B context
      const contextB = buildCandidateEvaluationContext(candidate, tenantBCompiled);
      const assessmentB = CapabilityAssessmentEngine.evaluate(candidate, job, contextB);

      // Assert Tenant A got high transferability score based on Tenant A graph path
      expect(assessmentA.status).toBe("COMPLETE");
      const matchA = assessmentA.matches.find((m) => m.jobCapability === "custom_growth_architecture");
      expect(matchA?.reason).toBe("Graph Path Transferability (TENANT_A_SPECIALIZATION)");
      expect(matchA?.confidence).toBeGreaterThan(0.8);
      expect(assessmentA.evidenceStrength).toBeGreaterThan(0.8);

      // Assert Tenant B diverged and marked capability as missing due to high path cost
      expect(assessmentB.status).toBe("COMPLETE");
      expect(assessmentB.missingCapabilities.some((c) => c.includes("custom_growth_architecture"))).toBe(true);
      expect(assessmentB.evidenceStrength).toBeLessThan(0.4);

      // Assert Tenant A and B have completely isolated, different evidence strengths
      expect(assessmentA.evidenceStrength).not.toBe(assessmentB.evidenceStrength);
    });
  });
});
