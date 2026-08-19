/**
 * types.ts
 *
 * Phase M2: Formal TypeScript Contracts for Tenant Ontology Compilation.
 */

export interface OntologyKeywordItem {
  id: string;
  name: string;
  keywords: string[];
  responsibilities?: string[];
}

export interface OntologyDiscipline {
  id: string;
  name: string;
  capabilities: OntologyKeywordItem[];
  responsibilities?: string[];
}

export interface OntologyDomain {
  id: string;
  name: string;
  disciplines: OntologyDiscipline[];
}

export interface CanonicalOntologyGraph {
  version: string;
  systemName: string;
  domains: OntologyDomain[];
  relationshipGraph?: Array<{
    source: string;
    target: string;
    relation: string;
    cost?: number;
  }>;
}

export interface CustomCapabilityDefinition {
  domainId: string;
  disciplineId: string;
  capability: {
    id: string;
    name: string;
    keywords: string[];
    responsibilities?: string[];
  };
}

/**
 * Additive keyword extension for a capability.
 * Specializes/extends the canonical keyword pool without redefining canonical capability identity.
 */
export interface CustomKeywordExtension {
  capabilityId: string;
  keywords: string[];
}

export interface TenantOntologyConfig {
  tenantId: string;
  version?: string;
  customCapabilities?: CustomCapabilityDefinition[];
  customKeywords?: CustomKeywordExtension[];
  /**
   * Tenant exclusions may alter extraction sensitivity (narrowing)
   * but may not delete or mutate canonical ontology concepts themselves.
   */
  excludedTerms?: string[];
}

export interface CompiledOntology {
  version: string;
  tenantId: string;
  /**
   * Semantic ontology fingerprint:
   * SHA-256 hash of (version + normalized compiled ontology graph).
   * Purely semantic — independent of tenantId. Two tenants with identical
   * semantic configurations produce the exact same compiledOntologyHash.
   */
  compiledOntologyHash: string;
  ontology: CanonicalOntologyGraph;
}
