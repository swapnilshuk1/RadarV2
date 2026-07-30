// src/lib/intelligence/extraction/OntologyResolver.ts

import type { EvidenceGraph } from "../../../domain/evidence";
import { CapabilityRegistry, type CapabilityRegistryEntry } from "../../capability/Registry";
import { EKBConceptResolver } from "../ekb/EKBConceptResolver";
import { EKBProposalEngine } from "../ekb/EKBProposalEngine";

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
  unmappedTermsDetected: string[];
}

export class OntologyResolver {
  public static resolve(graph: EvidenceGraph, minConfidenceThreshold = 0.40): ResolvedOntology {
    const resolvedCapIds = new Set<string>();
    const resolvedClaims: ResolvedClaim[] = [];
    const resolvedSkills = new Set<string>();
    const unmappedTermsDetected: string[] = [];
    let ignoredFactsCount = 0;

    for (const fact of graph.facts) {
      if (fact.confidence < minConfidenceThreshold) {
        ignoredFactsCount++;
        continue;
      }

      // 1. Primary Lookup against CapabilityRegistry
      const match: CapabilityRegistryEntry | null = CapabilityRegistry.lookup(fact.value);

      if (match) {
        resolvedCapIds.add(match.id);
        resolvedClaims.push({
          statement: fact.value,
          capabilityId: match.id,
          evidenceIds: [fact.id],
          confidence: fact.confidence,
        });
      } else {
        // 2. Hierarchical EKB Concept Resolver (Fast Runtime Resolution)
        void EKBConceptResolver.resolveConcept(fact.value).then((concept) => {
          if (concept.resolvedConceptId) {
            resolvedCapIds.add(concept.resolvedConceptId);
          } else if (concept.resolutionMethod === "LLM_SYNTHESIS_REQUIRED") {
            // Log unmapped candidate term asynchronously to Proposal Queue
            unmappedTermsDetected.push(fact.value);
            EKBProposalEngine.submitProposal("NEW_CAPABILITY", "unclassified", {
              rawTerm: fact.value,
              sourceDocumentId: graph.provenance.documentId,
              personId: graph.personId,
            });
          }
        });
      }

      if (fact.type === "TECHNOLOGY" || fact.type === "ACHIEVEMENT") {
        resolvedSkills.add(fact.value);
      }
    }

    return {
      evidenceGraphId: graph.id,
      resolvedCapabilities: Array.from(resolvedCapIds),
      resolvedClaims,
      resolvedSkills: Array.from(resolvedSkills),
      ignoredFactsCount,
      unmappedTermsDetected,
    };
  }
}
