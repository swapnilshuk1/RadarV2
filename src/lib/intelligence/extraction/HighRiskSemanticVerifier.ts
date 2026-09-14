/**
 * HighRiskSemanticVerifier.ts
 *
 * Layer 3 Semantic Verifier for the RADAR v2 Asymmetric Hybrid Role Extraction Architecture.
 *
 * STRICT INVARIANTS:
 * 1. Three-valued verification output: ENTAILED | CONTRADICTED | INSUFFICIENT.
 * 2. Fail-Closed Semantics: Any ambiguous, vague, or unsupported high-risk claim
 *    fails closed to INSUFFICIENT.
 * 3. INSUFFICIENT must never become affirmative canonical truth.
 * 4. High-risk semantic families:
 *    - REPORTING_LINE
 *    - FOUNDER_CEO_PROXIMITY
 *    - BOARD_EXPOSURE
 *    - PNL_OWNERSHIP
 *    - COMMERCIAL_ACCOUNTABILITY (validation terminology mapping to REVENUE/PROFITABILITY)
 *    - REVENUE_ACCOUNTABILITY
 *    - PROFITABILITY_ACCOUNTABILITY
 *    - DECISION_AUTHORITY
 *    - PEOPLE_LEADERSHIP
 *    - PEOPLE_SCALE
 * 5. Deterministic rule-grounded verifier with pluggable LLM-verifier contract.
 */

import type { GroundedSemanticProposition } from "./RichSemanticPropositionContract";
import type { SourceUnit } from "./MechanicalSourceSegmenter";
import type { RoleSemanticType } from "./RoleIntelligenceExtractorV1";

export type SemanticVerificationVerdict = "ENTAILED" | "CONTRADICTED" | "INSUFFICIENT";

export const HIGH_RISK_SEMANTIC_FAMILIES = [
  "REPORTING_LINE",
  "FOUNDER_CEO_PROXIMITY",
  "BOARD_EXPOSURE",
  "PNL_OWNERSHIP",
  "REVENUE_ACCOUNTABILITY",
  "PROFITABILITY_ACCOUNTABILITY",
  "DECISION_AUTHORITY",
  "PEOPLE_LEADERSHIP",
  "PEOPLE_SCALE",
] as const;

export type HighRiskSemanticFamily = (typeof HIGH_RISK_SEMANTIC_FAMILIES)[number];

export interface SemanticVerificationResult {
  readonly verdict: SemanticVerificationVerdict;
  readonly highRiskFamily: HighRiskSemanticFamily | null;
  readonly isHighRisk: boolean;
  readonly citedEvidenceText: string;
  readonly reason: string;
  readonly confidence: number;
}

export interface SemanticVerifierContext {
  readonly roleTitle?: string;
  readonly companyName?: string;
}

export interface SemanticVerifier {
  verifyProposition(
    proposition: GroundedSemanticProposition,
    sourceUnits: readonly SourceUnit[],
    context?: SemanticVerifierContext
  ): SemanticVerificationResult;
}

/**
 * Checks whether a given canonical type belongs to the high-risk families.
 */
export function isHighRiskSemanticType(type: RoleSemanticType | string): boolean {
  return HIGH_RISK_SEMANTIC_FAMILIES.includes(type as HighRiskSemanticFamily);
}

/**
 * Identifies high-risk semantic families asserted in a proposition.
 */
