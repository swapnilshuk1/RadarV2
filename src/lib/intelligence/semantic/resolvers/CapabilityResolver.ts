/**
 * src/lib/intelligence/semantic/resolvers/CapabilityResolver.ts
 *
 * Directional Capability Resolver with structured ontology mapping.
 *
 * Invariant Rules:
 * - Differentiates Semantic Relationship (EXACT, ALIAS, STRONG_EQUIVALENT, SUBTYPE, SUPERTYPE, METRIC_OF)
 *   from Evidence Relationship (DIRECT_EQUIVALENT, STRONG_SUPPORT, PARTIAL_SUPPORT, NON_SATISFYING).
 * - "SUBTYPE" does NOT universally satisfy requirements (e.g. SEO != complete Digital Marketing leadership).
 * - "METRIC_OF" provides quantitative outcome proof, not entire functional ownership.
 * - Extracts temporal state and negation context.
 */

import type { CanonicalSemanticEvidence, EvidenceRelationship, SemanticRelationship } from "../types";
import { NegationDetector } from "../normalizers/NegationDetector";
import { TemporalParser } from "../normalizers/TemporalParser";
import { ContextualDisambiguator } from "../normalizers/ContextualDisambiguator";

interface CapabilityDefinition {
  readonly canonicalConcept: string;
  readonly canonicalLabel: string;
  readonly aliases: readonly string[];
  readonly subtypes: readonly string[];
  readonly supertypes: readonly string[];
  readonly metrics: readonly string[];
  readonly strongEquivalents: readonly string[];
  readonly related: readonly string[];
}

