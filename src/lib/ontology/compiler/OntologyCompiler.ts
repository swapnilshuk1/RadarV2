/**
 * OntologyCompiler.ts
 *
 * Phase M2: Deterministic Tenant Ontology Compiler.
 *
 * Invariants:
 * 1. Canonical Ontology v3 remains 100% immutable and unmutated across all tenant compilations.
 * 2. Compiling Tenant A and Tenant B produces isolated, non-contaminating outputs.
 * 3. Semantic Fingerprint Invariant: compiledOntologyHash = SHA-256(version + compiledOntology).
 *    Tenant identity (tenantId) belongs in EvaluationContext / authorization boundary, NOT the semantic fingerprint.
 *    Two tenants with identical semantic configurations produce the exact same compiledOntologyHash.
 * 4. Additive Specialization: customKeywords are extensions, not destructive overrides.
 * 5. Extraction Sensitivity: excludedTerms alter tenant-specific extraction sensitivity (narrowing)
 *    without mutating or deleting the global canonical ontology baseline.
 * 6. Determinism: identical inputs produce identical compiledOntologyHash across independent executions.
 * 7. Tenantization is strictly upstream of V4 DecisionPolicyEngine.
 */

import crypto from "node:crypto";
import type {
  CanonicalOntologyGraph,
  TenantOntologyConfig,
  CompiledOntology,
  OntologyDomain,
  OntologyDiscipline,
  OntologyKeywordItem,
} from "./types";
import canonicalExecutiveOntology from "@/data/ontology/executive_ontology.json";

/**
 * Deterministically normalizes any JavaScript object or array:
 * - Object keys are sorted lexicographically.
 * - Array elements are sorted deterministically (by string value or by .id for objects).
 * - Strings are trimmed.
 */
export function canonicalNormalize(val: unknown): unknown {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === "string") {
    return val.trim();
  }

  if (Array.isArray(val)) {
    const normalizedItems = val.map(canonicalNormalize);
    // Sort string arrays lexicographically
    if (normalizedItems.every((item) => typeof item === "string")) {
      return [...(normalizedItems as string[])].sort((a, b) => a.localeCompare(b));
    }
    // Sort object arrays by id if all items have an id
    if (normalizedItems.every((item) => item && typeof item === "object" && "id" in (item as any))) {
      return [...(normalizedItems as Array<{ id: string }>)].sort((a, b) =>
        String(a.id).localeCompare(String(b.id))
      );
    }
    return normalizedItems;
  }

  if (typeof val === "object") {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(val as Record<string, unknown>).sort();
    for (const key of keys) {
      sortedObj[key] = canonicalNormalize((val as Record<string, unknown>)[key]);
    }
    return sortedObj;
  }

  return val;
}

/**
 * Serializes normalized data to a deterministic JSON string.
 */
export function deterministicSerialize(data: unknown): string {
  const normalized = canonicalNormalize(data);
  return JSON.stringify(normalized);
}

/**
 * Computes SHA-256 fingerprint from deterministic serialization.
 */
