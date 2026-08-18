/**
 * src/lib/intelligence/semantic/resolvers/SeniorityResolver.ts
 *
 * Hierarchical and Contextual Seniority / Designation Resolver.
 *
 * Invariant Rules:
 * - Does NOT equate bare tokens with executive rank (e.g. Coordinator != Director, Tech Lead != VP).
 * - Resolves complete designations into rich structured attributes (canonicalTitle, seniorityBand, functionalArea, peopleManagementSignal).
 * - Disambiguates MD (Managing Director vs Medical Doctor) and GM (General Manager vs Gross Margin).
 * - Distinguishes Executive Assistant / Sales Executive from C-Suite Executives.
 */

import type { CanonicalSemanticEvidence, EvidenceRelationship, SemanticRelationship, SeniorityBand, SeniorityResolutionResult } from "../types";
import { ContextualDisambiguator } from "../normalizers/ContextualDisambiguator";

interface DesignationPattern {
  readonly regex: RegExp;
  readonly canonicalTitle: string;
  readonly seniorityBand: SeniorityBand;
  readonly isFalsePositiveExecutive: boolean;
  readonly peopleManagementSignal: boolean;
  readonly businessOwnershipSignal: boolean;
  readonly confidence: number;
}

const DESIGNATION_PATTERNS: readonly DesignationPattern[] = [
  // 1. Entry / Support / Non-Executive False-Positive Traps (Checked First)
  {
    regex: /\b(?:marketing|project|program|event|operations|hr|sales)?\s*coordinator\b/i,
    canonicalTitle: "ENTRY_COORDINATOR",
    seniorityBand: "COORDINATOR_ENTRY",
    isFalsePositiveExecutive: true,
    peopleManagementSignal: false,
    businessOwnershipSignal: false,
    confidence: 0.99,
  },
  {
    regex: /\bexecutive\s+assistant\b|\bea\s+to\b/i,
    canonicalTitle: "ADMINISTRATIVE_ASSISTANT",
    seniorityBand: "COORDINATOR_ENTRY",
    isFalsePositiveExecutive: true,
    peopleManagementSignal: false,
    businessOwnershipSignal: false,
    confidence: 0.99,
  },
  {
    regex: /\b(?:sales|account|marketing|field|customer\s+service|support)\s+executive\b/i,
    canonicalTitle: "ENTRY_COMMERCIAL_REP",
    seniorityBand: "INDIVIDUAL_CONTRIBUTOR",
    isFalsePositiveExecutive: true,
    peopleManagementSignal: false,
    businessOwnershipSignal: false,
    confidence: 0.98,
  },
  {
    regex: /\bassistant\s+manager\b/i,
    canonicalTitle: "ASSISTANT_MANAGER",
    seniorityBand: "MANAGER",
    isFalsePositiveExecutive: true,
    peopleManagementSignal: false,
    businessOwnershipSignal: false,
    confidence: 0.97,
  },
  {
    regex: /\btech(?:nical)?\s+lead\b|\blead\s+developer\b|\blead\s+engineer\b|\blead\s+architect\b/i,
    canonicalTitle: "TECHNICAL_LEAD_IC",
    seniorityBand: "LEAD",
    isFalsePositiveExecutive: true, // Not VP/Director
    peopleManagementSignal: false,
    businessOwnershipSignal: false,
    confidence: 0.96,
  },
  {
    regex: /\bteam\s+lead\b|\blead\s+(?:analyst|designer|recruiter|specialist)\b/i,
    canonicalTitle: "TEAM_LEAD_OPERATIONAL",
    seniorityBand: "LEAD",
    isFalsePositiveExecutive: true,
    peopleManagementSignal: true,
    businessOwnershipSignal: false,
    confidence: 0.95,
  },

  // 2. C-Suite & Executive Leadership
  {
    regex: /\b(?:md\s*&\s*ceo|managing\s+director\s*(?:&|\/|\+)\s*ceo|group\s+ceo|enterprise\s+ceo|chief\s+executive\s+officer)\b/i,
    canonicalTitle: "CHIEF_EXECUTIVE_OFFICER",
    seniorityBand: "C_SUITE",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.99,
  },
  {
    regex: /\b(?:ceo|cmo|cro|cgo|cpo|coo|cfo|cto|cio|ciso)\b/i,
    canonicalTitle: "C_SUITE_OFFICER",
    seniorityBand: "C_SUITE",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.98,
  },
  {
    regex: /\bmanaging\s+director\b/i,
    canonicalTitle: "MANAGING_DIRECTOR",
    seniorityBand: "C_SUITE",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.98,
  },
  {
    regex: /\bgeneral\s+manager\b/i,
    canonicalTitle: "GENERAL_MANAGER",
    seniorityBand: "C_SUITE",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.96,
  },

  // 3. Vice President Tiers
  {
    regex: /\b(?:evp|executive\s+vice\s+president)\b/i,
    canonicalTitle: "EXECUTIVE_VICE_PRESIDENT",
    seniorityBand: "VP",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.99,
  },
  {
    regex: /\b(?:svp|senior\s+vice\s+president)\b/i,
    canonicalTitle: "SENIOR_VICE_PRESIDENT",
    seniorityBand: "VP",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.99,
  },
  {
    regex: /\b(?:avp|assistant\s+vice\s+president|associate\s+vice\s+president)\b/i,
    canonicalTitle: "ASSISTANT_VICE_PRESIDENT",
    seniorityBand: "VP",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: false,
    confidence: 0.97,
  },
  {
    regex: /\b(?:vp|vice\s+president)\b/i,
    canonicalTitle: "VICE_PRESIDENT",
    seniorityBand: "VP",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.98,
  },

  // 4. Functional & Business Unit Heads
  {
    regex: /\b(?:country\s+head|country\s+manager)\b/i,
    canonicalTitle: "COUNTRY_HEAD",
    seniorityBand: "HEAD",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.97,
  },
  {
    regex: /\b(?:business\s+head|bu\s+head)\b/i,
    canonicalTitle: "BUSINESS_UNIT_HEAD",
    seniorityBand: "HEAD",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: true,
    confidence: 0.97,
  },
  {
    regex: /\b(?:head\s+of\s+[a-z\s]+|functional\s+head)\b/i,
    canonicalTitle: "FUNCTIONAL_HEAD",
    seniorityBand: "HEAD",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: false,
    confidence: 0.96,
  },

  // 5. Director Tiers
  {
    regex: /\bsenior\s+director\b|\bsr\.?\s+director\b/i,
    canonicalTitle: "SENIOR_DIRECTOR",
    seniorityBand: "DIRECTOR",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: false,
    confidence: 0.98,
  },
  {
    regex: /\bassociate\s+director\b|\bad\b/i,
    canonicalTitle: "ASSOCIATE_DIRECTOR",
    seniorityBand: "DIRECTOR",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: false,
    confidence: 0.96,
  },
  {
    regex: /\baccount\s+director\b/i,
    canonicalTitle: "AGENCY_ACCOUNT_DIRECTOR",
    seniorityBand: "DIRECTOR",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: false,
    businessOwnershipSignal: false,
    confidence: 0.92,
  },
  {
    regex: /\bdirector\b/i,
    canonicalTitle: "DIRECTOR",
    seniorityBand: "DIRECTOR",
    isFalsePositiveExecutive: false,
    peopleManagementSignal: true,
    businessOwnershipSignal: false,
    confidence: 0.97,
  },
];

