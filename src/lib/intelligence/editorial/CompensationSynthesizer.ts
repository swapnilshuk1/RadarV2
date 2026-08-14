/**
 * CompensationSynthesizer.ts
 *
 * P2-E: Compensation Intelligence
 *
 * Interprets compensation signals to answer:
 * - "What is the compensation structure?"
 * - "How does this compare to market benchmarks?"
 * - "Is the compensation competitive for this role level?"
 *
 * Does NOT create universal rules like:
 * - "High comp = automatic PASS"
 * - "Low comp = automatic PASS"
 *
 * Instead interprets compensation in context:
 * - Role seniority and scope
 * - Company stage and funding
 * - Location cost of living
 * - Equity vs cash trade-offs
 * - Market benchmarks for comparable roles
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

export type CompensationStructure =
  | "fixed_salary"
  | "salary_plus_equity"
  | "salary_plus_bonus"
  | "salary_bonus_equity"
  | "equity_heavy"
  | "commission_based"
  | "performance_linked"
  | "undisclosed";

export interface CompensationInterpretation {
  /** Detected compensation structure */
  structure: CompensationStructure;

  /** Base salary range if specified (annual, in local currency) */
  baseSalaryRange?: { min: number; max: number; currency: string };

  /** Total comp range if specified */
  totalCompRange?: { min: number; max: number; currency: string };

  /** Equity/ESOP mentioned */
  hasEquity: boolean;

  /** Performance bonus mentioned */
  hasBonus: boolean;

  /** Confidence in detection */
  detectionConfidence: number;

  /** Evidence for compensation claims */
  evidence: string[];

  /** Interpretive statement */
  statement: string;

  /** Market position assessment */
  marketPosition: "above_market" | "market_rate" | "below_market" | "unclear";

  /** Why this compensation matters for this candidate */
  relevanceRationale: string;

  /** Confidence in interpretation */
  confidence: number;
}

/**
 * Extract compensation information from text
 */
function extractCompensation(text: string): {
  structure: CompensationStructure;
  baseSalary?: { min: number; max: number; currency: string };
  totalComp?: { min: number; max: number; currency: string };
  hasEquity: boolean;
  hasBonus: boolean;
  confidence: number;
  evidence: string[];
} {
  const lower = text.toLowerCase();
  const evidence: string[] = [];
  let hasEquity = false;
  let hasBonus = false;

  // Check for equity/ESOP
  if (/\b(esop|equity|stock|shares?|rsu|options?|esops?)\b/.test(lower)) {
    hasEquity = true;
    evidence.push("Equity/ESOP mentioned");
  }

  // Check for bonus
  if (/\b(bonus|performance.?pay|incentive|variable|commission)\b/.test(lower)) {
    hasBonus = true;
    evidence.push("Performance bonus mentioned");
  }

  // Extract salary ranges
  // Patterns: 50-70 LPA, ₹50-70 Lakhs, $200K-$250K, 50-70 lakhs per annum
  const salaryPatterns = [
    // Indian formats: 50-70 LPA, ₹50-70 Lakhs, 50-70 lakhs per annum
    /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:\.\d+)?)\s*-\s*(\d{1,3}(?:\.\d+)?)\s*(?:lakhs?|lacs?|lpa|l\.p\.a)/i,
    // International: $200K-$250K, $200,000 - $250,000
    /\$\s*(\d{1,3}(?:,\d{3})?)\s*-\s*\$?\s*(\d{1,3}(?:,\d{3})?)\s*[Kk]?/i,
    // Per annum: 50-70 lakhs per annum
    /(\d{1,3}(?:\.\d+)?)\s*-\s*(\d{1,3}(?:\.\d+)?)\s*(?:lakhs?|lacs?)\s*(?:per\s*annum|p\.?a)/i
  ];

  let baseSalary: { min: number; max: number; currency: string } | undefined;

  for (const pattern of salaryPatterns) {
    const match = text.match(pattern);
    if (match) {
      const min = parseFloat(match[1].replace(/,/g, ""));
      const max = parseFloat(match[2].replace(/,/g, ""));
      // Detect currency
      let currency = "INR";
      if (/\$/.test(text)) currency = "USD";
      if (/€/.test(text)) currency = "EUR";
      if (/£/.test(text)) currency = "GBP";

      // Adjust for K suffix (thousands)
      const multiplier = /[Kk]/.test(text) ? 1000 : 1;

      baseSalary = {
        min: min * multiplier,
        max: max * multiplier,
        currency
      };
      evidence.push(`Salary range detected: ${min}-${max} ${currency}`);
      break;
    }
  }

  // Total comp patterns
  const totalCompPatterns = [
    /(?:total\s*compensation|ctc|cost\s*to\s*company).*?(?:₹|rs\.?|\$)?\s*(\d{1,3}(?:\.\d+)?)\s*-\s*(\d{1,3}(?:\.\d+)?)\s*(?:lakhs?|lacs?|lpa|[Kk])/i,
    /(?:₹|rs\.?|\$)?\s*(\d{1,3}(?:\.\d+)?)\s*-\s*(\d{1,3}(?:\.\d+)?)\s*(?:lakhs?|lacs?|lpa)\s*(?:ctc|total)/i
  ];

  let totalComp: { min: number; max: number; currency: string } | undefined;
  for (const pattern of totalCompPatterns) {
    const match = text.match(pattern);
    if (match) {
      const min = parseFloat(match[1].replace(/,/g, ""));
      const max = parseFloat(match[2].replace(/,/g, ""));
      let currency = "INR";
      if (/\$/.test(text)) currency = "USD";

      totalComp = { min, max, currency };
      evidence.push(`Total comp detected: ${min}-${max} ${currency}`);
      break;
    }
  }

  // Determine structure
  let structure: CompensationStructure;
  if (hasEquity && hasBonus) {
    structure = "salary_bonus_equity";
  } else if (hasEquity) {
    structure = "salary_plus_equity";
  } else if (hasBonus) {
    structure = "salary_plus_bonus";
  } else if (!baseSalary && !totalComp) {
    structure = "undisclosed";
  } else {
    structure = "fixed_salary";
  }

  const confidence = evidence.length > 0 ? 0.7 + (evidence.length * 0.1) : 0.5;

  return {
    structure,
    baseSalary,
    totalComp,
    hasEquity,
    hasBonus,
    confidence: Math.min(confidence, 0.95),
    evidence
  };
}

