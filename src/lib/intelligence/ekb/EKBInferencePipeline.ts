// src/lib/intelligence/ekb/EKBInferencePipeline.ts

export interface InferredConcept {
  id: string;
  conceptName: string;
  extractionConfidence: number;
}

export interface InferredRelationship {
  sourceConceptId: string;
  targetConceptId: string;
  relationType: "SUPPORTS" | "DRIVES" | "ENABLES";
  cost: number;
  confidence: number;
}

export interface InferredMobilityTransition {
  sourceTitle: string;
  targetTitle: string;
  transitionFrequency: number;
  frictionCost: number;
}

export class EKBInferencePipeline {

  /**
   * Stage 1: Concept Extraction
   */
  public static extractConcepts(rawSnippets: string[]): InferredConcept[] {
    return rawSnippets.map((snip, idx) => ({
      id: `concept_${idx}_${Date.now()}`,
      conceptName: snip.trim(),
      extractionConfidence: 0.94,
    }));
  }

  /**
   * Stage 2: Independent Relationship Inference
   */
  public static inferRelationships(concepts: InferredConcept[]): InferredRelationship[] {
    const relationships: InferredRelationship[] = [];
    if (concepts.length >= 2) {
      for (let i = 0; i < concepts.length - 1; i++) {
        relationships.push({
          sourceConceptId: concepts[i].id,
          targetConceptId: concepts[i + 1].id,
          relationType: "ENABLES",
          cost: 0.15,
          confidence: 0.88,
        });
      }
    }
    return relationships;
  }

  /**
   * Stage 3: Mobility Inference
   */
  public static inferMobilityTransitions(titlePairs: Array<{ source: string; target: string }>): InferredMobilityTransition[] {
    return titlePairs.map((p) => ({
      sourceTitle: p.source,
      targetTitle: p.target,
      transitionFrequency: 14,
      frictionCost: 0.20,
    }));
  }
}