export function computeDeterministicHash(data: unknown): string {
  const serialized = deterministicSerialize(data);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

/**
 * Deep clones a canonical ontology graph to guarantee immutability of the source.
 */
function cloneOntologyGraph(source: CanonicalOntologyGraph): CanonicalOntologyGraph {
  return JSON.parse(JSON.stringify(source));
}

/**
 * Validates entity ID uniqueness across domains, disciplines, and capabilities.
 */
export function validateOntologyGraphUniqueness(graph: CanonicalOntologyGraph): void {
  const domainIds = new Set<string>();
  for (const domain of graph.domains) {
    if (domainIds.has(domain.id)) {
      throw new Error(`Duplicate domain ID detected in ontology: '${domain.id}'`);
    }
    domainIds.add(domain.id);

    const disciplineIds = new Set<string>();
    for (const discipline of domain.disciplines) {
      if (disciplineIds.has(discipline.id)) {
        throw new Error(
          `Duplicate discipline ID detected in domain '${domain.id}': '${discipline.id}'`
        );
      }
      disciplineIds.add(discipline.id);

      const capabilityIds = new Set<string>();
      for (const cap of discipline.capabilities) {
        if (capabilityIds.has(cap.id)) {
          throw new Error(
            `Duplicate capability ID detected in discipline '${discipline.id}': '${cap.id}'`
          );
        }
        capabilityIds.add(cap.id);
      }
    }
  }
}

/**
 * Compiles a tenant-scoped executable ontology graph from the immutable Canonical Ontology v3
 * and optional tenant configuration overrides.
 *
 * Guarantees:
 * - The input canonicalOntology is NEVER mutated.
 * - All domains, disciplines, capabilities, and keywords are deterministically sorted.
 * - Produces an immutable CompiledOntology with a purely semantic cryptographic SHA-256 fingerprint.
 */
export function compileTenantOntology(
  canonicalOntology: CanonicalOntologyGraph = canonicalExecutiveOntology as CanonicalOntologyGraph,
  tenantConfig?: TenantOntologyConfig
): CompiledOntology {
  const tenantId = tenantConfig?.tenantId || "canonical";
  const clonedGraph = cloneOntologyGraph(canonicalOntology);

  const excludedTermsSet = new Set(
    (tenantConfig?.excludedTerms || []).map((t) => t.trim().toLowerCase())
  );

  // Apply custom keyword extensions to existing capabilities
  if (tenantConfig?.customKeywords && tenantConfig.customKeywords.length > 0) {
    const keywordExtensionMap = new Map<string, string[]>();
    for (const extension of tenantConfig.customKeywords) {
      const existing = keywordExtensionMap.get(extension.capabilityId) || [];
      keywordExtensionMap.set(extension.capabilityId, [...existing, ...extension.keywords]);
    }

    for (const domain of clonedGraph.domains) {
      for (const discipline of domain.disciplines) {
        for (const cap of discipline.capabilities) {
          const extensions = keywordExtensionMap.get(cap.id);
          if (extensions && extensions.length > 0) {
            cap.keywords = Array.from(new Set([...cap.keywords, ...extensions]));
          }
        }
      }
    }
  }

  // Apply custom capability additions
  if (tenantConfig?.customCapabilities && tenantConfig.customCapabilities.length > 0) {
    for (const customCap of tenantConfig.customCapabilities) {
      let targetDomain = clonedGraph.domains.find((d) => d.id === customCap.domainId);
      if (!targetDomain) {
        targetDomain = {
          id: customCap.domainId,
          name: customCap.domainId,
          disciplines: [],
        };
        clonedGraph.domains.push(targetDomain);
      }

      let targetDiscipline = targetDomain.disciplines.find((disc) => disc.id === customCap.disciplineId);
      if (!targetDiscipline) {
        targetDiscipline = {
          id: customCap.disciplineId,
          name: customCap.disciplineId,
          capabilities: [],
        };
        targetDomain.disciplines.push(targetDiscipline);
      }

      // Check if capability already exists in discipline; if so, append keywords/responsibilities, else insert
      const existingCap = targetDiscipline.capabilities.find((c) => c.id === customCap.capability.id);
      if (existingCap) {
        existingCap.keywords = Array.from(
          new Set([...existingCap.keywords, ...customCap.capability.keywords])
        );
        if (customCap.capability.responsibilities) {
          existingCap.responsibilities = Array.from(
            new Set([...(existingCap.responsibilities || []), ...customCap.capability.responsibilities])
          );
        }
      } else {
        targetDiscipline.capabilities.push({
          id: customCap.capability.id,
          name: customCap.capability.name,
          keywords: [...customCap.capability.keywords],
          responsibilities: customCap.capability.responsibilities ? [...customCap.capability.responsibilities] : undefined,
        });
      }
    }
  }

  // Filter out excluded terms across all capabilities (extraction sensitivity narrowing)
  if (excludedTermsSet.size > 0) {
    for (const domain of clonedGraph.domains) {
      for (const discipline of domain.disciplines) {
        for (const cap of discipline.capabilities) {
          cap.keywords = cap.keywords.filter((kw) => !excludedTermsSet.has(kw.trim().toLowerCase()));
        }
      }
    }
  }

  // Canonical normalization passes over the entire graph
  const normalizedGraph = canonicalNormalize(clonedGraph) as CanonicalOntologyGraph;

  // Validate structural integrity and ID uniqueness
  validateOntologyGraphUniqueness(normalizedGraph);

  // Generate deterministic purely semantic SHA-256 hash
  // (tenantId is excluded to maintain semantic compilation equivalence)
  const semanticHashPayload = {
    version: normalizedGraph.version,
    ontology: normalizedGraph,
  };

  const compiledOntologyHash = computeDeterministicHash(semanticHashPayload);

  return {
    version: normalizedGraph.version,
    tenantId,
    compiledOntologyHash,
    ontology: normalizedGraph,
  };
}

/**
 * Helper to get the canonical base ontology v3 without tenant overrides.
 */
export function getCanonicalOntology(): CanonicalOntologyGraph {
  return cloneOntologyGraph(canonicalExecutiveOntology as CanonicalOntologyGraph);
}
