// src/lib/intelligence/classifiers/DecisionAuthorityClassifier.ts

import { ClassifierResult, DecisionAuthority } from "../../domain/semantic";

function hasWord(text: string, word: string): boolean {
  // Safe regex boundary checking to avoid false substring matches (e.g., matching "bu" inside "bengaluru")
  const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}

export class DecisionAuthorityClassifier {
  public static classify(text: string, title: string): ClassifierResult<DecisionAuthority> {
    const textLower = `${title} ${text}`.toLowerCase();
    const evidenceIds: string[] = [];

    // Heuristics for Decision Authority
    const enterpriseKeywords = [
      "board", "ceo", "c-suite", "enterprise-wide", "corporate", "managing director",
      "executive committee", "global strategy", "shareholders"
    ];

    const buKeywords = [
      "business unit", "bu", "division", "country head", "regional head", "segment lead"
    ];

    const functionalKeywords = [
      "department", "functional", "practice lead", "center of excellence", "coe",
      "functional head", "marketing operations", "engineering head"
    ];

    const teamKeywords = [
      "team lead", "pod", "scrum master", "daily stand-up", "backlog manager", "squad", "scrum"
    ];

    // Find evidence matching enterprise
    const matchesEnterprise = enterpriseKeywords.filter(kw => hasWord(textLower, kw));
    if (matchesEnterprise.length >= 1) {
      matchesEnterprise.forEach(m => evidenceIds.push(`da_ent_${m.replace(/\s+/g, "_")}`));
      return { value: "ENTERPRISE", evidenceIds, confidence: 0.9 };
    }

    // Find evidence matching business unit
    const matchesBU = buKeywords.filter(kw => hasWord(textLower, kw));
    if (matchesBU.length >= 1) {
      matchesBU.forEach(m => evidenceIds.push(`da_bu_${m.replace(/\s+/g, "_")}`));
      return { value: "BUSINESS_UNIT", evidenceIds, confidence: 0.85 };
    }

    // Find evidence matching function
    const matchesFunctional = functionalKeywords.filter(kw => hasWord(textLower, kw));
    if (matchesFunctional.length >= 1) {
      matchesFunctional.forEach(m => evidenceIds.push(`da_func_${m.replace(/\s+/g, "_")}`));
      return { value: "FUNCTION", evidenceIds, confidence: 0.8 };
    }

    // Find evidence matching team
    const matchesTeam = teamKeywords.filter(kw => hasWord(textLower, kw));
    if (matchesTeam.length >= 1) {
      matchesTeam.forEach(m => evidenceIds.push(`da_team_${m.replace(/\s+/g, "_")}`));
      return { value: "TEAM", evidenceIds, confidence: 0.75 };
    }

    // Default self / unknown
    evidenceIds.push("da_default_self");
    return { value: "SELF", evidenceIds, confidence: 0.5 };
  }
}