export class SeniorityResolver {
  /**
   * Resolves a raw job title or designation phrase into structured seniority attributes.
   */
  public static resolve(rawTitle: string, context: string = ""): SeniorityResolutionResult {
    const raw = rawTitle.trim();
    const fullContext = context ? `${context} ${raw}` : raw;

    // Disambiguation for MD
    if (/\bmd\b/i.test(raw)) {
      const mdCheck = ContextualDisambiguator.disambiguateMD(fullContext);
      if (mdCheck.isFalsePositive) {
        return {
          canonicalTitle: "CLINICAL_PHYSICIAN",
          seniorityBand: "INDIVIDUAL_CONTRIBUTOR",
          peopleManagementSignal: false,
          businessOwnershipSignal: false,
          ambiguityState: "RESOLVED",
          confidence: mdCheck.confidence,
          evidence: {
            canonicalConcept: "CLINICAL_PHYSICIAN",
            entityType: "SENIORITY_TITLE",
            semanticRelationship: "AMBIGUOUS",
            evidenceRelationship: "EXCLUDED",
            direction: "NONE",
            confidence: mdCheck.confidence,
            sourcePhrase: raw,
            context: fullContext,
            negated: false,
            temporalState: "CURRENT",
            evidenceStrength: "EXCLUDED",
          }
        };
      }
    }

    // Disambiguation for GM
    if (/\bgm\b/i.test(raw)) {
      const gmCheck = ContextualDisambiguator.disambiguateGM(fullContext);
      if (gmCheck.isFalsePositive) {
        return {
          canonicalTitle: "FINANCIAL_GROSS_MARGIN",
          seniorityBand: "UNKNOWN",
          peopleManagementSignal: false,
          businessOwnershipSignal: false,
          ambiguityState: "RESOLVED",
          confidence: gmCheck.confidence,
          evidence: {
            canonicalConcept: "GROSS_MARGIN",
            entityType: "SENIORITY_TITLE",
            semanticRelationship: "AMBIGUOUS",
            evidenceRelationship: "EXCLUDED",
            direction: "NONE",
            confidence: gmCheck.confidence,
            sourcePhrase: raw,
            context: fullContext,
            negated: false,
            temporalState: "CURRENT",
            evidenceStrength: "EXCLUDED",
          }
        };
      }
    }

    // Extract functional area
    let functionalArea: string | undefined;
    if (/\b(?:marketing|brand|performance|growth)\b/i.test(raw)) functionalArea = "MARKETING";
    else if (/\b(?:sales|commercial|revenue|gtm|business\s+development)\b/i.test(raw)) functionalArea = "COMMERCIAL";
    else if (/\b(?:product|design|ux)\b/i.test(raw)) functionalArea = "PRODUCT";
    else if (/\b(?:tech|engineering|software|architect|it)\b/i.test(raw)) functionalArea = "ENGINEERING";
    else if (/\b(?:finance|accounting|treasury)\b/i.test(raw)) functionalArea = "FINANCE";
    else if (/\b(?:hr|talent|people)\b/i.test(raw)) functionalArea = "PEOPLE";

    // Extract geographic scope
    let geographicScope: string | undefined;
    if (/\b(?:india|apac|emea|latam|us|global|north\s+america)\b/i.test(raw)) {
      const geoMatch = raw.match(/\b(india|apac|emea|latam|us|global|north\s+america)\b/i);
      if (geoMatch) geographicScope = geoMatch[1].toUpperCase();
    }

    // Match against patterns
    for (const pattern of DESIGNATION_PATTERNS) {
      if (pattern.regex.test(raw)) {
        let semRel: SemanticRelationship = "EXACT";
        let evRel: EvidenceRelationship = "DIRECT_EQUIVALENT";

        if (pattern.isFalsePositiveExecutive) {
          semRel = "RELATED";
          evRel = "NON_SATISFYING";
        } else if (pattern.canonicalTitle === "CHIEF_EXECUTIVE_OFFICER" && /\bmd\s*&\s*ceo\b/i.test(raw)) {
          semRel = "STRONG_EQUIVALENT";
          evRel = "DIRECT_EQUIVALENT";
        }

        const evidence: CanonicalSemanticEvidence = {
          canonicalConcept: pattern.canonicalTitle,
          entityType: "SENIORITY_TITLE",
          semanticRelationship: semRel,
          evidenceRelationship: evRel,
          direction: "BIDIRECTIONAL_EQUIVALENT",
          confidence: pattern.confidence,
          sourcePhrase: raw,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: pattern.isFalsePositiveExecutive ? "EXCLUDED" : "DIRECT_OWNERSHIP",
          metadata: {
            seniorityBand: pattern.seniorityBand,
            functionalArea,
            geographicScope,
            isFalsePositiveExecutive: pattern.isFalsePositiveExecutive
          }
        };

        return {
          canonicalTitle: pattern.canonicalTitle,
          seniorityBand: pattern.seniorityBand,
          functionalArea,
          peopleManagementSignal: pattern.peopleManagementSignal,
          geographicScope,
          businessOwnershipSignal: pattern.businessOwnershipSignal,
          ambiguityState: "RESOLVED",
          confidence: pattern.confidence,
          evidence,
        };
      }
    }

    // Default Fallback
    const fallbackTitle = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return {
      canonicalTitle: fallbackTitle,
      seniorityBand: "UNKNOWN",
      peopleManagementSignal: false,
      businessOwnershipSignal: false,
      ambiguityState: "UNRESOLVED",
      confidence: 0.60,
      evidence: {
        canonicalConcept: fallbackTitle,
        entityType: "SENIORITY_TITLE",
        semanticRelationship: "LEXICAL_VARIANT",
        evidenceRelationship: "CONTEXTUAL_SUPPORT",
        direction: "NONE",
        confidence: 0.60,
        sourcePhrase: raw,
        context: fullContext,
        negated: false,
        temporalState: "CURRENT",
        evidenceStrength: "EXCLUDED",
      }
    };
  }
}
