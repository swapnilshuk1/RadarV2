/**
 * src/lib/intelligence/semantic/RequirementEvidenceAdapter.ts
 *
 * RADAR V4 Requirement-Aware Semantic Evidence Adapter
 *
 * Invariant Rules:
 * 1. Semantic Resolution = Resolves meaning (What does this phrase/entity mean?)
 * 2. Requirement Satisfaction = Evaluated by this adapter against specific requirement contexts.
 * 3. NO UNIVERSAL SATISFACTION: A subtype or metric does NOT universally satisfy parent functional requirements.
 *    - EBITDA_ACCOUNTABILITY strongly supports commercial scope, but does NOT satisfy explicit PNL_OWNERSHIP.
 *    - NRR supports RETENTION_AND_EXPANSION, but does NOT satisfy CUSTOMER_SUCCESS_FUNCTIONAL_OWNERSHIP.
 *    - ACCREDITED_INVESTOR does NOT satisfy PORTFOLIO_MANAGEMENT_EXPERIENCE.
 * 4. PURE & DETERMINISTIC: Zero external side effects, zero database calls, zero score mutations.
 */

import { CanonicalSemanticEvidence, SeniorityBand, EntityType } from "./types";
import { GeographyResolver } from "./resolvers/GeographyResolver";

export interface RequirementMatchResult {
  readonly satisfies: boolean;
  readonly strength: "DIRECT_MATCH" | "STRONG_SUPPORT" | "PARTIAL_SUPPORT" | "NONE";
  readonly confidence: number;
  readonly reason: string;
  readonly matchedProof?: string;
  readonly matchedEvidence?: CanonicalSemanticEvidence;
}

