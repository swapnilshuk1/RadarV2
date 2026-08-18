/**
 * src/lib/intelligence/semantic/resolvers/OrganizationResolver.ts
 *
 * Directional Organization and Brand Entity Resolver.
 *
 * Invariant Rules:
 * - Differentiates PARENT_ENTITY, SUBSIDIARY, BUSINESS_UNIT, BRAND, PRODUCT from flat string aliases.
 * - Represents directional hierarchies (e.g. AWS -> BUSINESS_UNIT_OF -> Amazon; Google -> SUBSIDIARY_OF -> Alphabet).
 * - Enforces ContextualDisambiguator to eliminate false-positive brand collisions (Target audience, Apple podcast, Amazon seller, Shell scripting).
 * - Leaves downstream Brand Capital score valuation to Brand Capital policy.
 */

import type { CanonicalSemanticEvidence, Directionality, EvidenceRelationship, OrganizationResolutionResult, SemanticRelationship } from "../types";
import { ContextualDisambiguator } from "../normalizers/ContextualDisambiguator";

interface CorporateEntityNode {
  readonly canonicalEntity: string;
  readonly aliases: readonly string[];
  readonly parentEntity?: string;
  readonly organizationType: "PARENT" | "SUBSIDIARY" | "BUSINESS_UNIT" | "BRAND" | "STANDALONE";
  readonly isTier1Pedigree: boolean;
}

