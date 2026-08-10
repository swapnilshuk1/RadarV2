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

    // Core Logical Decision Table for Operating Level
    if (workNature.value === "UNKNOWN") {
      evidenceIds.push("ol_rule_fallback_managerial");
      return { value: "MANAGERIAL", evidenceIds, confidence: 0.5 };
    }

    // EXECUTIVE
    if (
      (decAuth.value === "ENTERPRISE" || decAuth.value === "BUSINESS_UNIT") &&
      (commScope.value === "ENTERPRISE" || commScope.value === "PORTFOLIO") &&
      (workNature.value === "EXECUTIVE_WORK" || workNature.value === "STRATEGIC_WORK")
    ) {
      evidenceIds.push("ol_rule_exec_hq");
      return { value: "EXECUTIVE", evidenceIds, confidence: 0.9 };
    }

    // STRATEGIC
    if (
      decAuth.value === "BUSINESS_UNIT" || 
      workNature.value === "STRATEGIC_WORK" ||
      workNature.value === "EXECUTIVE_WORK"
    ) {
      evidenceIds.push("ol_rule_strategic");
      return { value: "STRATEGIC", evidenceIds, confidence: 0.85 };
    }

    // MANAGERIAL
    if (
      decAuth.value === "TEAM" ||
      (decAuth.value as string) === "FUNCTION" ||
      workNature.value === "MANAGERIAL_WORK"
    ) {
      evidenceIds.push("ol_rule_managerial");
      return { value: "MANAGERIAL", evidenceIds, confidence: 0.8 };
    }

    // TACTICAL
    if (
      workNature.value === "TACTICAL_WORK"
    ) {
      evidenceIds.push("ol_rule_tactical");
      return { value: "TACTICAL", evidenceIds, confidence: 0.85 };
    }

    // INDIVIDUAL CONTRIBUTOR
    evidenceIds.push("ol_rule_ic");
    return { value: "INDIVIDUAL_CONTRIBUTOR", evidenceIds, confidence: 0.8 };
  }
}
