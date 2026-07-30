// src/lib/intelligence/editorial/ExecutiveReadingModel.ts

import type { EditorialIntent } from "./EditorialIntent";
import type { BriefModel } from "./BriefModel";

export interface DecisionQuestion {
  id: string;
  question: string;
  answer: string;
  editorialIntent: EditorialIntent;
  informationDensity: "COMPACT" | "STANDARD" | "EXPANSIVE";
  supportingEvidence?: string[];
}

export class ExecutiveReadingModel {
  /**
   * Transforms a BriefModel into a dynamic array of DecisionQuestions based on executive intent.
   */
  public static deriveQuestions(brief: BriefModel): DecisionQuestion[] {
    const questions: DecisionQuestion[] = [];
    const isPursue = brief.memory.decision === "PURSUE";
    const primaryIntent = (brief.strategy.primaryFocus as EditorialIntent) || "CAREER";

    // Question 1: Should I pursue this?
    questions.push({
      id: "PURSUIT_VERDICT",
      question: "Should I pursue this?",
      answer: `${brief.memory.decision}: ${brief.memory.retentionSentence}`,
      editorialIntent: primaryIntent,
      informationDensity: isPursue ? "EXPANSIVE" : "COMPACT",
    });

    // Question 2: Why? (Core Story)
    questions.push({
      id: "PRIMARY_RATIONALE",
      question: "Why this opportunity?",
      answer: brief.memory.primaryOpportunity,
      editorialIntent: primaryIntent,
      informationDensity: isPursue ? "EXPANSIVE" : "STANDARD",
    });

    // Question 3: What is the strategic trade-off?
    questions.push({
      id: "CAREER_TRADEOFF",
      question: "What is the strategic trade-off?",
      answer: brief.memory.tradeoff,
      editorialIntent: primaryIntent,
      informationDensity: "STANDARD",
    });

    // Question 4: Why now? (Catalyst)
    questions.push({
      id: "TIMING_CATALYST",
      question: "Why is this role open now?",
      answer: brief.memory.whyNow,
      editorialIntent: primaryIntent,
      informationDensity: "STANDARD",
    });

    // Question 5: What is the first execution challenge?
    questions.push({
      id: "FIRST_90_DAYS",
      question: "What happens in the first 90 days?",
      answer: brief.memory.first90Days,
      editorialIntent: "EXECUTION",
      informationDensity: isPursue ? "EXPANSIVE" : "COMPACT",
    });

    // Question 6: What should I verify?
    questions.push({
      id: "VERIFICATION_LEDGER",
      question: "What should I verify during screening?",
      answer: brief.memory.primaryRisk,
      editorialIntent: "TURNAROUND",
      informationDensity: "STANDARD",
    });

    return questions;
  }
}
