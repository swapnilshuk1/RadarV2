// src/lib/intelligence/editorial/AttentionEngine.ts

import type { DecisionQuestion } from "./ExecutiveReadingModel";
import type { EditorialIntent } from "./EditorialIntent";

export type AttentionWeight = "DOMINANT" | "SUPPORTING" | "SUPPLEMENTARY";

export interface AttentionAssignment {
  questionId: string;
  weight: AttentionWeight;
  enterAfterMs: number;
}

export class AttentionEngine {
  /**
   * Assigns semantic attention weights and timing entries to decision questions.
   */
  public static assignWeights(
    questions: DecisionQuestion[],
    primaryIntent: EditorialIntent
  ): AttentionAssignment[] {
    return questions.map((q, idx) => {
      let weight: AttentionWeight = "SUPPORTING";

      if (idx === 0) {
        weight = "DOMINANT";
      } else if (q.editorialIntent === primaryIntent) {
        weight = "DOMINANT";
      } else if (q.id === "VERIFICATION_LEDGER" || q.id === "FIRST_90_DAYS") {
        weight = "SUPPORTING";
      } else {
        weight = "SUPPLEMENTARY";
      }

      return {
        questionId: q.id,
        weight,
        enterAfterMs: idx * 120, // Staggered reveal timing
      };
    });
  }
}
