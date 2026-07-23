// src/lib/intelligence/policy/DecisionRule.ts

import { DecisionRule } from "../../domain/semantic";

export const DECISION_RULES: DecisionRule[] = [
  // 1. Executive Operating Level Regression (Veto Gate)
  {
    id: "R-900",
    priority: 900,
    conditions: [
      {
        dimension: "OPPORTUNITY",
        field: "operatingLevelAssessment",
        operator: "EQUALS",
        value: "REGRESSION_MAJOR"
      }
    ],
    action: "PASS",
    rationale: "This role operates at a managerial or tactical scale, representing a severe organizational regression from your executive leadership profile."
  },

  // 2. Executive Work Nature Regression (Veto Gate)
  {
    id: "R-800",
    priority: 800,
    conditions: [
      {
        dimension: "OPPORTUNITY",
        field: "workNatureAssessment",
        operator: "EQUALS",
        value: "REGRESSION"
      }
    ],
    action: "PASS",
    rationale: "This role's work nature is tactical or execution-focused, representing a backward trajectory from your strategic/executive focus."
  },

  // 3. Afternoon Shift/Schedule Mismatch Veto
  {
    id: "R-700",
    priority: 700,
    conditions: [
      {
        dimension: "LIFESTYLE",
        field: "scheduleFit",
        operator: "EQUALS",
        value: false
      }
    ],
    action: "PASS",
    rationale: "This role requires operating on an afternoon, night, or late-night shift, which conflicts with your scheduling preference."
  },

  // 4. Location Hard Veto
  {
    id: "R-710",
    priority: 710,
    conditions: [
      {
        dimension: "LIFESTYLE",
        field: "locationFit",
        operator: "EQUALS",
        value: false
      }
    ],
    action: "PASS",
    rationale: "This role is located outside of your preferred geographic target regions."
  },

  // 5. Work Model/Travel Hard Veto
  {
    id: "R-720",
    priority: 720,
    conditions: [
      {
        dimension: "LIFESTYLE",
        field: "travelFit",
        operator: "EQUALS",
        value: false
      }
    ],
    action: "PASS",
    rationale: "The work model requirements (e.g., 100% on-site) do not align with your hybrid or flexible preferences."
  },

  // 6. Direct Executive Match
  {
    id: "R-500",
    priority: 500,
    conditions: [
      {
        dimension: "OPPORTUNITY",
        field: "operatingLevelAssessment",
        operator: "EQUALS",
        value: "MATCH"
      }
    ],
    action: "PURSUE",
    rationale: "An excellent career match that operates at your target executive altitude."
  },

  // 7. Promotion Opportunity
  {
    id: "R-510",
    priority: 510,
    conditions: [
      {
        dimension: "OPPORTUNITY",
        field: "operatingLevelAssessment",
        operator: "EQUALS",
        value: "PROMOTION"
      }
    ],
    action: "PURSUE",
    rationale: "An outstanding career growth opportunity representing a promotion to a higher organizational operating level."
  },

  // 8. Low Capability Match Modifier (Minor regression/adjustment)
  {
    id: "R-300",
    priority: 300,
    conditions: [
      {
        dimension: "CAPABILITY",
        field: "overallFit",
        operator: "LESS_THAN",
        value: 0.5
      }
    ],
    action: "ADJUST_CONFIDENCE",
    rationale: "The role requires critical technical or platform capabilities that do not match your current core experience, reducing matching confidence.",
    confidenceAdjustment: -0.2
  }
];