const CANONICAL_CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    canonicalConcept: "ZERO_TO_ONE",
    canonicalLabel: "0 to 1 Scaling & Buildout",
    aliases: ["zero to one", "0 to 1", "0-to-1", "zero-to-one", "greenfield buildout"],
    subtypes: ["mvp launch", "early adopter acquisition", "founding team setup"],
    supertypes: ["entrepreneurship", "business launch"],
    metrics: ["time to first revenue", "product market fit score"],
    strongEquivalents: ["zero to one product launch", "early stage venture scaling"],
    related: ["venture capital", "seed stage"]
  },
  {
    canonicalConcept: "GENERATIVE_AI",
    canonicalLabel: "Generative AI",
    aliases: ["genai", "gen ai", "generative ai", "generative artificial intelligence", "foundation models", "llm"],
    subtypes: ["prompt engineering", "rag", "retrieval augmented generation", "llm fine-tuning", "agentic workflows", "llm application deployment"],
    supertypes: ["artificial intelligence", "ai"],
    metrics: ["token efficiency", "hallucination reduction", "eval pass rate"],
    strongEquivalents: ["generative ai deployment", "large language model integration"],
    related: ["data labeling", "vector databases"]
  },
  {
    canonicalConcept: "M_AND_A",
    canonicalLabel: "Mergers & Acquisitions",
    aliases: ["m&a", "m and a", "mergers and acquisitions", "mergers & acquisitions", "m & a"],
    subtypes: ["post-merger integration", "pmi", "carve-out", "due diligence", "deal structuring", "acquisitions integration"],
    supertypes: ["corporate development", "strategic finance", "inorganic growth"],
    metrics: ["deal volume", "integration synergies", "acquired arr"],
    strongEquivalents: ["inorganic growth leadership", "m&a strategy and execution", "m&a strategy"],
    related: ["joint ventures", "strategic partnerships"]
  },
  {
    canonicalConcept: "GTM_STRATEGY",
    canonicalLabel: "Go-to-Market Strategy",
    aliases: ["gtm", "go to market", "go-to-market", "gtm motion", "gtm strategy"],
    subtypes: ["product launch", "field marketing", "channel gtm", "enterprise gtm", "partner gtm", "plg", "product led growth"],
    supertypes: ["commercial strategy", "growth strategy"],
    metrics: ["pipeline velocity", "win rate", "customer acquisition velocity"],
    strongEquivalents: ["go to market execution", "go-to-market execution", "gtm leadership", "market entry strategy"],
    related: ["sales enablement", "lead gen", "lead generation for sales"]
  },
  {
    canonicalConcept: "REVENUE_OPERATIONS",
    canonicalLabel: "Revenue Operations",
    aliases: ["revops", "revenue operations", "rev ops", "revenue ops"],
    subtypes: ["sales operations", "marketing operations", "deal desk", "billing operations", "commission modeling"],
    supertypes: ["commercial leadership", "business operations"],
    metrics: ["pipeline accuracy", "quota attainment", "sales cycle length"],
    strongEquivalents: ["sales and marketing operations", "commercial operations"],
    related: ["salesforce administration", "bi reporting"]
  },
  {
    canonicalConcept: "CUSTOMER_EXPERIENCE",
    canonicalLabel: "Customer Experience",
    aliases: ["cx", "customer experience", "client experience", "user experience strategy"],
    subtypes: ["customer journey mapping", "voice of customer", "voc", "customer service operations", "omnichannel cx"],
    supertypes: ["customer leadership", "brand experience"],
    metrics: ["nps", "csat", "ces", "customer satisfaction score", "net promoter score"],
    strongEquivalents: ["client experience transformation", "customer experience management"],
    related: ["customer success", "support ticketing"]
  },
  {
    canonicalConcept: "DIGITAL_TRANSFORMATION",
    canonicalLabel: "Digital Transformation",
    aliases: ["dx", "digital transformation"],
    subtypes: ["legacy migration", "cloud transformation", "omnichannel digitalization", "process automation", "replatforming"],
    supertypes: ["enterprise strategy", "technology leadership"],
    metrics: ["digital adoption rate", "migration efficiency", "time to market reduction"],
    strongEquivalents: ["enterprise digital modernization", "digital business transformation", "digital modernization", "enterprise modernization"],
    related: ["it service management", "agile transformation"]
  },
  {
    canonicalConcept: "ARTIFICIAL_INTELLIGENCE",
    canonicalLabel: "Artificial Intelligence",
    aliases: ["artificial intelligence", "machine learning", "ml", "ai"],
    subtypes: ["nlp", "computer vision", "predictive modeling", "deep learning", "neural networks"],
    supertypes: ["technology leadership", "data science"],
    metrics: ["model accuracy", "inference latency", "prediction precision"],
    strongEquivalents: ["ai/ml architecture", "applied ai"],
    related: ["data engineering", "big data analytics"]
  },
  {
    canonicalConcept: "MARKETING_TECHNOLOGY",
    canonicalLabel: "Marketing Technology",
    aliases: ["martech", "mar tech", "marketing technology", "marketing tech stack"],
    subtypes: ["cdp", "customer data platform", "marketing automation", "tag management", "attribution modeling"],
    supertypes: ["marketing leadership", "marketing operations"],
    metrics: ["mql to sql conversion", "data enrichment rate"],
    strongEquivalents: ["martech stack governance", "marketing technology architecture"],
    related: ["analytics dashboards", "cookie compliance"]
  },
  {
    canonicalConcept: "ADVERTISING_TECHNOLOGY",
    canonicalLabel: "Advertising Technology",
    aliases: ["adtech", "ad tech", "advertising technology", "programmatic advertising"],
    subtypes: ["dsp", "ssp", "demand side platform", "supply side platform", "programmatic media buying infrastructure", "header bidding"],
    supertypes: ["performance marketing", "media strategy"],
    metrics: ["roas", "cpm", "cpc", "return on ad spend", "fill rate"],
    strongEquivalents: ["programmatic media architecture", "ad tech platform management"],
    related: ["paid search", "social advertising"]
  },
  {
    canonicalConcept: "CRM_STRATEGY",
    canonicalLabel: "Customer Relationship Management",
    aliases: ["crm", "customer relationship management", "crm strategy"],
    subtypes: ["salesforce marketing cloud", "sfmc", "hubspot crm", "braze", "moengage", "clevertap", "retention journeys"],
    supertypes: ["revenue operations", "marketing technology"],
    metrics: ["customer lifetime value", "clv", "ltv", "repeat purchase rate"],
    strongEquivalents: ["crm and lifecycle marketing", "crm architecture"],
    related: ["email marketing", "sms marketing"]
  },
  {
    canonicalConcept: "ENTERPRISE_RESOURCE_PLANNING",
    canonicalLabel: "Enterprise Resource Planning",
    aliases: ["erp", "enterprise resource planning"],
    subtypes: ["sap s/4hana", "sap", "oracle erp", "netsuite", "microsoft dynamics 365", "sap s/4hana migration", "sap migration"],
    supertypes: ["enterprise systems", "it leadership"],
    metrics: ["order-to-cash cycle", "procure-to-pay efficiency"],
    strongEquivalents: ["erp modernization", "erp system governance"],
    related: ["supply chain systems", "warehouse management"]
  },
  {
    canonicalConcept: "SAAS_BUSINESS_MODEL",
    canonicalLabel: "Software as a Service",
    aliases: ["saas", "software as a service", "b2b saas", "enterprise saas"],
    subtypes: ["multi-tenant architecture", "subscription management", "usage-based pricing"],
    supertypes: ["software business", "technology business model"],
    metrics: ["arr", "annual recurring revenue", "mrr", "nrr", "gross churn", "cac payback"],
    strongEquivalents: ["saas business model", "subscription software scaling"],
    related: ["cloud hosting", "api integrations"]
  },
  {
    canonicalConcept: "D2C_COMMERCE",
    canonicalLabel: "Direct to Consumer",
    aliases: ["d2c", "dtc", "direct to consumer", "direct-to-consumer", "direct 2 consumer"],
    subtypes: ["e-commerce brand scaling", "shopify plus", "omnichannel retail"],
    supertypes: ["consumer commerce", "retail commerce"],
    metrics: ["aov", "average order value", "repeat customer rate", "cac"],
    strongEquivalents: ["dtc brand scaling", "d2c brand scaling", "direct-to-consumer commerce"],
    related: ["warehousing", "last-mile delivery"]
  },
  {
    canonicalConcept: "B2B_COMMERCIAL",
    canonicalLabel: "Business to Business",
    aliases: ["b2b", "business to business", "business-to-business", "b-to-b"],
    subtypes: ["enterprise sales", "account based marketing", "abm", "channel sales"],
    supertypes: ["commercial business model"],
    metrics: ["acv", "annual contract value", "deal size", "pipeline coverage"],
    strongEquivalents: ["b2b commercial leadership", "enterprise b2b sales"],
    related: ["rfp response", "procurement negotiations"]
  },
  {
    canonicalConcept: "B2C_COMMERCIAL",
    canonicalLabel: "Business to Consumer",
    aliases: ["b2c", "business to consumer", "business-to-consumer", "consumer marketing"],
    subtypes: ["mass media", "consumer branding", "fmcg marketing", "retail distribution"],
    supertypes: ["commercial business model"],
    metrics: ["market share", "brand recall", "consumer penetration"],
    strongEquivalents: ["b2c commercial strategy", "consumer business leadership"],
    related: ["trade marketing", "shopper marketing"]
  },
  {
    canonicalConcept: "RETENTION_AND_EXPANSION",
    canonicalLabel: "Customer Retention & Expansion",
    aliases: ["retention and expansion", "customer retention", "client retention", "account expansion"],
    subtypes: ["upsell motion", "cross-sell motion", "churn prevention", "renewal management"],
    supertypes: ["customer success", "revenue growth"],
    metrics: ["net revenue retention", "nrr", "grr", "gross retention rate", "net retention", "renewal rate"],
    strongEquivalents: ["customer retention and value realization", "net revenue retention leadership"],
    related: ["customer onboarding", "health scoring"]
  },
  {
    canonicalConcept: "PERFORMANCE_MARKETING",
    canonicalLabel: "Performance Marketing",
    aliases: ["performance marketing", "paid media", "paid acquisition", "growth advertising"],
    subtypes: ["sem", "paid search", "google ads", "meta ads", "programmatic display", "app install campaigns"],
    supertypes: ["marketing leadership", "growth marketing"],
    metrics: ["roas", "cac", "cpa", "cost per acquisition", "return on ad spend", "ad spend efficiency"],
    strongEquivalents: ["paid media acquisition", "managed performance ad spend", "performance media scaling"],
    related: ["creative production", "landing page optimization"]
  },
  {
    canonicalConcept: "GROWTH_MARKETING",
    canonicalLabel: "Growth Marketing",
    aliases: ["growth marketing", "growth leadership", "revenue growth"],
    subtypes: ["conversion rate optimization", "cro", "funnel optimization", "viral loops", "lifecycle marketing"],
    supertypes: ["commercial marketing", "marketing leadership"],
    metrics: ["conversion rate", "activation rate", "arr growth rate"],
    strongEquivalents: ["growth marketing leadership", "growth strategy"],
    related: ["ab testing", "lead generation"]
  },
  {
    canonicalConcept: "MODERNIZATION",
    canonicalLabel: "Technical Architecture Modernization",
    aliases: ["modernization", "architecture modernization", "replatforming", "re-platforming"],
    subtypes: ["microservices migration", "monolith decomposition", "cloud native migration"],
    supertypes: ["technology leadership", "digital transformation"],
    metrics: ["uptime", "deployment frequency", "technical debt reduction"],
    strongEquivalents: ["re-platforming legacy monolith", "core systems modernization"],
    related: ["devops", "ci/cd pipeline"]
  }
];

