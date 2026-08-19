/**
 * src/lib/intelligence/semantic/resolvers/CompositionalExtractor.ts
 *
 * Compositional evidence extraction across compound executive statements.
 *
 * Example:
 * "Led the India business across sales, marketing and operations, owning a ₹500 Cr P&L, a 200-person organization and the full GTM strategy."
 * Decomposes into:
 * - FINANCIAL_SCOPE (₹500 Cr P&L)
 * - GEOGRAPHIC_SCOPE (National / India)
 * - PEOPLE_LEADERSHIP / ORGANIZATIONAL_SCALE (200-person organization)
 * - SENIORITY_LEADERSHIP (Led the India business)
 * - FUNCTIONAL_CAPABILITY: SALES (Sales leadership)
 * - FUNCTIONAL_CAPABILITY: MARKETING (Marketing leadership)
 * - FUNCTIONAL_CAPABILITY: OPERATIONS (Operations leadership)
 * - CAPABILITY: GTM_STRATEGY (Full GTM strategy)
 */

import type { CanonicalSemanticEvidence, CompositionalEvidenceResult } from "../types";
import { CapabilityResolver } from "./CapabilityResolver";
import { CommercialScopeResolver } from "./CommercialScopeResolver";
import { SeniorityResolver } from "./SeniorityResolver";
import { GeographyResolver } from "./GeographyResolver";
import { OrganizationResolver } from "./OrganizationResolver";
import { NegationDetector } from "../normalizers/NegationDetector";
import { TemporalParser } from "../normalizers/TemporalParser";

