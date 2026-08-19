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

function findNode(name: string): CorporateEntityNode | undefined {
  const clean = name.toLowerCase().trim();
  return CORPORATE_ONTOLOGY.find(n =>
    n.canonicalEntity.toLowerCase() === clean ||
    n.aliases.some(a => a === clean || clean === a)
  );
}

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

    const sourceNode = findNode(raw);
    const targetNode = targetOrg ? findNode(targetOrg) : undefined;

    if (sourceNode) {
      let semRel: SemanticRelationship = "ALIAS";
      let evRel: EvidenceRelationship = "DIRECT_EQUIVALENT";
      let direction: Directionality = "BIDIRECTIONAL_EQUIVALENT";

      if (targetNode) {
        if (sourceNode.canonicalEntity === targetNode.canonicalEntity) {
          semRel = "ALIAS";
          direction = "BIDIRECTIONAL_EQUIVALENT";
        } else if (sourceNode.parentEntity === targetNode.canonicalEntity) {
          // Source is child of target
          if (sourceNode.organizationType === "BUSINESS_UNIT") {
            semRel = "BUSINESS_UNIT";
            direction = "BUSINESS_UNIT_OF";
          } else {
            semRel = "SUBSIDIARY";
            direction = "SUBSIDIARY_OF";
          }
          evRel = "STRONG_SUPPORT";
        } else if (targetNode.parentEntity === sourceNode.canonicalEntity) {
          // Source is parent of target
          semRel = "PARENT_ENTITY";
          direction = "PARENT_OF";
          evRel = "STRONG_SUPPORT";
        }
      }

      return {
        sourceOrganization: raw,
        canonicalEntity: sourceNode.canonicalEntity,
        parentEntity: sourceNode.parentEntity,
        organizationType: sourceNode.organizationType,
        semanticRelationship: semRel,
        direction,
        isTier1Pedigree: sourceNode.isTier1Pedigree,
        confidence: 0.98,
        isFalsePositiveContext: false,
        evidence: {
          canonicalConcept: sourceNode.canonicalEntity,
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
            parentEntity: sourceNode.parentEntity,
            organizationType: sourceNode.organizationType,
            isTier1Pedigree: sourceNode.isTier1Pedigree,
          }
        }
      };
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
