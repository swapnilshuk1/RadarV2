// Layer 3 — Hard gates. Never scored. If any gate trips, the record is
// filtered before Priority runs.

import { dim, type OpportunityIntelligence } from "./schema";
import type { CareerPreferences, SearchStrategy } from "./candidate";
import { functionalClassifier } from "./FunctionalClassifier";

export type EligibilityResult = {
  eligible: boolean;
  blockers: string[];
};

export function isFunctionalMismatch(role: string): boolean {
  const r = role.toLowerCase();
  
  // Fast, deterministic fallback keywords for completely out-of-scope non-marketing/non-growth leadership.
  const exclusions = [
    /\b(cfo|chief financial officer|chief finance officer|financial controller|finance lead|finance manager|director of finance|head of finance|treasury|tax\b|audit\b|accounting|accountant)\b/i,
    /\b(hr\b|human resources|chief people officer|people director|head of people|talent acquisition|recruiter|people ops|learning and development)\b/i,
    /\b(legal|general counsel|compliance officer|compliance manager|compliance lead|lawyer|attorney)\b/i,
    /\b(ciso|cybersecurity|information security|security engineer)\b/i,
    /\b(java developer|python developer|devops|solutions architect|data engineer|cloud engineer|systems administrator|network engineer|backend developer|frontend developer|full stack developer|qa engineer|test engineer|cto|chief technology officer|director of engineering|vp of engineering|vice president of engineering|engineering lead|tech lead|head of engineering)\b/i,
    /\b(business development executive|bde\b|inside sales|telesales|telemarketing|lead generation|lead generator|pre-sales|presales|field sales)\b/i,
    /\b(delivery operations|operations director|director of operations|operations manager|transformation director|delivery manager|project manager|program manager)\b/i,
    /\b(social media executive|seo executive|ppc executive|content executive|seo specialist|seo analyst|marketing coordinator|marketing assistant|social media specialist|graphic designer|copywriter|content writer|content creator)\b/i,
  ];

  return exclusions.some(rx => rx.test(r));
}

export function checkEligibility(
  oi: OpportunityIntelligence,
  _prefs: CareerPreferences,
  strategy: SearchStrategy,
): EligibilityResult {
  const blockers: string[] = [];
  
  // 1. Check requiredLevel contradiction
  const level = dim(oi, "requiredLevel");
  if (level && level.bucket === "Contradicted" && strategy.trajectory === "cxo") {
    blockers.push("requiredLevel");
  }

  // 2. Classify functionalCategory on-the-fly if missing or evaluate existing
  let funcCat = dim(oi, "functionalCategory");
  let catValue = funcCat?.jdEvidence?.value;

  if (!catValue) {
    const classification = functionalClassifier.classifySync({
      title: oi.role,
      company: oi.company,
      location: oi.location
    });
    catValue = classification.value;
  }

  // Define out-of-scope Concentric Ring categories
  const excludedCategories = [
    "Engineering",
    "Product",
    "HR",
    "Finance",
    "General Management",
    "Consulting",
    "Other"
  ];

  // If functional category belongs to the excluded concentric ring, block it
  if (catValue && excludedCategories.includes(catValue)) {
    blockers.push("functionalCategory");
  }

  // Deterministic keyword fallback for additional safety
  if (isFunctionalMismatch(oi.role) && blockers.indexOf("functionalCategory") === -1) {
    blockers.push("functionalCategory");
  }

  return { eligible: blockers.length === 0, blockers };
}