export function identifyHighRiskFamilies(
  proposition: GroundedSemanticProposition
): HighRiskSemanticFamily[] {
  const families = new Set<HighRiskSemanticFamily>();

  for (const cType of proposition.canonicalTypes) {
    if (cType === "REPORTING_LINE") families.add("REPORTING_LINE");
    else if (cType === "FOUNDER_CEO_PROXIMITY") families.add("FOUNDER_CEO_PROXIMITY");
    else if (cType === "BOARD_EXPOSURE") families.add("BOARD_EXPOSURE");
    else if (cType === "PNL_OWNERSHIP") families.add("PNL_OWNERSHIP");
    else if (cType === "REVENUE_ACCOUNTABILITY") {
      families.add("REVENUE_ACCOUNTABILITY");
    } else if (cType === "PROFITABILITY_ACCOUNTABILITY") {
      families.add("PROFITABILITY_ACCOUNTABILITY");
    } else if (cType === "DECISION_AUTHORITY") families.add("DECISION_AUTHORITY");
    else if (cType === "PEOPLE_LEADERSHIP") families.add("PEOPLE_LEADERSHIP");
    else if (cType === "PEOPLE_SCALE") families.add("PEOPLE_SCALE");
  }

  // Also inspect free-text proposition for unmapped or misclassified high-risk assertions
  const textLower = proposition.proposition.toLowerCase();
  if (/\bp&l\b|\bprofit and loss\b/i.test(textLower)) families.add("PNL_OWNERSHIP");
  if (/\breports? to\b|\breporting to\b/i.test(textLower)) families.add("REPORTING_LINE");
  if (/\bceo\b|\bfounder\b|\bchief executive\b/i.test(textLower)) families.add("FOUNDER_CEO_PROXIMITY");
  if (/\bboard of directors\b|\bboard exposure\b|\bboard reporting\b/i.test(textLower)) families.add("BOARD_EXPOSURE");
  // Explicit revenue cues only; generic "commercial growth" is excluded to avoid over-generalization
  if (/\brevenue target\b|\bquota\b|\barr\b|\bsales target\b|\bnet new arr\b/i.test(textLower)) {
    families.add("REVENUE_ACCOUNTABILITY");
  }
  if (/\bmanage (a )?team\b|\bteam of [0-9]+\b|\bheadcount\b/i.test(textLower)) families.add("PEOPLE_LEADERSHIP");

  return Array.from(families);
}

// Cues for explicit contradictions / negative boundaries
const CONTRADICTION_PATTERNS: Record<HighRiskSemanticFamily, RegExp[]> = {
  PNL_OWNERSHIP: [
    /\b(no|without|not|non-?)\s+(have\s+)?p&l\b/i,
    /\bdoes not (own|manage|have|carry)\s+(a\s+)?p&l\b/i,
    /\bnot\s+a\s+p&l\b/i,
    /\bp&l\s+is\s+not\s+(owned|held|managed)\b/i,
    /\bvertical\s+p&l\s+does\s+not\s+mean\s+whole\b/i,
    /\bno\s+direct\s+p&l\b/i
  ],
  REPORTING_LINE: [
    /\b(no|not|does not)\s+report(ing)?\s+to\s+(the\s+)?(ceo|founder|board)\b/i,
    /\bnot\s+joining\s+an\s+existing\s+line\b/i,
    /\bno\s+named\s+reporting\s+line\b/i,
    /\bdoes\s+not\s+report\s+to\b/i
  ],
  FOUNDER_CEO_PROXIMITY: [
    /\b(no|not|does not)\s+(have\s+)?(named\s+)?(ceo|founder)\s+proximity\b/i,
    /\bno\s+direct\s+(access|interaction)\s+with\s+(the\s+)?(founder|ceo)\b/i,
    /\bdoes not report to (the )?(founder|ceo)\b/i
  ],
  BOARD_EXPOSURE: [
    /\b(no|not|does not have)\s+board\s+(exposure|reporting|interaction|presentations?)\b/i,
    /\bno\s+board\s+seat\b/i,
    /\bno\s+interaction\s+with\s+(the\s+)?board\b/i
  ],
  REVENUE_ACCOUNTABILITY: [
    /\b(non-revenue|no quota|no revenue targets?|does not carry quota|cost center only|no revenue accountability)\b/i
  ],
  PROFITABILITY_ACCOUNTABILITY: [
    /\b(no profitability mandate|not held to ebitda|not responsible for margin)\b/i
  ],
  DECISION_AUTHORITY: [
    /\b(no\s+final\s+authority|advisory\s+only|no\s+sign-off\s+power|purely\s+recommendatory)\b/i
  ],
  PEOPLE_LEADERSHIP: [
    /\b(individual contributor|ic role|no direct reports|not managing (a\s+)?team|zero reports)\b/i
  ],
  PEOPLE_SCALE: [
    /\b(zero\s+headcount|no\s+direct\s+reports|individual\s+contributor)\b/i
  ]
};