const CORPORATE_ONTOLOGY: readonly CorporateEntityNode[] = [
  // Alphabet / Google Ecosystem
  {
    canonicalEntity: "ALPHABET_INC",
    aliases: ["alphabet", "alphabet inc"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "GOOGLE_LLC",
    aliases: ["google", "google llc", "google india"],
    parentEntity: "ALPHABET_INC",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "GOOGLE_DEEPMIND",
    aliases: ["deepmind", "google deepmind"],
    parentEntity: "GOOGLE_LLC",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },

  // Amazon Ecosystem
  {
    canonicalEntity: "AMAZON_INC",
    aliases: ["amazon", "amazon.com", "amazon corporate", "amazon india"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "AMAZON_WEB_SERVICES",
    aliases: ["aws", "amazon web services"],
    parentEntity: "AMAZON_INC",
    organizationType: "BUSINESS_UNIT",
    isTier1Pedigree: true,
  },

  // Meta Ecosystem
  {
    canonicalEntity: "META_PLATFORMS",
    aliases: ["meta", "meta platforms", "facebook"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "INSTAGRAM",
    aliases: ["instagram"],
    parentEntity: "META_PLATFORMS",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "WHATSAPP",
    aliases: ["whatsapp"],
    parentEntity: "META_PLATFORMS",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },

  // Microsoft Ecosystem
  {
    canonicalEntity: "MICROSOFT_CORP",
    aliases: ["microsoft", "microsoft corp", "microsoft india"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "LINKEDIN",
    aliases: ["linkedin", "linkedin corp"],
    parentEntity: "MICROSOFT_CORP",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "GITHUB",
    aliases: ["github"],
    parentEntity: "MICROSOFT_CORP",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },

  // Apple
  {
    canonicalEntity: "APPLE_INC",
    aliases: ["apple", "apple inc"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },

  // Consumer Goods / Retail
  {
    canonicalEntity: "PROCTER_AND_GAMBLE",
    aliases: ["p&g", "procter & gamble", "procter and gamble"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "GILLETTE",
    aliases: ["gillette"],
    parentEntity: "PROCTER_AND_GAMBLE",
    organizationType: "BRAND",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "UNILEVER",
    aliases: ["unilever", "unilever plc"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "HINDUSTAN_UNILEVER",
    aliases: ["hul", "hindustan unilever", "hindustan unilever limited"],
    parentEntity: "UNILEVER",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },

  // Retail & Tech Leaders
  {
    canonicalEntity: "TARGET_CORP",
    aliases: ["target", "target corp", "target india"],
    organizationType: "STANDALONE",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "SHELL_PLC",
    aliases: ["shell", "shell plc", "royal dutch shell"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "SALESFORCE_INC",
    aliases: ["salesforce", "salesforce.com"],
    organizationType: "PARENT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "SFMC_PRODUCT",
    aliases: ["salesforce marketing cloud", "sfmc"],
    parentEntity: "SALESFORCE_INC",
    organizationType: "BUSINESS_UNIT",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "OPENAI",
    aliases: ["openai"],
    organizationType: "STANDALONE",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "FLIPKART",
    aliases: ["flipkart"],
    parentEntity: "WALMART",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "MYNTRA",
    aliases: ["myntra"],
    parentEntity: "FLIPKART",
    organizationType: "SUBSIDIARY",
    isTier1Pedigree: true,
  },
  {
    canonicalEntity: "SWIGGY",
    aliases: ["swiggy", "bundl technologies"],
    organizationType: "STANDALONE",
    isTier1Pedigree: true,
  }
];

export class OrganizationResolver {
  /**
   * Resolves an organization string against context with false-positive filtering.
   */
  public static resolve(
    rawOrg: string,
    targetOrg?: string,
    context: string = ""
  ): OrganizationResolutionResult {
    const raw = rawOrg.trim();
    const fullContext = context ? `${context} ${raw}` : raw;

    // Disambiguate against known false-positive noun collisions
    const disambiguation = ContextualDisambiguator.disambiguateOrganization(raw, fullContext);
    if (disambiguation.isFalsePositive) {
      return {
        sourceOrganization: raw,
        canonicalEntity: "NON_CORPORATE_NOUN",
        organizationType: "STANDALONE",
        semanticRelationship: "AMBIGUOUS",
        direction: "NONE",
        isTier1Pedigree: false,
        confidence: disambiguation.confidence,
        isFalsePositiveContext: true,
        evidence: {
          canonicalConcept: "NON_CORPORATE_NOUN",
          entityType: "ORGANIZATION",
          semanticRelationship: "AMBIGUOUS",
          evidenceRelationship: "EXCLUDED",
          direction: "NONE",
          confidence: disambiguation.confidence,
          sourcePhrase: raw,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "EXCLUDED",
        }
      };
    }

    const rawLower = raw.toLowerCase();

    // Match Corporate Ontology
    for (const node of CORPORATE_ONTOLOGY) {
      const isExact = rawLower === node.canonicalEntity.toLowerCase();
      const isAlias = node.aliases.some(a => rawLower === a || rawLower.includes(a));

      if (isExact || isAlias) {
        // If there's a target organization requirement (e.g. comparing AWS against Amazon)
        let semRel: SemanticRelationship = isExact ? "EXACT" : "ALIAS";
        let evRel: EvidenceRelationship = "DIRECT_EQUIVALENT";
        let direction: Directionality = "BIDIRECTIONAL_EQUIVALENT";

        if (targetOrg) {
          const targetLower = targetOrg.toLowerCase().trim();
          
          if (node.parentEntity && targetLower.includes(node.parentEntity.toLowerCase().replace(/_/g, " "))) {
            // Source is Subsidiary / BU of Target
            semRel = node.organizationType === "BUSINESS_UNIT" ? "BUSINESS_UNIT" : "SUBSIDIARY";
            evRel = "STRONG_SUPPORT"; // Eligible for parent brand capital inheritance
            direction = node.organizationType === "BUSINESS_UNIT" ? "BUSINESS_UNIT_OF" : "SUBSIDIARY_OF";
          } else if (targetLower === "google" && node.canonicalEntity === "ALPHABET_INC") {
            // Source is Parent of Target
            semRel = "PARENT_ENTITY";
            evRel = "STRONG_SUPPORT";
            direction = "PARENT_OF";
          }
        }

        return {
          sourceOrganization: raw,
          canonicalEntity: node.canonicalEntity,
          parentEntity: node.parentEntity,
          organizationType: node.organizationType,
          semanticRelationship: semRel,
          direction,
          isTier1Pedigree: node.isTier1Pedigree,
          confidence: 0.98,
          isFalsePositiveContext: false,
          evidence: {
            canonicalConcept: node.canonicalEntity,
            entityType: "ORGANIZATION",
            semanticRelationship: semRel,
            evidenceRelationship: evRel,
            direction,
            confidence: 0.98,
            sourcePhrase: raw,
            context: fullContext,
            negated: false,
            temporalState: "CURRENT",
            evidenceStrength: "DIRECT_OWNERSHIP",
            metadata: {
              parentEntity: node.parentEntity,
              organizationType: node.organizationType,
              isTier1Pedigree: node.isTier1Pedigree,
            }
          }
        };
      }
    }

    // Default Fallback
    const fallbackCanonical = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return {
      sourceOrganization: raw,
      canonicalEntity: fallbackCanonical,
      organizationType: "STANDALONE",
      semanticRelationship: "LEXICAL_VARIANT",
      direction: "NONE",
      isTier1Pedigree: false,
      confidence: 0.75,
      isFalsePositiveContext: false,
      evidence: {
        canonicalConcept: fallbackCanonical,
        entityType: "ORGANIZATION",
        semanticRelationship: "LEXICAL_VARIANT",
        evidenceRelationship: "CONTEXTUAL_SUPPORT",
        direction: "NONE",
        confidence: 0.75,
        sourcePhrase: raw,
        context: fullContext,
        negated: false,
        temporalState: "CURRENT",
        evidenceStrength: "DIRECT_OWNERSHIP",
      }
    };
  }
}
