/**
 * OntologyResolver.ts
 *
 * Deterministically maps normalized EvidenceGraph facts to canonical RADAR V4 Ontology Capabilities.
 * Ignores low-confidence facts during resolution, but does NOT modify or delete facts from the source graph.
 */

import type { EvidenceGraph } from "../../../domain/evidence";
import { CapabilityRegistry, type CapabilityRegistryEntry } from "../../capability/Registry";

export interface ResolvedClaim {
  statement: string;
  capabilityId: string;
  evidenceIds: string[];
  confidence: number;
}

export interface ResolvedOntology {
  evidenceGraphId: string;
  resolvedCapabilities: string[];
  resolvedClaims: ResolvedClaim[];
  resolvedSkills: string[];
  ignoredFactsCount: number;
}

export class OntologyResolver {
  public static resolve(graph: EvidenceGraph, minConfidenceThreshold = 0.40): ResolvedOntology {
    const resolvedCapIds = new Set<string>();
    const resolvedClaims: ResolvedClaim[] = [];
    const resolvedSkills = new Set<string>();
    let ignoredFactsCount = 0;

    for (const fact of graph.facts) {
      // Filter out low-confidence facts during ontology resolution
      if (fact.confidence < minConfidenceThreshold) {
        ignoredFactsCount++;
        continue;
      }

      // Lookup against CapabilityRegistry
      const match: CapabilityRegistryEntry | null = CapabilityRegistry.lookup(fact.value);

      if (match) {
        resolvedCapIds.add(match.id);
        resolvedClaims.push({
          statement: fact.value,
          capabilityId: match.id,
          evidenceIds: [fact.id],
          confidence: fact.confidence
        });
      }

      // Extra taxonomy extraction based on fact types
      if (fact.type === "TECHNOLOGY" || fact.type === "ACHIEVEMENT") {
        resolvedSkills.add(fact.value);
      }
    }

    return {
      evidenceGraphId: graph.id,
      resolvedCapabilities: Array.from(resolvedCapIds),
      resolvedClaims,
      resolvedSkills: Array.from(resolvedSkills),
      ignoredFactsCount
    };
  }
}
