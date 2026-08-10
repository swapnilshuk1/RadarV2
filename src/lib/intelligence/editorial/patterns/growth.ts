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
    headline: (v) => `Commercial accountability is unified under this ${v.role} mandate at ${v.company}.`,
    opening: (v) => `Unlike conventional functional roles, this seat consolidates pricing authority, channel expansion, and P&L accountability under a single owner.`,
    editorialBridge: (v) => `The organization is shifting from fragmented sales efforts to a centralized commercial model, accelerating decision velocity without adding management layers.`,
    decisionGuidance: {
      proceedIf: (v) => `Direct P&L ownership and top-line expansion align with your operating history.`,
      pauseIf: (v) => `Verify direct budget authority versus regional matrix approvals during initial discussions.`,
      closing: (v) => `Proceed. Direct commercial authority with minimal organizational bureaucracy.`
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
    headline: (v) => `${v.company} requires a ${v.role} to expand market share without eroding contribution margins.`,
    opening: (v) => `Rather than pursuing top-line volume at any cost, the business demands an operator who expands customer reach while defending gross margins.`,
    editorialBridge: (v) => `This mandate requires tight coordination between customer acquisition expenditure and long-term cohort value.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling acquisition while enforcing contribution margin discipline matches your playbook.`,
      pauseIf: (v) => `Request CAC trends and payback by cohort for the last eight quarters before advancing.`,
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
    headline: (v) => `${v.company} holds distribution in its core segment; this ${v.role} mandate translates that reach into pricing power.`,
    opening: (v) => `The distribution infrastructure is established; the objective is consolidating category presence and raising gross margins.`,
    editorialBridge: (v) => `The position leverages brand equity to enter adjacent categories with lower customer acquisition friction.`,
    decisionGuidance: {
      proceedIf: (v) => `Defending pricing power and expanding category boundaries fit your trajectory.`,
      pauseIf: (v) => `Gross margins face persistent pressure from low-cost regional competitors.`,
      closing: (v) => `Proceed. Strong market leverage and immediate category visibility.`
    }
  }
};