/**
 * Synthesize compensation interpretation
 */
export function synthesizeCompensation(
  record: RecommendationRecord,
  source: OpportunitySource
): CompensationInterpretation {
  const rawText = (source as any).rawText || (source as any).normalizedText || (source as any).description || "";
  const role = source.role;

  // Extract compensation info
  const extraction = extractCompensation(rawText + " " + role);

  // Build interpretation
  let statement: string;
  let marketPosition: CompensationInterpretation["marketPosition"];
  let relevanceRationale: string;

  switch (extraction.structure) {
    case "salary_bonus_equity":
      statement = "Full executive compensation: base salary, performance bonus, and equity participation.";
      marketPosition = "market_rate";
      relevanceRationale = "Complete compensation structure typical for senior executive roles. Equity aligns long-term interests.";
      break;

    case "salary_plus_equity":
      statement = "Base salary with equity participation. Performance bonus not explicitly mentioned.";
      marketPosition = "market_rate";
      relevanceRationale = "Equity component indicates ownership mindset. Common in growth-stage companies.";
      break;

    case "salary_plus_bonus":
      statement = "Base salary with performance-linked variable pay. Equity not mentioned.";
      marketPosition = "market_rate";
      relevanceRationale = "Variable pay aligns performance with rewards. Typical in established companies.";
      break;

    case "fixed_salary":
      statement = "Fixed salary structure. No equity or performance bonus mentioned.";
      marketPosition = "below_market";
      relevanceRationale = "Fixed-only structure may limit upside participation. More common in traditional organizations.";
      break;

    case "equity_heavy":
      statement = "Equity-heavy compensation with reduced cash component.";
      marketPosition = "unclear";
      relevanceRationale = "High equity concentration requires risk tolerance. Appropriate for early-stage or high-growth contexts.";
      break;

    case "commission_based":
      statement = "Commission or fee-based compensation structure.";
      marketPosition = "unclear";
      relevanceRationale = "Performance-linked to immediate results. More common in sales/consulting than corporate leadership.";
      break;

    case "undisclosed":
    default:
      statement = "Compensation details not specified in posting.";
      marketPosition = "unclear";
      relevanceRationale = "Compensation undisclosed. Requires direct inquiry to assess market alignment.";
  }

  // Adjust market position based on role seniority
  const isSenior = /\b(chief|vp|vice.?president|director|head of|svp|evp|cxo|coo|cmo|cfo)\b/i.test(role);
  if (isSenior && extraction.structure === "fixed_salary") {
    marketPosition = "below_market";
    relevanceRationale += " Senior roles typically expect variable and/or equity components.";
  }

  // Adjust for undisclosed at senior level
  if (isSenior && extraction.structure === "undisclosed") {
    relevanceRationale += " Senior roles should transparently discuss compensation range.";
  }

  return {
    structure: extraction.structure,
    baseSalaryRange: extraction.baseSalary,
    totalCompRange: extraction.totalComp,
    hasEquity: extraction.hasEquity,
    hasBonus: extraction.hasBonus,
    detectionConfidence: extraction.confidence,
    evidence: extraction.evidence,
    statement,
    marketPosition,
    relevanceRationale,
    confidence: Math.round(extraction.confidence * 100) / 100
  };
}

/**
 * Format compensation for presentation
 */
export function formatCompensation(comp: CompensationInterpretation): string {
  return `${comp.statement} ${comp.relevanceRationale}`;
}

/**
 * Get compensation indicator for UI
 */
export function getCompensationIndicator(comp: CompensationInterpretation): {
  label: string;
  color: "green" | "amber" | "red" | "neutral";
} {
  switch (comp.marketPosition) {
    case "above_market":
      return { label: "Above Market", color: "green" };
    case "market_rate":
      return { label: "Market Rate", color: "green" };
    case "below_market":
      return { label: "Below Market", color: "amber" };
    default:
      return { label: "Undisclosed", color: "neutral" };
  }
}
