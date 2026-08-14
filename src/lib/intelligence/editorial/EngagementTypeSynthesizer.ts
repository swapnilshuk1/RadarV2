/**
 * EngagementTypeSynthesizer.ts
 *
 * P2-D: Opportunity/Engagement Quality
 *
 * Distinguishes engagement types without universal PASS rules:
 * - permanent executive
 * - fractional executive
 * - interim executive
 * - advisory
 * - consulting
 * - contract execution
 * - gig / hourly work
 *
 * Question: "Is this engagement strategically relevant to this executive?"
 *
 * Does NOT create universal rule: contract → PASS
 * Does NOT create universal rule: fractional → PASS
 *
 * Instead builds reusable concept that interprets engagement quality
 * based on evidence + candidate profile + strategic context.
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

export type EngagementType =
  | "permanent_executive"
  | "fractional_executive"
  | "interim_executive"
  | "advisory"
  | "consulting"
  | "contract_execution"
  | "gig_hourly"
  | "unclear";

export interface EngagementQuality {
  /** Detected engagement type */
  engagementType: EngagementType;

  /** Confidence in detection */
  detectionConfidence: number;

  /** Evidence for engagement type */
  evidence: string[];

  /** Duration expectation if specified */
  duration?: string;

  /** Time commitment if specified */
  timeCommitment?: string;

  /** Compensation structure if mentioned */
  compensationStructure?: string;

  /** Interpretive statement */
  statement: string;

  /** Strategic relevance assessment */
  strategicRelevance: "high" | "moderate" | "low" | "unclear";

  /** Why this engagement type matters for this candidate */
  relevanceRationale: string;

  /** Confidence in interpretation */
  confidence: number;
}

/**
 * Extract engagement type from job text
 */
function extractEngagementType(text: string): {
  type: EngagementType;
  confidence: number;
  evidence: string[];
  duration?: string;
  timeCommitment?: string;
  compensation?: string;
} {
  const lower = text.toLowerCase();
  const evidence: string[] = [];

  // Check for explicit engagement keywords

  // Permanent executive
  if (/\b(full.time|permanent|fte|direct.hire)\b/.test(lower)) {
    evidence.push("Full-time/permanent language detected");
    return { type: "permanent_executive", confidence: 0.9, evidence };
  }

  // Fractional executive
  if (/\b(fractional|part.time executive|\.2\d*|20%|25%|30%|40%|\.4\d*)\b/.test(lower)) {
    evidence.push("Fractional/part-time executive language detected");
    const timeMatch = lower.match(/(\d+)%|(\d+)\s*days?/i);
    return {
      type: "fractional_executive",
      confidence: 0.85,
      evidence,
      timeCommitment: timeMatch ? timeMatch[0] : undefined
    };
  }

  // Interim executive
  if (/\b(interim|temporary.c.?(suite|xo|ceo|cmo|cfo)|\.interim\.|stop.gap)\b/.test(lower)) {
    evidence.push("Interim/temporary executive language detected");
    const durationMatch = lower.match(/(\d+)\s*(month|week)/i);
    return {
      type: "interim_executive",
      confidence: 0.88,
      evidence,
      duration: durationMatch ? durationMatch[0] : undefined
    };
  }

  // Advisory
  if (/\b(advisory.board|board.advisor|advisory.role|strategic.advisor)\b/.test(lower)) {
    evidence.push("Advisory role language detected");
    return { type: "advisory", confidence: 0.8, evidence };
  }

  // Gig/hourly - CHECK BEFORE consulting/contract to avoid misclassification
  // Hourly rate patterns: $150/hr, $200/hour, $150 per hour, $200/hr
  if (/\$\d+\s*[\/\-]?\s*(hr|hour)|\d+\s*\$\s*\d+\s*(per\s*hour|\/hr|hr)|\$\d+\s*per\s*hour/i.test(lower)) {
    evidence.push("Hourly rate language detected");
    const rateMatch = lower.match(/\$?\d+[\s/]?(hr|hour|\/hr|\/hour|per hour)/i);
    return {
      type: "gig_hourly",
      confidence: 0.85,
      evidence,
      compensation: rateMatch ? rateMatch[0] : undefined
    };
  }

  // Contract execution - prioritize explicit contract + duration patterns
  // Check BEFORE consulting because "12 month contract" should match contract, not consulting
  const contractPatterns = [
    /\b(\d+)\s*(month|week|year|yr)s?\s*contract\b/i,      // 12 month contract, 6-month contract
    /\bcontract\s*(?:for\s*)?(\d+)\s*(month|week|year|yr)s?\b/i, // contract 12 months, contract for 6 months
    /\bcontract\b.*\b(\d+)\s*(month|week|year|yr)s?\b/i,  // Contract ... 12 months (flexible order)
    /\bindependent.?contractor\b/i,                           // independent contractor
    /\bcorp[.\s]?to[.\s]?corp\b/i,                           // corp to corp
    /\b1099\b/i,                                             // 1099
    /\bcontract\s*(?:role|position|work|engagement)\b/i      // Contract role/position/work/engagement
  ];

  for (const pattern of contractPatterns) {
    if (pattern.test(lower)) {
      evidence.push("Contract/contractor language detected");
      const durationMatch = lower.match(/(\d+)\s*(month|week|year|yr)/i);
      return {
        type: "contract_execution",
        confidence: 0.8,
        evidence,
        duration: durationMatch ? durationMatch[0] : undefined
      };
    }
  }

  // Consulting - check AFTER contract to avoid catching "X month contract" patterns
  // Also avoid matching "Consultant" when it's combined with contract patterns
  if (/\b(consulting\s+(role|position|engagement)|pure.?consulting|consultant$)\b/i.test(lower) ||
      (/\bconsulting\b/.test(lower) && !/\b(contract|contractor|contractual)\b/.test(lower))) {
    evidence.push("Consulting/engagement-based language detected");
    return { type: "consulting", confidence: 0.75, evidence };
  }

  // Freelance (separate from contract - implies more flexibility/shorter)
  if (/\b(freelance|project.to.project)\b/.test(lower)) {
    evidence.push("Freelance/project-based language detected");
    return {
      type: "gig_hourly",
      confidence: 0.7,
      evidence
    };
  }

  // Default: unclear
  return { type: "unclear", confidence: 0.5, evidence: ["No explicit engagement type language"] };
}

