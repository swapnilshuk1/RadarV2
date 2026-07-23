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
    const enterpriseKeywords = [
      "p&l", "profit and loss", "enterprise budget", "capital allocation", "annual budget",
      "revenue outcomes", "corporate finance", "full p&l"
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
    if (matchesEnterprise.length >= 1) {
      matchesEnterprise.forEach(m => evidenceIds.push(`cs_ent_${m.replace(/\s+/g, "_")}`));
      return { value: "ENTERPRISE", evidenceIds, confidence: 0.9 };
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
