/**
 * src/lib/intelligence/semantic/resolvers/CompositionalExtractor.ts
 *
 * Compositional evidence extraction across compound executive statements.
 *
 * Example:
 * "Owned a ₹500 Cr consumer business across India with full revenue, margin and team accountability."
 * Decomposes into:
 * - COMMERCIAL_SCOPE (₹500 Cr turnover / P&L)
 * - REVENUE_ACCOUNTABILITY (Full revenue ownership)
 * - MARGIN_ACCOUNTABILITY (Commercial margin governance)
 * - ORGANIZATIONAL_SCOPE (Consumer business unit)
 * - GEOGRAPHIC_SCOPE (National / India)
 * - PEOPLE_LEADERSHIP (Team accountability)
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

    // 2. Extract People & Organizational Leadership
    if (/\b(?:team\s+accountability|managed\s+a\s+team|direct\s+reports|led\s+a\s+team|organization\s+of\s+\d+|people\s+leadership)\b/i.test(raw)) {
      evidenceList.push({
        canonicalConcept: "PEOPLE_LEADERSHIP",
        entityType: "PEOPLE_SCOPE",
        semanticRelationship: "STRONG_EQUIVALENT",
        evidenceRelationship: "DIRECT_EQUIVALENT",
        direction: "BIDIRECTIONAL_EQUIVALENT",
        confidence: 0.96,
        sourcePhrase: "team accountability",
        context: raw,
        negated: negation.negated,
        temporalState: temporal.temporalState,
        evidenceStrength: negation.evidenceStrength,
      });
    }

    // 3. Extract Seniority / Designation signals
    let dominantSeniority;
    if (/\b(?:ceo|cmo|cro|cgo|vp|president|director|head|manager|lead|coordinator|gm|md)\b/i.test(raw)) {
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

    // 6. Extract Capability signals (GTM, M&A, RevOps, CX, AI, SaaS, D2C, B2B)
    const capMatches = ["m&a", "gtm", "revops", "cx", "dx", "ai", "genai", "martech", "adtech", "crm", "erp", "saas", "d2c", "b2b", "b2c", "retention"];
    for (const kw of capMatches) {
      if (raw.toLowerCase().includes(kw)) {
        const capEv = CapabilityResolver.resolve(kw, undefined, raw);
        if (capEv) {
          evidenceList.push(capEv);
        }
      }
    }

    return {
      rawText: raw,
      evidenceList,
      dominantScope,
      dominantSeniority,
      dominantGeography,
      dominantOrganization,
    };
  }
}
