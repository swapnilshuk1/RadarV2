/**
 * CompensationEngine.ts
 *
 * P7-A: Compensation Enrichment & Provenance Module
 *
 * Implements the 3-state compensation model (KNOWN, ESTIMATED, UNKNOWN)
 * preserving the strict invariant that compensation MUST NOT alter qualityScore,
 * Decision Policy, Career Value, Capability Match, or Pursuit Friction.
 */

export type CompensationState = "KNOWN" | "ESTIMATED" | "UNKNOWN";

export interface CompensationDetails {
  state: CompensationState;
  displayBand: string;
  badgeLabel: string;
  badgeType: "disclosed" | "estimated" | "unknown";
  currency: string;
  rawBounds?: { min?: number; max?: number; currency?: string };
  structureText?: string;
  sourceProvider?: string;
  confidence?: "High" | "Moderate" | "Low";
  updatedDateDisplay?: string;
  verificationNotice: string;
}

/**
 * Formats a currency range into executive shorthand (e.g. ₹1.8 Cr – ₹2.4 Cr, $220K – $280K).
 */
export function formatCurrencyRange(min?: number, max?: number, currency: string = "INR"): string {
  if (!min && !max) return "";

  if (currency === "INR") {
    const formatLakhOrCr = (num: number) => {
      if (num >= 10000000) return `₹${(num / 10000000).toFixed(1).replace(/\.0$/, "")} Cr`;
      if (num >= 100000) return `₹${(num / 100000).toFixed(0)} Lakhs`;
      return `₹${num.toLocaleString()}`;
    };

    if (min && max) return `${formatLakhOrCr(min)} – ${formatLakhOrCr(max)}`;
    if (min) return `From ${formatLakhOrCr(min)}`;
    if (max) return `Up to ${formatLakhOrCr(max)}`;
  }

  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  const formatK = (num: number) => {
    if (num >= 1000) return `${symbol}${(num / 1000).toFixed(0)}K`;
    return `${symbol}${num.toLocaleString()}`;
  };

  if (min && max) return `${formatK(min)} – ${formatK(max)}`;
  if (min) return `From ${formatK(min)}`;
  if (max) return `Up to ${formatK(max)}`;

  return "";
}

/**
 * Evaluates compensation state and details without altering quality scores or decisions.
 */
export function evaluateCompensation(params: {
  salaryBounds?: { min?: number; max?: number; currency?: string };
  rawText?: string;
  roleTitle?: string;
  companyName?: string;
  benchmarkEstimate?: {
    min: number;
    max: number;
    currency: string;
    source: string;
    confidence: "High" | "Moderate" | "Low";
    updatedDate?: string;
  };
}): CompensationDetails {
  const { salaryBounds, benchmarkEstimate } = params;

  // 1. KNOWN: Salary explicitly disclosed in authoritative job data
  if (salaryBounds && (salaryBounds.min || salaryBounds.max)) {
    const formatted = formatCurrencyRange(salaryBounds.min, salaryBounds.max, salaryBounds.currency || "INR");
    return {
      state: "KNOWN",
      displayBand: `Disclosed: ${formatted}`,
      badgeLabel: `Salary Disclosed · ${formatted}`,
      badgeType: "disclosed",
      currency: salaryBounds.currency || "INR",
      rawBounds: salaryBounds,
      structureText: "Disclosed in job specification",
      verificationNotice: "Compensation explicitly stated in job posting.",
    };
  }

  // 2. ESTIMATED: External benchmark evidence exists from a legitimate/licensed feed or benchmark fixture
  if (benchmarkEstimate) {
    const formatted = formatCurrencyRange(benchmarkEstimate.min, benchmarkEstimate.max, benchmarkEstimate.currency);
    return {
      state: "ESTIMATED",
      displayBand: `Estimated Band: ${formatted}`,
      badgeLabel: `Market Estimate · ${formatted}`,
      badgeType: "estimated",
      currency: benchmarkEstimate.currency,
      rawBounds: { min: benchmarkEstimate.min, max: benchmarkEstimate.max, currency: benchmarkEstimate.currency },
      sourceProvider: benchmarkEstimate.source,
      confidence: benchmarkEstimate.confidence,
      updatedDateDisplay: benchmarkEstimate.updatedDate || "Current Market Benchmark",
      verificationNotice: `Estimated market benchmark based on ${benchmarkEstimate.source} data (${benchmarkEstimate.confidence} confidence).`,
    };
  }

  // 3. UNKNOWN: No reliable compensation evidence exists
  return {
    state: "UNKNOWN",
    displayBand: "Compensation: Not Disclosed",
    badgeLabel: "Compensation: Not Disclosed",
    badgeType: "unknown",
    currency: "INR",
    verificationNotice: "Compensation not disclosed in job posting. Verify during initial screening call.",
  };
}
