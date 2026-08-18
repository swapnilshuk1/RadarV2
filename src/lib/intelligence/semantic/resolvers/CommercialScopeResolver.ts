/**
 * src/lib/intelligence/semantic/resolvers/CommercialScopeResolver.ts
 *
 * Financial and Commercial Scope Resolver.
 *
 * Invariant Rules:
 * - Differentiates end-to-end P&L from financial sub-metrics (EBITDA, Gross Margin, Revenue).
 * - "EBITDA ownership" resolves to EBITDA_ACCOUNTABILITY (SUBTYPE of Financial Scope),
 *   providing STRONG_SUPPORT for financial accountability without fabricating complete P&L ownership.
 * - Extracts numerical scale ($M, $B, ₹ Cr) into normalized numeric amounts.
 * - Enforces Negation and Temporal state extraction.
 */

import type { CanonicalSemanticEvidence, EvidenceRelationship, EvidenceStrength, FinancialScopeResolutionResult, SemanticRelationship } from "../types";
import { NegationDetector } from "../normalizers/NegationDetector";
import { TemporalParser } from "../normalizers/TemporalParser";
import { ContextualDisambiguator } from "../normalizers/ContextualDisambiguator";

export class CommercialScopeResolver {
  /**
   * Resolves a financial/commercial expression into structured attributes and canonical evidence.
   */
  public static resolve(rawPhrase: string, context: string = ""): FinancialScopeResolutionResult {
    const raw = rawPhrase.trim();
    const fullContext = context ? `${context} ${raw}` : raw;

    // Disambiguate GM (Gross Margin vs General Manager)
    if (/\bgm\b/i.test(raw) || /\bgm\b/i.test(fullContext)) {
      const gmCheck = ContextualDisambiguator.disambiguateGM(fullContext);
      if (!gmCheck.isFalsePositive) {
        // This is an executive title (General Manager), not a financial metric
        const negation = NegationDetector.analyze(fullContext, raw);
        const temporal = TemporalParser.parse(fullContext);
        return {
          canonicalConcept: "NON_FINANCIAL_EXECUTIVE_TITLE",
          hasPnlOwnership: false,
          hasEbitdaAccountability: false,
          hasRevenueAccountability: false,
          hasBudgetAuthority: false,
          evidenceStrength: "EXCLUDED",
          temporalState: temporal.temporalState,
          negated: negation.negated,
          evidence: {
            canonicalConcept: "GENERAL_MANAGER_TITLE",
            entityType: "FINANCIAL_SCOPE",
            semanticRelationship: "RELATED",
            evidenceRelationship: "NON_SATISFYING",
            direction: "NONE",
            confidence: gmCheck.confidence,
            sourcePhrase: raw,
            context: fullContext,
            negated: negation.negated,
            temporalState: temporal.temporalState,
            evidenceStrength: "EXCLUDED",
          }
        };
      }
    }

    const textLower = fullContext.toLowerCase();
    const negation = NegationDetector.analyze(fullContext, raw);
    const temporal = TemporalParser.parse(fullContext);

    // 1. Currency & Scale Extraction
    let scaleAmountUsd: number | undefined;
    let scaleAmountInrCrores: number | undefined;

    // USD Match (e.g. $50M, $100M, $1B, 50 million)
    const usdMatch = textLower.match(/\$\s*(\d+(?:\.\d+)?)\s*(k|m|b|million|billion)?\b/i) ||
                     textLower.match(/(\d+(?:\.\d+)?)\s*(?:million|billion)\s*(?:usd|dollars)?\b/i);
    if (usdMatch) {
      const val = parseFloat(usdMatch[1]);
      const unit = (usdMatch[2] || "").toLowerCase();
      if (unit.startsWith("b")) {
        scaleAmountUsd = val * 1_000_000_000;
      } else if (unit.startsWith("m") || !unit) {
        scaleAmountUsd = val * 1_000_000;
      } else if (unit.startsWith("k")) {
        scaleAmountUsd = val * 1_000;
      }
    }

    // INR Crores Match (e.g. ₹500 Cr, 500 Crores, 500cr)
    const inrMatch = textLower.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:cr|crores?|crore)\b/i);
    if (inrMatch) {
      scaleAmountInrCrores = parseFloat(inrMatch[1]);
      if (!scaleAmountUsd) {
        // Approximate conversion for parity comparisons (1 USD = ~83 INR, 1 Cr = 10M INR = ~$120K USD)
        scaleAmountUsd = (scaleAmountInrCrores * 10_000_000) / 83;
      }
    }

    // 2. Classify Exact Financial Concept
    let canonicalConcept = "COMMERCIAL_SCOPE_GENERAL";
    let semRel: SemanticRelationship = "RELATED";
    let evRel: EvidenceRelationship = "CONTEXTUAL_SUPPORT";
    let finalEvidenceStrength: EvidenceStrength = negation.evidenceStrength;
    let hasPnlOwnership = false;
    let hasEbitdaAccountability = false;
    let hasRevenueAccountability = false;
    let hasBudgetAuthority = false;
    let confidence = 0.90;

    // Check for Full P&L ownership
    if (/\b(?:p&l|pl|profit\s+(?:and|\/|&)\s+loss)\b/i.test(textLower)) {
      canonicalConcept = "PNL_RESPONSIBILITY";
      hasPnlOwnership = true;
      hasRevenueAccountability = true;
      hasEbitdaAccountability = true;
      semRel = /\b(?:p&l|profit\s+and\s+loss)\b/i.test(raw.toLowerCase()) ? "EXACT" : "ALIAS";
      evRel = "DIRECT_EQUIVALENT";
      confidence = 0.99;
    }
    // Check for Turnover / Topline & Bottomline / ₹ Cr business
    else if (/\b(?:turnover|topline\s+and\s+bottom\s*line|commercial\s+ownership|business\s+unit\s+financial\s+ownership|managed\s+a\s+\$(?:1b|\d+m)\s+business|consumer\s+business|b2b\s+business)\b/i.test(textLower) ||
             inrMatch !== null) {
      canonicalConcept = "PNL_RESPONSIBILITY";
      hasPnlOwnership = true;
      hasRevenueAccountability = true;
      hasEbitdaAccountability = true;
      semRel = "STRONG_EQUIVALENT";
      evRel = "STRONG_SUPPORT";
      confidence = 0.95;
    }
    // Check for EBITDA accountability (SUBTYPE - not full P&L)
    else if (/\b(?:ebitda|operating\s+profit|commercial\s+margins?|margin\s+accountability)\b/i.test(textLower)) {
      canonicalConcept = "EBITDA_ACCOUNTABILITY";
      hasPnlOwnership = false; // Strictly false for standalone EBITDA
      hasEbitdaAccountability = true;
      semRel = "SUBTYPE";
      evRel = "STRONG_SUPPORT";
      confidence = 0.93;
    }
    // Check for Gross Margin / Operating Margin (SUBTYPE)
    else if (/\b(?:gross\s+margin|operating\s+margin|margin\s+expansion)\b/i.test(textLower)) {
      canonicalConcept = "MARGIN_ACCOUNTABILITY";
      hasPnlOwnership = false;
      hasEbitdaAccountability = false;
      semRel = "SUBTYPE";
      evRel = "PARTIAL_SUPPORT";
      confidence = 0.90;
    }
    // Check for Revenue Target / Topline accountability
    else if (/\b(?:revenue\s+(?:target|quota|delivery|responsibility)|accountable\s+for\s+revenue)\b/i.test(textLower)) {
      canonicalConcept = "REVENUE_ACCOUNTABILITY";
      hasPnlOwnership = false;
      hasRevenueAccountability = true;
      semRel = "STRONG_EQUIVALENT";
      evRel = "STRONG_SUPPORT";
      confidence = 0.93;
    }
    // Check for Budget Authority
    else if (/\b(?:budget\s+(?:ownership|authority|holder)|managed\s+(?:a\s+)?budget)\b/i.test(textLower)) {
      canonicalConcept = "BUDGET_AUTHORITY";
      hasBudgetAuthority = true;
      semRel = "SUBTYPE";
      evRel = "PARTIAL_SUPPORT";
      confidence = 0.92;
    }

    // Apply Negation & Temporal Adjustments to Evidence Relationships
    if (negation.negated) {
      semRel = "NEGATED";
      evRel = "EXCLUDED";
      finalEvidenceStrength = "EXCLUDED";
      hasPnlOwnership = false;
      hasEbitdaAccountability = false;
      hasRevenueAccountability = false;
      hasBudgetAuthority = false;
    } else if (negation.evidenceStrength === "CONTRIBUTOR") {
      evRel = "CONTRIBUTOR";
      finalEvidenceStrength = "CONTRIBUTOR";
      hasPnlOwnership = false; // Contributor does not own full P&L
    } else if (negation.evidenceStrength === "STAKEHOLDER") {
      evRel = "STAKEHOLDER";
      finalEvidenceStrength = "STAKEHOLDER";
      hasPnlOwnership = false;
    }

    if (temporal.temporalState === "ASPIRATIONAL") {
      semRel = "ASPIRATIONAL";
      evRel = "EXCLUDED";
      finalEvidenceStrength = "EXCLUDED";
      hasPnlOwnership = false;
      hasEbitdaAccountability = false;
      hasRevenueAccountability = false;
    }

    const evidence: CanonicalSemanticEvidence = {
      canonicalConcept,
      entityType: "FINANCIAL_SCOPE",
      semanticRelationship: semRel,
      evidenceRelationship: evRel,
      direction: semRel === "EXACT" || semRel === "ALIAS" ? "BIDIRECTIONAL_EQUIVALENT" : "SOURCE_TO_TARGET",
      confidence,
      sourcePhrase: raw,
      context: fullContext,
      negated: negation.negated,
      temporalState: temporal.temporalState,
      evidenceStrength: finalEvidenceStrength,
      metadata: {
        scaleAmountUsd,
        scaleAmountInrCrores,
        hasPnlOwnership,
        hasEbitdaAccountability,
        hasRevenueAccountability,
      }
    };

    return {
      canonicalConcept,
      scaleAmountUsd,
      scaleAmountInrCrores,
      hasPnlOwnership,
      hasEbitdaAccountability,
      hasRevenueAccountability,
      hasBudgetAuthority,
      evidenceStrength: finalEvidenceStrength,
      temporalState: temporal.temporalState,
      negated: negation.negated,
      evidence,
    };
  }
}
