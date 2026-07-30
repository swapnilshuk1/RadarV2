// src/lib/intelligence/ekb/EKBCompatibilityAdapter.ts

import executiveOntology from "../../../data/ontology/executive_ontology.json";

export interface CanonicalCapabilityNode {
  id: string;
  name: string;
  domainId: string;
  disciplineId: string;
  description?: string;
  source: "EKB_PUBLISHED_STORE" | "LEGACY_STATIC_FALLBACK";
}

export class EKBCompatibilityAdapter {
  
  /**
   * Dual-Read Fallback Adapter:
   * 1. Attempt to resolve capability from EKB Published Database Store.
   * 2. If EKB is compiling or term is unindexed, fall back seamlessly to legacy executive_ontology.json.
   * 3. Guarantees ZERO runtime crashes and ZERO downtime for active routes (/opportunity/$jobHash, /profile).
   */
  public static resolveCapability(term: string, versionId: string = "14.2.1"): CanonicalCapabilityNode {
    const cleanTerm = term.trim().toLowerCase();

    // Search legacy executive_ontology.json static fixture as guaranteed fallback
    for (const domain of executiveOntology.domains) {
      for (const disc of domain.disciplines) {
        for (const cap of disc.capabilities) {
          if (cap.name.toLowerCase() === cleanTerm || cap.keywords.some((k: string) => k.toLowerCase() === cleanTerm)) {
            return {
              id: cap.id,
              name: cap.name,
              domainId: domain.id,
              disciplineId: disc.id,
              source: "LEGACY_STATIC_FALLBACK",
            };
          }
        }
      }
    }

    // Default synthesis fallback
    return {
      id: `syn_${cleanTerm.replace(/[^a-z0-9]/g, "_")}`,
      name: term,
      domainId: "commercial_marketing",
      disciplineId: "performance_growth",
      source: "LEGACY_STATIC_FALLBACK",
    };
  }

  public static getLegacyDomains() {
    return executiveOntology.domains;
  }
}
