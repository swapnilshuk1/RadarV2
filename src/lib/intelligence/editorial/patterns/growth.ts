import type { EditorialPattern } from "../EditorialPattern";

// 1. The Commercial Builder
export const growthCommercialBuilderPattern: EditorialPattern = {
  id: "growth-builder-1a",
  patternFamily: "growth",
  skeleton: "observation-first",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  executiveIdentity: "Builder",
  editorialPurpose: "Frame career move",
  editorialRisk: "commercial",
  editorialThesis: "Commercial Ownership Concentration",
  editorialIntent: {
    primaryMessage: "commercial_concentration",
    supportingThemes: ["pnl_scope", "ununified_growth"],
    avoidThemes: ["marketing_hype", "promo_copy"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 50
    }
  },
  slots: {
    headline: (v) => `Commercial execution is unusually concentrated in this ${v.role} position at ${v.company}.`,
    opening: (v) => `Unlike conventional functional roles, this position unifies pricing authority, channel expansion, and P&L accountability under one owner.`,
    editorialBridge: (v) => `The organization is shifting from distributed sales efforts to a single commercial accountability model, increasing decision speed without broadening administrative overhead.`,
    decisionGuidance: {
      proceedIf: (v) => `Direct commercial ownership and top-line accountability align with your operating history.`,
      pauseIf: (v) => `Clarify the boundaries of direct budget authority versus regional matrix approvals during initial conversations.`,
      closing: (v) => `Proceed to screening. Direct commercial authority without the organizational bureaucracy typical of similar mandates.`
    }
  }
};

// 2. The Scale Operator
export const growthScaleOperatorPattern: EditorialPattern = {
  id: "growth-scaler-1b",
  patternFamily: "growth",
  skeleton: "consequence-first",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  executiveIdentity: "Scaler",
  editorialPurpose: "Highlight trade-off",
  editorialRisk: "commercial",
  editorialThesis: "Category Market Share & Unit Economics",
  editorialIntent: {
    primaryMessage: "growth_margin_balance",
    supportingThemes: ["unit_economics", "market_penetration"],
    avoidThemes: ["unconstrained_burn"]
  },
  constraints: {
    requires: {
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `${v.company} requires a ${v.role} who can expand market share without eroding contribution margins.`,
    opening: (v) => `Rather than pursuing top-line volume at any cost, the business requires an operator who can expand market share while protecting gross margins.`,
    editorialBridge: (v) => `Compared with your recent operating scope, this mandate demands tighter integration between acquisition spend and customer lifetime value.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling customer acquisition while enforcing contribution margin discipline matches your playbook.`,
      pauseIf: (v) => `Ask for CAC and payback by cohort for the last eight quarters before advancing.`,
      closing: (v) => `Consider. A structured commercial role for executives who pair growth velocity with financial rigor.`
    }
  }
};

// 3. The Category Leader
export const growthCategoryLeaderPattern: EditorialPattern = {
  id: "growth-category-1c",
  patternFamily: "growth",
  skeleton: "fact-first",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  executiveIdentity: "Category Leader",
  editorialPurpose: "Increase conviction",
  editorialRisk: "commercial",
  editorialThesis: "Category Dominance & Pricing Power",
  editorialIntent: {
    primaryMessage: "category_positioning",
    supportingThemes: ["pricing_power", "market_dominance"],
    avoidThemes: ["commodity_competition"]
  },
  constraints: {
    requires: {
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `${v.company} holds market share in its core segment; this ${v.role} mandate is about translating that position into pricing power.`,
    opening: (v) => `The business has established distribution. The task is consolidating market presence and raising gross margins across primary channels.`,
    editorialBridge: (v) => `The position leverages brand equity to expand into adjacent categories with lower customer acquisition friction.`,
    decisionGuidance: {
      proceedIf: (v) => `Defending margin pricing power and expanding category boundaries fit your strategic trajectory.`,
      pauseIf: (v) => `Gross margins are under pressure from low-cost regional competitors.`,
      closing: (v) => `Pursue. Clear market leverage and immediate category visibility.`
    }
  }
};
