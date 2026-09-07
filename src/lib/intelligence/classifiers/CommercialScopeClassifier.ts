// src/lib/intelligence/classifiers/CommercialScopeClassifier.ts

import { ClassifierResult, CommercialScope } from "../../domain/semantic";

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}

export class CommercialScopeClassifier {
  public static classify(text: string, title: string): ClassifierResult<CommercialScope> {
    const textLower = `${title} ${text}`.toLowerCase();
    const evidenceIds: string[] = [];

    // Heuristics for Commercial Scope
    // A bare P&L mention does not establish enterprise-wide ownership. It is
    // common in agency and portfolio roles, so require an explicit enterprise
    // boundary before classifying commercial scope as ENTERPRISE.
    const enterpriseKeywords = [
      "enterprise budget", "capital allocation", "annual budget",
      "corporate finance", "full p&l"
    ];

    const portfolioKeywords = [
      "portfolio", "retainer", "client account", "client book", "multi-product",
      "program budget", "division budget"
    ];

    const productKeywords = [
      "product line", "product budget", "marketing budget", "channel budget", "department budget"
    ];

    const campaignKeywords = [
      "campaign budget", "campaign spend", "ad spend", "project budget", "tactical spend"
    ];

    const matchesEnterprise = enterpriseKeywords.filter(kw => hasWord(textLower, kw));
    const hasEnterprisePnl = /\b(?:enterprise|company|corporate|global|full)(?:[- ]wide)?\s+(?:p&l|profit\s+and\s+loss)\b/i.test(textLower);
    // Direct ownership of the end-to-end business P&L is substantive scope
    // evidence even when the JD does not use the exact phrase "enterprise
    // P&L". Keep this distinct from generic revenue or margin language: the
    // latter can describe an objective without granting commercial authority.
    const hasDirectPnlOwnership = /\b(?:own(?:s|ed|ership)?(?:\s+of)?|accountable\s+for|responsib(?:le|ility)\s+for|lead(?:s|ing)?)\s+(?:the\s+)?(?:(?:end[- ]to[- ]end|full|overall)\s+)?(?:p\s*&\s*l|profit\s+and\s+loss)\b/i.test(textLower);
    const hasDirectCommercialOwnership = /\b(?:own(?:s|ed|ership)?(?:\s+of)?|accountable\s+for|responsib(?:le|ility)\s+for)\s+(?:the\s+)?(?:revenue|profitability|margins?|gross\s+margin)\b/i.test(textLower);
    const hasBusinessBoundary = /\b(?:end[- ]to[- ]end|overall\s+business|business\s+performance|entire\s+business|company(?:[- ]wide)?|enterprise(?:[- ]wide)?|revenue\s*,?\s*profitability\s*,?\s*(?:margins?|margin))\b/i.test(textLower);
    if (matchesEnterprise.length >= 1 || hasEnterprisePnl || ((hasDirectPnlOwnership || hasDirectCommercialOwnership) && hasBusinessBoundary)) {
      if (hasEnterprisePnl) matchesEnterprise.push("enterprise_p&l");
      if ((hasDirectPnlOwnership || hasDirectCommercialOwnership) && hasBusinessBoundary) matchesEnterprise.push("direct_business_commercial_ownership");
      matchesEnterprise.forEach(m => evidenceIds.push(`cs_ent_${m.replace(/\s+/g, "_")}`));
      return { value: "ENTERPRISE", evidenceIds, confidence: 0.9 };
    }

    // A direct P&L owner has a material commercial remit even where the
    // document does not establish that it spans the whole company. Portfolio
    // scope is truthful and deliberately weaker than enterprise scope.
    if (hasDirectPnlOwnership || hasDirectCommercialOwnership) {
      return { value: "PORTFOLIO", evidenceIds: ["cs_port_direct_commercial_ownership"], confidence: 0.85 };
    }

    const matchesPortfolio = portfolioKeywords.filter(kw => hasWord(textLower, kw));
    if (matchesPortfolio.length >= 1) {
      matchesPortfolio.forEach(m => evidenceIds.push(`cs_port_${m.replace(/\s+/g, "_")}`));
      return { value: "PORTFOLIO", evidenceIds, confidence: 0.85 };
    }

    const matchesProduct = productKeywords.filter(kw => hasWord(textLower, kw));
    if (matchesProduct.length >= 1) {
      matchesProduct.forEach(m => evidenceIds.push(`cs_prod_${m.replace(/\s+/g, "_")}`));
      return { value: "PRODUCT", evidenceIds, confidence: 0.8 };
    }

    const matchesCampaign = campaignKeywords.filter(kw => hasWord(textLower, kw));
    if (matchesCampaign.length >= 1) {
      matchesCampaign.forEach(m => evidenceIds.push(`cs_camp_${m.replace(/\s+/g, "_")}`));
      return { value: "CAMPAIGN", evidenceIds, confidence: 0.75 };
    }

    evidenceIds.push("cs_none");
    return { value: "NONE", evidenceIds, confidence: 0.6 };
  }
}