/**
 * Synthesize engagement quality interpretation
 */
export function synthesizeEngagementQuality(
  record: RecommendationRecord,
  source: OpportunitySource
): EngagementQuality {
  const rawText = (source as any).rawText || (source as any).normalizedText || (source as any).description || "";
  const role = source.role;

  // Extract engagement type from text
  const extraction = extractEngagementType(rawText + " " + role);

  // Build strategic relevance based on type + candidate context
  let strategicRelevance: EngagementQuality["strategicRelevance"];
  let statement: string;
  let relevanceRationale: string;
  let confidence: number;

  switch (extraction.type) {
    case "permanent_executive":
      strategicRelevance = "high";
      confidence = extraction.confidence;
      statement = "Permanent executive role with standard full-time commitment.";
      relevanceRationale = "Permanent roles typically offer greatest strategic ownership, P&L authority, and career trajectory impact.";
      break;

    case "fractional_executive":
      // Strategic relevance depends on candidate's portfolio approach
      strategicRelevance = "moderate";
      confidence = extraction.confidence * 0.9;
      statement = extraction.timeCommitment
        ? `Fractional executive engagement (${extraction.timeCommitment} commitment).`
        : "Fractional executive engagement with reduced time commitment.";
      relevanceRationale = "Fractional roles can extend executive impact across multiple organizations but may limit single-mandate depth.";
      break;

    case "interim_executive":
      strategicRelevance = "moderate";
      confidence = extraction.confidence;
      statement = extraction.duration
        ? `Interim executive engagement (${extraction.duration}).`
        : "Interim executive engagement with temporary scope.";
      relevanceRationale = "Interim roles offer transformation credibility and board exposure. Can be stepping stone to permanent or advisory career phase.";
      break;

    case "advisory":
      strategicRelevance = "moderate";
      confidence = extraction.confidence;
      statement = "Advisory board or strategic advisory engagement.";
      relevanceRationale = "Advisory roles build governance credibility and strategic influence. Best as complement to, not replacement for, operating experience.";
      break;

    case "consulting":
      strategicRelevance = extraction.confidence > 0.8 ? "high" : "moderate";
      confidence = extraction.confidence;
      statement = "Consulting or project-based engagement.";
      relevanceRationale = "Consulting preserves executive expertise leverage but may shift from P&L ownership to advisory delivery.";
      break;

    case "contract_execution":
      // Assess strategic relevance based on scope
      strategicRelevance = "moderate";
      confidence = extraction.confidence;
      statement = extraction.duration
        ? `Contract execution role (${extraction.duration}).`
        : "Contract execution engagement.";
      relevanceRationale = "Contract roles can deliver immediate impact. Strategic value depends on scope authority and extension potential.";
      break;

    case "gig_hourly":
      strategicRelevance = "low";
      confidence = extraction.confidence;
      statement = extraction.compensation
        ? `Hourly/gig engagement (${extraction.compensation}).`
        : "Hourly or gig-based engagement.";
      relevanceRationale = "Hourly engagements typically represent tactical execution. Generally misaligned with executive trajectory unless building specific capability.";
      break;

    case "unclear":
    default:
      strategicRelevance = "unclear";
      confidence = 0.5;
      statement = "Engagement type not explicitly specified.";
      relevanceRationale = "Engagement terms unclear. Direct validation required to assess strategic fit.";
  }

  // Adjust relevance based on role seniority
  if (role.toLowerCase().includes("chief") || role.toLowerCase().includes("vp") || role.toLowerCase().includes("director")) {
    // Senior titles should have clearer engagement type
    if (extraction.type === "gig_hourly") {
      strategicRelevance = "low"; // Senior title with hourly pay is concerning
      relevanceRationale += " Senior title with hourly structure is unusual and may indicate misalignment.";
    }
  }

  // P2-D.2: Strategic relevance is modulated by career value
  // This demonstrates that engagement type and strategic relevance are separate concepts
  const careerValue = record.trace?.factors?.careerValue ?? 50;
  if (careerValue < 50 && strategicRelevance !== "unclear") {
    // Low career value degrades strategic relevance
    if (strategicRelevance === "high") {
      strategicRelevance = "moderate";
    } else if (strategicRelevance === "moderate") {
      strategicRelevance = "low";
    }
    relevanceRationale += " Reduced career value limits strategic impact.";
  } else if (careerValue > 70 && strategicRelevance !== "unclear") {
    // High career value elevates strategic relevance
    if (strategicRelevance === "low") {
      strategicRelevance = "moderate";
    } else if (strategicRelevance === "moderate") {
      strategicRelevance = "high";
    }
    relevanceRationale += " High career value elevates strategic importance.";
  }

  return {
    engagementType: extraction.type,
    detectionConfidence: extraction.confidence,
    evidence: extraction.evidence,
    duration: extraction.duration,
    timeCommitment: extraction.timeCommitment,
    compensationStructure: extraction.compensation,
    statement,
    strategicRelevance,
    relevanceRationale,
    confidence: Math.round(confidence * 100) / 100
  };
}

/**
 * Format engagement quality for presentation
 */
export function formatEngagementQuality(quality: EngagementQuality): string {
  return `${quality.statement} ${quality.relevanceRationale}`;
}

/**
 * Get engagement type indicator for UI
 */
export function getEngagementIndicator(quality: EngagementQuality): {
  label: string;
  color: "green" | "amber" | "red" | "neutral";
} {
  switch (quality.engagementType) {
    case "permanent_executive":
      return { label: "Permanent Executive", color: "green" };
    case "fractional_executive":
      return { label: "Fractional", color: "amber" };
    case "interim_executive":
      return { label: "Interim", color: "amber" };
    case "advisory":
      return { label: "Advisory", color: "amber" };
    case "consulting":
      return { label: "Consulting", color: "amber" };
    case "contract_execution":
      return { label: "Contract", color: "amber" };
    case "gig_hourly":
      return { label: "Hourly/Gig", color: "red" };
    default:
      return { label: "Unclear", color: "neutral" };
  }
}