export class CompositionalExtractor {
  /**
   * Extracts multi-dimensional structured evidence from a compound sentence or paragraph.
   */
  public static extract(rawText: string): CompositionalEvidenceResult {
    const raw = rawText.trim();
    const evidenceList: CanonicalSemanticEvidence[] = [];

    const negation = NegationDetector.analyze(raw);
    const temporal = TemporalParser.parse(raw);

    // 1. Extract Financial & Commercial Scope
    let dominantScope;
    if (/\b(?:p&l|pl|profit|loss|turnover|ebitda|margin|budget|crores?|cr|\$\d+m|\$\d+b|revenue)\b/i.test(raw)) {
      dominantScope = CommercialScopeResolver.resolve(raw);
      evidenceList.push(dominantScope.evidence);

      // Additional compositional sub-facets
      if (/\brevenue\b/i.test(raw) && dominantScope.canonicalConcept !== "REVENUE_ACCOUNTABILITY") {
        evidenceList.push({
          canonicalConcept: "REVENUE_ACCOUNTABILITY",
          entityType: "FINANCIAL_SCOPE",
          semanticRelationship: "STRONG_EQUIVALENT",
          evidenceRelationship: "STRONG_SUPPORT",
          direction: "BIDIRECTIONAL_EQUIVALENT",
          confidence: 0.94,
          sourcePhrase: "revenue accountability",
          context: raw,
          negated: negation.negated,
          temporalState: temporal.temporalState,
          evidenceStrength: negation.evidenceStrength,
        });
      }

      if (/\bmargin\b/i.test(raw) && dominantScope.canonicalConcept !== "MARGIN_ACCOUNTABILITY") {
        evidenceList.push({
          canonicalConcept: "MARGIN_ACCOUNTABILITY",
          entityType: "FINANCIAL_SCOPE",
          semanticRelationship: "SUBTYPE",
          evidenceRelationship: "STRONG_SUPPORT",
          direction: "SOURCE_TO_TARGET",
          confidence: 0.92,
          sourcePhrase: "margin accountability",
          context: raw,
          negated: negation.negated,
          temporalState: temporal.temporalState,
          evidenceStrength: negation.evidenceStrength,
        });
      }
    }

    // 2. Extract People & Organizational Leadership / Scale
    if (/\b(?:team\s+accountability|managed\s+a\s+team|direct\s+reports|led\s+a\s+team|organization\s+of\s+\d+|\d+-person\s+(?:team|organization|dept|group)?|people\s+leadership)\b/i.test(raw)) {
      const match = raw.match(/(\d+)-person\s+(?:team|organization|dept|group)?/i);
      const sourcePhrase = match ? match[0] : "team accountability";
      evidenceList.push({
        canonicalConcept: match ? `ORGANIZATIONAL_SCALE_${match[1]}_PEOPLE` : "PEOPLE_LEADERSHIP",
        entityType: "PEOPLE_SCOPE",
        semanticRelationship: "STRONG_EQUIVALENT",
        evidenceRelationship: "DIRECT_EQUIVALENT",
        direction: "BIDIRECTIONAL_EQUIVALENT",
        confidence: 0.96,
        sourcePhrase,
        context: raw,
        negated: negation.negated,
        temporalState: temporal.temporalState,
        evidenceStrength: negation.evidenceStrength,
      });
    }

    // 3. Extract Seniority / Designation / Leadership signals
    let dominantSeniority;
    if (/\b(?:ceo|cmo|cro|cgo|vp|president|director|head|manager|lead|led|coordinator|gm|md)\b/i.test(raw)) {
      dominantSeniority = SeniorityResolver.resolve(raw);
      if (!dominantSeniority.evidence.semanticRelationship.includes("AMBIGUOUS")) {
        evidenceList.push(dominantSeniority.evidence);
      }
    }

    // 4. Extract Geography signals
    let dominantGeography;
    if (/\b(?:bengaluru|bangalore|mumbai|delhi|ncr|gurugram|gurgaon|noida|pune|hyderabad|chennai|kolkata|india|us|bay\s+area)\b/i.test(raw)) {
      dominantGeography = GeographyResolver.resolve(raw);
      evidenceList.push(dominantGeography.evidence);
    }

    // 5. Extract Corporate / Brand signals
    let dominantOrganization;
    if (/\b(?:google|alphabet|amazon|aws|meta|instagram|microsoft|linkedin|p&g|unilever|hul|target|flipkart|swiggy)\b/i.test(raw)) {
      dominantOrganization = OrganizationResolver.resolve(raw);
      if (!dominantOrganization.isFalsePositiveContext) {
        evidenceList.push(dominantOrganization.evidence);
      }
    }

    // 6. Extract Functional & Strategic Capabilities
    const domainKws: Record<string, string> = {
      sales: "SALES_LEADERSHIP",
      marketing: "MARKETING_STRATEGY",
      operations: "OPERATIONAL_EXCELLENCE",
      gtm: "GTM_STRATEGY",
      "go-to-market": "GTM_STRATEGY",
      "m&a": "M_AND_A",
      revops: "REVENUE_OPERATIONS",
      saas: "SAAS_BUSINESS_MODEL",
      d2c: "D2C_GROWTH",
      b2b: "B2B_COMMERCIAL",
    };

    for (const [kw, concept] of Object.entries(domainKws)) {
      if (new RegExp(`\\b${kw}\\b`, "i").test(raw)) {
        evidenceList.push({
          canonicalConcept: concept,
          entityType: "CAPABILITY",
          semanticRelationship: "STRONG_EQUIVALENT",
          evidenceRelationship: "DIRECT_EQUIVALENT",
          direction: "BIDIRECTIONAL_EQUIVALENT",
          confidence: 0.95,
          sourcePhrase: kw,
          context: raw,
          negated: negation.negated,
          temporalState: temporal.temporalState,
          evidenceStrength: negation.evidenceStrength,
        });
      }
    }

    // De-duplicate exact (entityType + canonicalConcept)
    const seen = new Set<string>();
    const deduplicatedList: CanonicalSemanticEvidence[] = [];
    for (const item of evidenceList) {
      const key = `${item.entityType}:${item.canonicalConcept}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicatedList.push(item);
      }
    }

    return {
      rawText: raw,
      evidenceList: deduplicatedList,
      dominantScope,
      dominantSeniority,
      dominantGeography,
      dominantOrganization,
    };
  }
}
