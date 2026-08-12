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

    // Role-contextual high-confidence non-commercial professional-domain vetoes
    const hasMedicalAffairsVeto = /\bmedical affairs\b/i.test(tLower);
    const hasClinicalVeto = /\bclinical\b/i.test(tLower) && !/marketing|growth|commercial/i.test(tLower);
    const hasBimVeto = /\bbim\b/i.test(tLower);
    const hasCivilStructuralVeto = /(\bcivil\b|\bstructural\b)/i.test(tLower) && !/marketing|growth|commercial/i.test(tLower);
    const hasQualityVeto = /\bquality\b/i.test(tLower) && !/marketing|growth|commercial/i.test(tLower);
    const hasRecruitmentStaffingVeto = /(\brecruitment\b|\bstaffing\b)/i.test(tLower) || 
                                       ((/managing director/i.test(tLower) || /director/i.test(tLower)) && (/antal|staffing|recruitment/i.test(textLower)));
    const hasSoftwareVeto = /(\bsoftware engineer\b|\bfull stack\b|\bfrontend\b|\bbackend\b)/i.test(tLower);
    const hasIndustrialResinVeto = /(\bresin\b|\bpolymer\b)/i.test(tLower) && !/marketing|growth/i.test(tLower);
    const hasTelecomEngVeto = /\btelecom\b/i.test(tLower) && /(\bengineer\b|\bautomation\b)/i.test(tLower);
    const hasHeavyElectronicsVeto = /\bpower electronics\b/i.test(tLower) && !/marketing director|cmo/i.test(tLower);
    const hasDerivedDataVeto = /\bderived data\b/i.test(tLower);
    const hasDeliveryLeaderVeto = /\bdelivery (leader|lead)\b/i.test(tLower) && !/marketing|growth|commercial/i.test(tLower);
    const hasItcVeto = /\bitc\b/i.test(tLower) && !/marketing|growth/i.test(tLower);
    const hasPracticeLeadVeto = /\bpractice (lead|director|head)\b/i.test(tLower) && !/marketing|growth/i.test(tLower);
    const hasArchitectureVeto = /\barchitecture\b/i.test(tLower) && !/marketing|growth|commercial/i.test(tLower);

    const isNonCommercialDomain = 
      hasMedicalAffairsVeto ||
      hasClinicalVeto ||
      hasBimVeto ||
      hasCivilStructuralVeto ||
      hasQualityVeto ||
      hasRecruitmentStaffingVeto ||
      hasSoftwareVeto ||
      hasIndustrialResinVeto ||
      hasTelecomEngVeto ||
      hasHeavyElectronicsVeto ||
      hasDerivedDataVeto ||
      hasDeliveryLeaderVeto ||
      hasItcVeto ||
      hasPracticeLeadVeto ||
      hasArchitectureVeto;

    if (isNonCommercialDomain) {
      evidenceIds.push("ol_non_commercial_veto");
      return { value: "MANAGERIAL", evidenceIds, confidence: 0.95 };
    }

    // NAMED POLICY: Operating Level Calibration Policy
    // This policy formalizes the strategic-to-executive progression mapping:
    // 1. VP/SVP level titles represent highly strategic but non-ultimate P&L seats, mapping to "STRATEGIC".
    // 2. Ultimate enterprise-wide decision-makers (CMO, CGO, COO, CRO, Chief) map to "EXECUTIVE".
    // When a STRATEGIC candidate (e.g. VP level) is assessed against an EXECUTIVE job (e.g. CMO),
    // the engine resolves this as a "PROMOTION" opportunity, rewarding the upside while signaling humility.
    const isUltimateExec = tLower.includes("cmo") || tLower.includes("cgo") || tLower.includes("cro") || tLower.includes("coo") || tLower.includes("chief");
    const isVPLevel = tLower.includes("vp") || tLower.includes("vice president") || tLower.includes("svp");

    // 1. Title Seniority Prior Classification
    const isExecutiveTitle = isUltimateExec || isVPLevel || tLower.includes("country head") || tLower.includes("head of") || tLower.includes("head -") || tLower.includes("director");

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
      if (isVPLevel) {
        evidenceIds.push("ol_calibration_vp_strategic");
        return { value: "STRATEGIC", evidenceIds, confidence: 0.9 };
      }
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