// Cues for strict affirmative entailment
const ENTAILMENT_PATTERNS: Record<HighRiskSemanticFamily, RegExp[]> = {
  PNL_OWNERSHIP: [
    /\b(full|direct|complete|overall|sole|bu|unit|regional|product|divisional)?\s*p&l\s*(ownership|responsibility|accountability|management|leader)\b/i,
    /\b(own|manage|lead|drive|hold|carry|responsible for)\s+(the\s+)?([a-z0-9\-]+\s+)?p&l\b/i,
    /\bprofit\s+and\s+loss\s+(responsibility|ownership|management)\b/i
  ],
  REPORTING_LINE: [
    /\breports?\s+directly\s+to\b/i,
    /\breports?\s+to\s+(the\s+)?/i,
    /\breporting\s+(directly\s+)?to\b/i,
    /\bwill\s+report\s+to\b/i,
    /\bunder\s+the\s+direction\s+of\b/i,
    /\bposition\s+reports\s+to\b/i
  ],
  FOUNDER_CEO_PROXIMITY: [
    /\breports?\s+(directly\s+)?to\s+(the\s+)?(founder|co-founder|ceo|chief executive)\b/i,
    /\breporting\s+(directly\s+)?to\s+(the\s+)?(founder|co-founder|ceo|chief executive)\b/i,
    /\bchief\s+of\s+staff\s+to\s+(the\s+)?(founder|co-founder|ceo)\b/i,
    /\bworking\s+directly\s+with\s+(the\s+)?(founder|ceo)\s+as\s+(key|right-hand|strategic|executive)\b/i
  ],
  BOARD_EXPOSURE: [
    /\b(present|reporting|reports|updates?)\s+(directly\s+)?to\s+(the\s+)?board(\s+of\s+directors)?\b/i,
    /\bboard\s+(meeting\s+attendance|exposure|interaction|presentations?)\b/i,
    /\binteract\s+regularly\s+with\s+the\s+board\b/i
  ],
  REVENUE_ACCOUNTABILITY: [
    /\b(own|drive|deliver|responsible for|target|quota of|hold|carry|carries)\s+([$\u20B9\u00A3\u20AC0-9\.]+[MKBkmb]?\+?\s+)?(in\s+)?(revenue|arr|mrr|top-line)\b/i,
    /\b([$\u20B9\u00A3\u20AC0-9\.]+[MKBkmb]?\+?\s+)?revenue\s+(target|responsibility|quota|generation|growth\s+mandate)\b/i,
    /\bcarrying\s+a\s+quota\b/i
  ],
  PROFITABILITY_ACCOUNTABILITY: [
    /\b(own|responsible for|manage|deliver)\s+(the\s+)?(profitability|ebitda|net margin|operating margin)\b/i,
    /\bbottom-line\s+accountability\b/i
  ],
  DECISION_AUTHORITY: [
    /\b(final\s+sign-off|autonomous\s+decision|sole\s+authority|budget\s+approval\s+authority|executive\s+mandate|decision-making\s+authority|expenditure\s+authority|spending\s+authority)\b/i,
    /\bultimate\s+accountability\s+for\b/i
  ],
  PEOPLE_LEADERSHIP: [
    /\b(manage|managing|lead|leading|build|scale|direct|oversee)\s+(a\s+)?([a-z\-]+\s+)*(team|org|organization|department)\b/i,
    /\b(direct\s+reports|team\s+size|headcount)\b/i,
    /\bmanaging\s+[0-9]+\s+(people|engineers|direct reports|managers)\b/i,
    /\bpeople\s+management\s+(responsibility|experience)\b/i,
    /\blead\s+a\s+(growing\s+)?team\b/i
  ],
  PEOPLE_SCALE: [
    /\bteam\s+of\s+[0-9]+\+?\b/i,
    /\b[0-9]+\+?\s+(direct\s+reports|engineers|staff|members|people|headcount)\b/i,
    /\borganization\s+of\s+[0-9]+\+?\b/i
  ]
};