export class RequirementEvidenceAdapter {
  /**
   * Evaluates whether candidate semantic evidence satisfies a specific job capability requirement.
   */
  public static evaluateCapabilitySatisfaction(
    jobCapability: string,
    candidateEvidence: readonly CanonicalSemanticEvidence[]
  ): RequirementMatchResult {
    const jobCapLower = jobCapability.toLowerCase().trim();

    // Filter candidate evidence: must not be negated, must not be aspirational
    const validEvidence = candidateEvidence.filter(
      (ev) => !ev.negated && ev.temporalState !== "ASPIRATIONAL" && ev.evidenceStrength !== "EXCLUDED"
    );

    for (const ev of validEvidence) {
      if (ev.entityType !== "CAPABILITY" && ev.entityType !== "MANDATE" && ev.entityType !== "FINANCIAL_SCOPE") {
        continue;
      }

      const canonicalConcept = ev.canonicalConcept.toLowerCase().trim();
      const sourcePhrase = ev.sourcePhrase.toLowerCase().trim();

      // 1. Exact Concept or Alias Match
      if (
        canonicalConcept === jobCapLower ||
        jobCapLower.includes(canonicalConcept) ||
        canonicalConcept.includes(jobCapLower) ||
        sourcePhrase === jobCapLower ||
        jobCapLower.includes(sourcePhrase) ||
        sourcePhrase.includes(jobCapLower)
      ) {
        if (ev.semanticRelationship === "EXACT" || ev.semanticRelationship === "ALIAS" || ev.semanticRelationship === "ACRONYM") {
          return {
            satisfies: true,
            strength: "DIRECT_MATCH",
            confidence: Math.max(0.9, ev.confidence),
            reason: `Direct Semantic Evidence Match (${ev.canonicalConcept} [${ev.semanticRelationship}])`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
        if (ev.semanticRelationship === "STRONG_EQUIVALENT") {
          return {
            satisfies: true,
            strength: "STRONG_SUPPORT",
            confidence: Math.max(0.85, ev.confidence),
            reason: `Strong Semantic Equivalent (${ev.canonicalConcept} ➔ ${jobCapability})`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
      }

      // 2. Specific Context-Aware Requirement Mappings (No Generic SUBTYPE = PASS)
      // Rule A: NRR / Retention & Expansion
      if (jobCapLower.includes("retention") || jobCapLower.includes("expansion") || jobCapLower.includes("churn") || jobCapLower.includes("nrr")) {
        if (canonicalConcept.includes("nrr") || canonicalConcept.includes("retention") || sourcePhrase.includes("nrr")) {
          return {
            satisfies: true,
            strength: "STRONG_SUPPORT",
            confidence: 0.88,
            reason: `Semantic Evidence Match: NRR proves Retention & Expansion capability`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
      }

      // Rule B: Customer Success Functional Ownership requires explicit Customer Success/Account Management, NOT just NRR metric
      if (jobCapLower.includes("customer success") && !jobCapLower.includes("retention")) {
        if (canonicalConcept.includes("customer success") || sourcePhrase.includes("customer success")) {
          return {
            satisfies: true,
            strength: "DIRECT_MATCH",
            confidence: 0.90,
            reason: `Direct Semantic Customer Success Ownership`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
        // If candidate only has NRR without CS functional leadership: Partial support only
        if (canonicalConcept.includes("nrr") || sourcePhrase.includes("nrr")) {
          return {
            satisfies: false,
            strength: "PARTIAL_SUPPORT",
            confidence: 0.40,
            reason: `Metric evidence (NRR) provides partial context but does not satisfy Customer Success functional ownership`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
      }

      // Rule C: CRM / CDP / Marketing Automation
      if (jobCapLower.includes("crm") || jobCapLower.includes("cdp") || jobCapLower.includes("customer data")) {
        if (
          canonicalConcept.includes("crm") ||
          canonicalConcept.includes("cdp") ||
          canonicalConcept.includes("salesforce") ||
          canonicalConcept.includes("braze") ||
          canonicalConcept.includes("klaviyo") ||
          canonicalConcept.includes("segment")
        ) {
          return {
            satisfies: true,
            strength: "STRONG_SUPPORT",
            confidence: 0.88,
            reason: `CRM & MarTech Platform Semantic Grounding (${ev.canonicalConcept})`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
      }

      // Rule D: Performance Marketing & Growth
      if (jobCapLower.includes("performance marketing") || jobCapLower.includes("paid acquisition") || jobCapLower.includes("growth marketing")) {
        if (
          canonicalConcept.includes("performance marketing") ||
          canonicalConcept.includes("growth marketing") ||
          canonicalConcept.includes("d2c growth") ||
          sourcePhrase.includes("performance marketing")
        ) {
          return {
            satisfies: true,
            strength: "DIRECT_MATCH",
            confidence: 0.90,
            reason: `Performance & Growth Marketing Semantic Grounding (${ev.canonicalConcept})`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
      }

      // Rule E: Digital Transformation
      if (jobCapLower.includes("digital transformation") || jobCapLower.includes("modernization") || jobCapLower.includes("transformation")) {
        if (canonicalConcept.includes("transformation") || canonicalConcept.includes("modernization")) {
          return {
            satisfies: true,
            strength: "STRONG_SUPPORT",
            confidence: 0.88,
            reason: `Digital Transformation Semantic Grounding (${ev.canonicalConcept})`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
      }
    }

    return {
      satisfies: false,
      strength: "NONE",
      confidence: 0.0,
      reason: "No semantic requirement satisfaction found"
    };
  }

  /**
   * Evaluates candidate commercial scope evidence against opportunity requirements.
   * Enforces that EBITDA_ACCOUNTABILITY or CONTRIBUTOR does NOT satisfy explicit PNL_OWNERSHIP.
   */
  public static evaluateCommercialScopeSatisfaction(
    evidence: readonly CanonicalSemanticEvidence[]
  ): {
    readonly hasDirectPnlOwnership: boolean;
    readonly hasEbitdaAccountability: boolean;
    readonly hasRevenueAccountability: boolean;
    readonly hasBudgetAuthority: boolean;
    readonly highestCommercialScaleUsd?: number;
  } {
    let hasDirectPnlOwnership = false;
    let hasEbitdaAccountability = false;
    let hasRevenueAccountability = false;
    let hasBudgetAuthority = false;
    let highestCommercialScaleUsd: number | undefined = undefined;

    const validEvidence = evidence.filter(
      (ev) => !ev.negated && ev.temporalState !== "ASPIRATIONAL" && ev.evidenceStrength !== "EXCLUDED"
    );

    for (const ev of validEvidence) {
      if (ev.entityType !== "FINANCIAL_SCOPE") continue;

      const concept = ev.canonicalConcept;
      const isDirectOwnership = ev.evidenceStrength === "DIRECT_OWNERSHIP";

      if (concept.includes("PNL_OWNERSHIP") && isDirectOwnership) {
        hasDirectPnlOwnership = true;
      }
      if (concept.includes("EBITDA_ACCOUNTABILITY")) {
        hasEbitdaAccountability = true;
      }
      if (concept.includes("REVENUE_ACCOUNTABILITY") || concept.includes("COMMERCIAL_GROWTH")) {
        hasRevenueAccountability = true;
      }
      if (concept.includes("BUDGET_AUTHORITY")) {
        hasBudgetAuthority = true;
      }

      const metaScale = (ev.metadata as any)?.scaleAmountUsd;
      if (typeof metaScale === "number" && (!highestCommercialScaleUsd || metaScale > highestCommercialScaleUsd)) {
        highestCommercialScaleUsd = metaScale;
      }
    }

    return {
      hasDirectPnlOwnership,
      hasEbitdaAccountability,
      hasRevenueAccountability,
      hasBudgetAuthority,
      highestCommercialScaleUsd
    };
  }

  /**
   * Evaluates seniority satisfaction against required target band.
   */
  public static evaluateSenioritySatisfaction(
    targetSeniority: SeniorityBand | string,
    evidence: readonly CanonicalSemanticEvidence[]
  ): RequirementMatchResult {
    const validEvidence = evidence.filter(
      (ev) => !ev.negated && ev.temporalState !== "ASPIRATIONAL" && ev.evidenceStrength !== "EXCLUDED"
    );

    for (const ev of validEvidence) {
      if (ev.entityType !== "SENIORITY_TITLE") continue;

      const band = (ev.metadata as any)?.seniorityBand as SeniorityBand | undefined;
      if (!band) continue;

      if (targetSeniority === "EXECUTIVE" || targetSeniority === "C_SUITE" || targetSeniority === "VP") {
        if (band === "C_SUITE" || band === "VP") {
          return {
            satisfies: true,
            strength: "DIRECT_MATCH",
            confidence: ev.confidence,
            reason: `Direct executive seniority match: ${band}`,
            matchedProof: ev.sourcePhrase,
            matchedEvidence: ev
          };
        }
      } else if (targetSeniority === band) {
        return {
          satisfies: true,
          strength: "DIRECT_MATCH",
          confidence: ev.confidence,
          reason: `Exact seniority band match: ${band}`,
          matchedProof: ev.sourcePhrase,
          matchedEvidence: ev
        };
      }
    }

    return {
      satisfies: false,
      strength: "NONE",
      confidence: 0,
      reason: `Evidence does not satisfy required seniority band: ${targetSeniority}`
    };
  }

  /**
   * Evaluates geographic compatibility between candidate location preferences and opportunity location.
   */
  public static evaluateLocationCompatibility(
    preferredLocations: readonly string[],
    opportunityLocation: string,
    evidence: readonly CanonicalSemanticEvidence[] = []
  ): {
    readonly isCompatible: boolean;
    readonly isMetroCluster: boolean;
    readonly matchedCity?: string;
  } {
    const oppLower = opportunityLocation.toLowerCase().trim();

    if (preferredLocations.some((loc) => loc.toLowerCase() === "remote" || loc.toLowerCase() === "any")) {
      return { isCompatible: true, isMetroCluster: false, matchedCity: "REMOTE/ANY" };
    }

    for (const pref of preferredLocations) {
      const prefLower = pref.toLowerCase().trim();
      if (oppLower.includes(prefLower) || prefLower.includes(oppLower)) {
        return { isCompatible: true, isMetroCluster: false, matchedCity: pref };
      }

      const geoRes = GeographyResolver.resolve(opportunityLocation, pref);
      if (geoRes.isMetroCommuteCompatible || geoRes.isCityEquivalent) {
        return {
          isCompatible: true,
          isMetroCluster: geoRes.semanticRelationship === "METRO_CLUSTER" || geoRes.isMetroCommuteCompatible,
          matchedCity: geoRes.canonicalLocation
        };
      }
    }

    return { isCompatible: false, isMetroCluster: false };
  }
}