function isExact(input: string, candidate: string): boolean {
  return input === candidate.toLowerCase();
}

function isWordMatch(input: string, candidate: string): boolean {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i");
  return regex.test(input);
}

export class CapabilityResolver {
  /**
   * Resolves a capability phrase against target requirement and context.
   */
  public static resolve(
    inputPhrase: string,
    targetRequirement?: string,
    context: string = ""
  ): CanonicalSemanticEvidence | null {
    const raw = inputPhrase.trim();
    if (!raw) return null;

    const fullContext = context ? `${context} ${raw}` : raw;

    // Disambiguate Growth vs Growth Mindset
    if (raw.toLowerCase().includes("growth")) {
      const growthCheck = ContextualDisambiguator.disambiguateGrowth(fullContext);
      if (growthCheck.isFalsePositive) {
        return {
          canonicalConcept: growthCheck.canonicalConcept || "BEHAVIORAL_GROWTH_MINDSET",
          entityType: "CAPABILITY",
          semanticRelationship: "RELATED",
          evidenceRelationship: "NON_SATISFYING",
          direction: "NONE",
          confidence: growthCheck.confidence,
          sourcePhrase: raw,
          context: fullContext,
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "EXCLUDED",
        };
      }
    }

    const inputLower = raw.toLowerCase();
    const negation = NegationDetector.analyze(fullContext, raw);
    const temporal = TemporalParser.parse(fullContext);

    // =========================================================================
    // EXACT MATCH PASS (Full String Equality)
    // =========================================================================

    // 1. Exact Canonical Label
    for (const def of CANONICAL_CAPABILITIES) {
      if (isExact(inputLower, def.canonicalLabel)) {
        return {
          canonicalConcept: def.canonicalConcept,
          entityType: "CAPABILITY",
          semanticRelationship: negation.negated ? "NEGATED" : "EXACT",
          evidenceRelationship: negation.negated ? "EXCLUDED" : "DIRECT_EQUIVALENT",
          direction: "BIDIRECTIONAL_EQUIVALENT",
          confidence: 0.99,
          sourcePhrase: raw,
          context: fullContext,
          negated: negation.negated,
          temporalState: temporal.temporalState,
          evidenceStrength: negation.evidenceStrength,
        };
      }
    }

    // 2. Exact Strong Equivalent
    for (const def of CANONICAL_CAPABILITIES) {
      for (const se of def.strongEquivalents) {
        if (isExact(inputLower, se)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "STRONG_EQUIVALENT",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "STRONG_SUPPORT",
            direction: "BIDIRECTIONAL_EQUIVALENT",
            confidence: 0.95,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }
    }

    // 3. Exact Subtype
    for (const def of CANONICAL_CAPABILITIES) {
      for (const sub of def.subtypes) {
        if (isExact(inputLower, sub)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "SUBTYPE",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "STRONG_SUPPORT",
            direction: "SOURCE_TO_TARGET",
            confidence: 0.92,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }
    }

    // 4. Exact Supertype
    for (const def of CANONICAL_CAPABILITIES) {
      for (const sup of def.supertypes) {
        if (isExact(inputLower, sup)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "SUPERTYPE",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "PARTIAL_SUPPORT",
            direction: "SOURCE_TO_TARGET",
            confidence: 0.90,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }
    }

    // 5. Exact Metric
    for (const def of CANONICAL_CAPABILITIES) {
      for (const met of def.metrics) {
        if (isExact(inputLower, met)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "METRIC_OF",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "STRONG_SUPPORT",
            direction: "METRIC_FOR",
            confidence: 0.92,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }
    }

    // 6. Exact Alias
    for (const def of CANONICAL_CAPABILITIES) {
      for (const a of def.aliases) {
        if (isExact(inputLower, a)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "ALIAS",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "DIRECT_EQUIVALENT",
            direction: "BIDIRECTIONAL_EQUIVALENT",
            confidence: 0.98,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }
    }

    // 7. Exact Related
    for (const def of CANONICAL_CAPABILITIES) {
      for (const rel of def.related) {
        if (isExact(inputLower, rel)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "RELATED",
            evidenceRelationship: "NON_SATISFYING",
            direction: "NONE",
            confidence: 0.85,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: "STAKEHOLDER",
          };
        }
      }
    }

    // =========================================================================
    // PARTIAL / WORD-BOUNDARY MATCH PASS (For compound phrases)
    // =========================================================================

    for (const def of CANONICAL_CAPABILITIES) {
      for (const se of def.strongEquivalents) {
        if (isWordMatch(inputLower, se)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "STRONG_EQUIVALENT",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "STRONG_SUPPORT",
            direction: "BIDIRECTIONAL_EQUIVALENT",
            confidence: 0.95,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }

      for (const sub of def.subtypes) {
        if (isWordMatch(inputLower, sub)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "SUBTYPE",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "STRONG_SUPPORT",
            direction: "SOURCE_TO_TARGET",
            confidence: 0.92,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }

      for (const sup of def.supertypes) {
        if (isWordMatch(inputLower, sup)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "SUPERTYPE",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "PARTIAL_SUPPORT",
            direction: "SOURCE_TO_TARGET",
            confidence: 0.90,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }

      for (const met of def.metrics) {
        if (isWordMatch(inputLower, met)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "METRIC_OF",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "STRONG_SUPPORT",
            direction: "METRIC_FOR",
            confidence: 0.92,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }

      for (const a of def.aliases) {
        if (isWordMatch(inputLower, a)) {
          return {
            canonicalConcept: def.canonicalConcept,
            entityType: "CAPABILITY",
            semanticRelationship: negation.negated ? "NEGATED" : "ALIAS",
            evidenceRelationship: negation.negated ? "EXCLUDED" : "DIRECT_EQUIVALENT",
            direction: "BIDIRECTIONAL_EQUIVALENT",
            confidence: 0.98,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: negation.evidenceStrength,
          };
        }
      }
    }

    // Default Fallback
    return {
      canonicalConcept: raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
      entityType: "CAPABILITY",
      semanticRelationship: "LEXICAL_VARIANT",
      evidenceRelationship: "CONTEXTUAL_SUPPORT",
      direction: "NONE",
      confidence: 0.70,
      sourcePhrase: raw,
      context: fullContext,
      negated: negation.negated,
      temporalState: temporal.temporalState,
      evidenceStrength: negation.evidenceStrength,
    };
  }
}