export class HighRiskSemanticVerifier implements SemanticVerifier {
  verifyProposition(
    proposition: GroundedSemanticProposition,
    sourceUnits: readonly SourceUnit[],
    context?: SemanticVerifierContext
  ): SemanticVerificationResult {
    const highRiskFamilies = identifyHighRiskFamilies(proposition);

    // If no high-risk family is touched, proposition passes the high-risk gate safely
    if (highRiskFamilies.length === 0) {
      return {
        verdict: "ENTAILED",
        highRiskFamily: null,
        isHighRisk: false,
        citedEvidenceText: "",
        reason: "PROPOSITION_NOT_HIGH_RISK",
        confidence: 1.0
      };
    }

    // Resolve evidence text from cited source units
    const citedUnits = sourceUnits.filter(u => proposition.sourceEvidence.includes(u.spanId));
    if (citedUnits.length === 0) {
      // Missing or ungrounded evidence -> FAIL CLOSED to INSUFFICIENT
      return {
        verdict: "INSUFFICIENT",
        highRiskFamily: highRiskFamilies[0],
        isHighRisk: true,
        citedEvidenceText: "",
        reason: "MISSING_OR_EMPTY_CITED_SOURCE_UNITS",
        confidence: 0.0
      };
    }

    const evidenceText = citedUnits.map(u => u.exactText).join(" ");

    // 1. Contradiction Pass: If any asserted high-risk family is contradicted in source text
    for (const family of highRiskFamilies) {
      const contradictionPatterns = CONTRADICTION_PATTERNS[family] ?? [];
      const hasContradiction = contradictionPatterns.some(re => re.test(evidenceText));

      if (hasContradiction) {
        if (proposition.polarity === "AFFIRMED") {
          return {
            verdict: "CONTRADICTED",
            highRiskFamily: family,
            isHighRisk: true,
            citedEvidenceText: evidenceText,
            reason: `Source text explicitly contradicts affirmative ${family} claim`,
            confidence: 0.95
          };
        } else if (proposition.polarity === "NEGATED") {
          // Accurately captured negation boundary
          return {
            verdict: "ENTAILED",
            highRiskFamily: family,
            isHighRisk: true,
            citedEvidenceText: evidenceText,
            reason: `Source text affirms negated boundary for ${family}`,
            confidence: 0.95
          };
        }
      }
    }

    // 2. Affirmative Entailment Pass: All asserted high-risk families must be strictly entailed
    for (const family of highRiskFamilies) {
      const entailmentPatterns = ENTAILMENT_PATTERNS[family] ?? [];
      const hasAffirmativeEntailment = entailmentPatterns.some(re => re.test(evidenceText));

      if (hasAffirmativeEntailment) {
        if (proposition.polarity === "NEGATED") {
          return {
            verdict: "CONTRADICTED",
            highRiskFamily: family,
            isHighRisk: true,
            citedEvidenceText: evidenceText,
            reason: `Source text confirms ${family} but proposition claimed NEGATED`,
            confidence: 0.90
          };
        }
      } else {
        // Any missing high-risk evidence -> fail closed to INSUFFICIENT
        return {
          verdict: "INSUFFICIENT",
          highRiskFamily: family,
          isHighRisk: true,
          citedEvidenceText: evidenceText,
          reason: `Insufficient explicit evidence in cited units to verify ${family}; failing closed`,
          confidence: 0.20
        };
      }
    }

    // All asserted high-risk families passed affirmative entailment
    return {
      verdict: "ENTAILED",
      highRiskFamily: highRiskFamilies[0],
      isHighRisk: true,
      citedEvidenceText: evidenceText,
      reason: `Strict lexical entailment verified for ${highRiskFamilies.join(", ")}`,
      confidence: 0.92
    };
  }
}
