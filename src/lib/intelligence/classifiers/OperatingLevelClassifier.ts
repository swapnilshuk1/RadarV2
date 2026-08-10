// src/lib/intelligence/classifiers/OperatingLevelClassifier.ts

import { ClassifierResult, OperatingLevel } from "../../domain/semantic";
import { DecisionAuthorityClassifier } from "./DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "./CommercialScopeClassifier";
import { WorkNatureClassifier } from "./WorkNatureClassifier";

export class OperatingLevelClassifier {
  public static classify(text: string, title: string): ClassifierResult<OperatingLevel> {
    const evidenceIds: string[] = [];

    // Run the sub-classifiers
    const decAuth = DecisionAuthorityClassifier.classify(text, title);
    const commScope = CommercialScopeClassifier.classify(text, title);
    const workNature = WorkNatureClassifier.classify(text, title);

    // Combine evidence IDs
    evidenceIds.push(...decAuth.evidenceIds);
    evidenceIds.push(...commScope.evidenceIds);
    evidenceIds.push(...workNature.evidenceIds);

    const tLower = title.toLowerCase();
    const textLower = (title + " " + text).toLowerCase();

    // 1. Title Seniority Prior Classification
    const isExecutiveTitle = 
      tLower.includes("cmo") || 
      tLower.includes("cgo") || 
      tLower.includes("cro") || 
      tLower.includes("coo") || 
      tLower.includes("chief") || 
      tLower.includes("vice president") || 
      tLower.includes("vp") || 
      tLower.includes("svp") || 
      tLower.includes("country head") || 
      tLower.includes("head of") || 
      tLower.includes("head -") || 
      tLower.includes("director");

    const isExplicitMidTierTitle = 
      (tLower.includes("manager") || 
       tLower.includes("senior manager") || 
       tLower.includes("specialist") || 
       tLower.includes("analyst") || 
       tLower.includes("coordinator") || 
       tLower.includes("associate") || 
       tLower.includes("copywriter")) && 
      !tLower.includes("general manager") && 
      !tLower.includes("country manager") && 
      !tLower.includes("managing director") && 
      !tLower.includes("p&l manager");

    // 2. Contradiction Checks for Executive Prior
    const hasLowYoEContradiction = 
      isExecutiveTitle && 
      (/(?:3-5|3-7|4-6|5-7|4-7|3-6)\s*years/i.test(textLower) || textLower.includes("3-5 years") || textLower.includes("3-7 years"));

    const isTacticalExecutionOnly = 
      workNature.value === "TACTICAL_WORK" || workNature.value === "SPECIALIST_WORK";

    const isNarrowUnitScope = 
      tLower.includes("site strategy") || tLower.includes("digital trading") || tLower.includes("cluster head");

    // 3. Apply Asymmetric Prior Rule
    if (isExecutiveTitle && !hasLowYoEContradiction && !isTacticalExecutionOnly && !isNarrowUnitScope) {
      evidenceIds.push("ol_asymmetric_exec_prior");
      return { value: "EXECUTIVE", evidenceIds, confidence: 0.9 };
    }

    if (hasLowYoEContradiction || isTacticalExecutionOnly || isNarrowUnitScope) {
      evidenceIds.push("ol_contradiction_downgrade");
      return { value: "STRATEGIC", evidenceIds, confidence: 0.8 };
    }

    if (isExplicitMidTierTitle) {
      evidenceIds.push("ol_midtier_prior_sub_exec");
      return { value: "MANAGERIAL", evidenceIds, confidence: 0.85 };
    }

    // Fallback based on work nature and decision authority
    if (decAuth.value === "ENTERPRISE" || decAuth.value === "BUSINESS_UNIT" || workNature.value === "EXECUTIVE_WORK") {
      evidenceIds.push("ol_rule_exec_fallback");
      return { value: "EXECUTIVE", evidenceIds, confidence: 0.85 };
    }

    evidenceIds.push("ol_rule_default_strategic");
    return { value: "STRATEGIC", evidenceIds, confidence: 0.8 };
  }
}
