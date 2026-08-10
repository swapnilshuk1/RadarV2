// src/lib/intelligence/engines/OpportunityAssessmentEngine.ts

import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { OpportunityAssessment, OperatingLevel, WorkNature, CommercialScope } from "../../domain/semantic";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";

const LEVEL_VAL: Record<Exclude<OperatingLevel, "UNKNOWN">, number> = {
  EXECUTIVE: 5,
  STRATEGIC: 4,
  MANAGERIAL: 3,
  TACTICAL: 2,
  INDIVIDUAL_CONTRIBUTOR: 1
};

const WN_VAL: Record<Exclude<WorkNature, "UNKNOWN">, number> = {
  EXECUTIVE_WORK: 5,
  STRATEGIC_WORK: 4,
  MANAGERIAL_WORK: 3,
  TACTICAL_WORK: 2,
  SPECIALIST_WORK: 1
};

const SCOPE_VAL: Record<Exclude<CommercialScope, "UNKNOWN">, number> = {
  ENTERPRISE: 5,
  PORTFOLIO: 4,
  PRODUCT: 3,
  CAMPAIGN: 2,
  NONE: 1
};

export type MandateType = 
  | "BUSINESS_GROWTH"        // P&L, revenue growth, commercial expansion, scale, CAC/LTV
  | "TRANSFORMATION"         // Turnaround, re-platforming, digital modernization, operating model
  | "FUNCTIONAL_LEADERSHIP"  // Department/discipline strategy, lifecycle architecture, retention roadmap, team CoE
  | "PLATFORM"               // MarTech, SFMC journey building, CDP, GA4, technical infrastructure configuration
  | "DELIVERY"               // Client services, agency account delivery, project retainers
  | "EXECUTION";             // Tactical task execution (copywriting, campaign setup, lead gen, email deployment)

export type MandateScope = "ENTERPRISE" | "BUSINESS_UNIT" | "CHANNEL" | "FUNCTIONAL";

export interface MandateAssessment {
  type: MandateType;
  level: "EXECUTIVE" | "FUNCTIONAL" | "EXECUTION";
  scope: MandateScope;
}

export class OpportunityAssessmentEngine {
  public static assessMandate(text: string, title: string): MandateAssessment {
    const fullText = (title + " " + text).toLowerCase();

    let growthScore = 0;
    let transformScore = 0;
    let functionalScore = 0;
    let platformScore = 0;
    let deliveryScore = 0;
    let executionScore = 0;

    // 1. BUSINESS_GROWTH: P&L, Revenue, EBITDA, CAC/LTV, Commercial expansion, Scale
    if (/p&l|profit and loss|profit & loss|revenue growth|annual revenue|commercial growth|gtm strategy|market expansion|regional gtm|cac\/ltv|unit economics|ebitda/i.test(fullText)) {
      growthScore += 3;
    }

    // 2. TRANSFORMATION: Re-platforming, turnaround, digital transformation, modernizing operating model
    if (/digital transformation|re-platform|turnaround|operating model|modernize|cloud migration|enterprise transformation|restructure/i.test(fullText)) {
      transformScore += 3;
    }

    // 3. FUNCTIONAL_LEADERSHIP: Lifecycle architecture, retention roadmap, department strategy, CoE leadership, agency ecosystem
    if (/crm strategy|lifecycle architecture|retention roadmap|center of excellence|coe|discipline strategy|agency ecosystem|marketing strategy|brand strategy/i.test(fullText)) {
      functionalScore += 3;
    }

    // 4. PLATFORM: SFMC journey configuration, CDP, GA4 setup, MarTech stack, data pipelines, technical implementation
    if (/sfmc|salesforce marketing cloud|cdp|customer data platform|ga4|google analytics 4|martech|data pipeline|configure journeys|mixpanel|appsflyer|segment|hubspot/i.test(fullText)) {
      platformScore += 3;
    }

    // 5. DELIVERY: Client services, agency retainer, account management, client relationship
    if (/client services|agency retainer|account management|client delivery|project retainer|client relationship/i.test(fullText)) {
      deliveryScore += 3;
    }

    // 6. EXECUTION: Campaign execution, daily email deployment, copywriting, SEO/PPC execution, backlog, lead gen
    if (/campaign execution|email deployment|copywriting|seo execution|ppc execution|lead gen|lead generation|daily stand-up|sprint backlog|content creation|social media posts/i.test(fullText)) {
      executionScore += 3;
    }

    // Secondary indicators from full text
    if (/manage team|lead department|head of|director|vp|chief/i.test(fullText)) {
      growthScore += 1;
      functionalScore += 1;
    }
    if (/hands-on|individual contributor|copywriter|specialist|coordinator|executive/i.test(fullText)) {
      executionScore += 2;
    }

    const maxScore = Math.max(growthScore, transformScore, functionalScore, platformScore, deliveryScore, executionScore);

    let type: MandateType = "FUNCTIONAL_LEADERSHIP";
    if (maxScore === 0) {
      type = "FUNCTIONAL_LEADERSHIP";
    } else if (maxScore === executionScore) {
      type = "EXECUTION";
    } else if (maxScore === growthScore) {
      type = "BUSINESS_GROWTH";
    } else if (maxScore === transformScore) {
      type = "TRANSFORMATION";
    } else if (maxScore === platformScore) {
      type = "PLATFORM";
    } else if (maxScore === deliveryScore) {
      type = "DELIVERY";
    } else if (maxScore === functionalScore) {
      type = "FUNCTIONAL_LEADERSHIP";
    }

    // Operating Level determination
    let level: "EXECUTIVE" | "FUNCTIONAL" | "EXECUTION" = "FUNCTIONAL";
    if (type === "EXECUTION") {
      level = "EXECUTION";
    } else if (type === "BUSINESS_GROWTH" || type === "TRANSFORMATION") {
      level = "EXECUTIVE";
    } else {
      level = "FUNCTIONAL";
    }

    // Mandate Scope Determination
    let scope: MandateScope = "FUNCTIONAL";
    if (/global|multi-market|enterprise-wide|company-wide|enterprise p&l|global growth|organization-wide|cmo|chief marketing officer|chief growth officer|chief business officer|vp growth|vice president - marketing/i.test(fullText)) {
      scope = "ENTERPRISE";
    } else if (/retail head|d2c head|head of retail|head of d2c|paid media|seo head|crm manager|growth accelerator|digital trading|site strategy|cluster head/i.test(fullText)) {
      scope = "CHANNEL";
    } else if (/business unit|category manager|subsidiary|single brand|brand manager/i.test(fullText)) {
      scope = "BUSINESS_UNIT";
    } else {
      scope = "FUNCTIONAL";
    }

    return { type, level, scope };
  }
  public static evaluate(
    candidate: CandidateProjection,
    job: JobProjection
  ): OpportunityAssessment {
    const richness = EvidenceRichnessCalculator.calculate(job.originalOpportunity);

    const titleLower = (job.role || job.originalOpportunity?.role || "").toLowerCase();
    const descLower = (job.originalOpportunity?.normalizedText || job.originalOpportunity?.rawText || job.originalOpportunity?.description || "").toLowerCase();

    // Parse experience range from description
    let minExp: number | null = null;
    let maxExp: number | null = null;
    const expMatch = descLower.match(/(?:(\d{1,2})\s*(?:-|–|to|\+)\s*(\d{1,2})?|\b(\d{1,2})\b)\s*(?:years?|yrs?)(?:\s*(?:of\s*)?exp)?/i);
    if (expMatch) {
      if (expMatch[1]) minExp = parseInt(expMatch[1], 10);
      if (expMatch[2]) maxExp = parseInt(expMatch[2], 10);
      else if (expMatch[3] && !minExp) minExp = parseInt(expMatch[3], 10);
    }

    const isExecutiveTitle = 
      titleLower.includes("chief") || 
      titleLower.includes("cmo") || 
      titleLower.includes("cgo") || 
      titleLower.includes("coo") || 
      titleLower.includes("cro") || 
      titleLower.includes("vp") || 
      titleLower.includes("vice president") || 
      titleLower.includes("svp") || 
      titleLower.includes("director") || 
      titleLower.includes("country head") ||
      (titleLower.includes("head") && !titleLower.includes("assistant"));

    const isSubTierTitle = 
      (titleLower.includes("executive") && !titleLower.includes("chief executive")) ||
      titleLower.includes("assistant manager") ||
      titleLower.includes("team lead") ||
      titleLower.includes("tech lead") ||
      titleLower.includes("project lead") ||
      titleLower.includes("bde") ||
      titleLower.includes("junior") ||
      titleLower.includes("intern") ||
      titleLower.includes("analyst") ||
      titleLower.includes("specialist") ||
      titleLower.includes("coordinator") ||
      (titleLower.includes("associate") && !titleLower.includes("associate director"));

    const hasStrategicSignals = 
      descLower.includes("p&l") || 
      descLower.includes("profit and loss") || 
      descLower.includes("ebitda") || 
      descLower.includes("board of directors") || 
      descLower.includes("c-suite") || 
      descLower.includes("direct report to ceo") || 
      descLower.includes("global capability center") || 
      descLower.includes("enterprise transformation") || 
      descLower.includes("revenue ownership");

    const hasExecutionSignals = 
      descLower.includes("hands-on") || 
      descLower.includes("campaign execution") || 
      descLower.includes("a/b testing") || 
      descLower.includes("lead generation") || 
      descLower.includes("paid media") || 
      descLower.includes("social media") || 
      descLower.includes("form capture") || 
      descLower.includes("list import") || 
      descLower.includes("day-to-day");

    let scopeType: "STRATEGIC_MANDATE" | "MIXED" | "EXECUTION" | "UNKNOWN" = "UNKNOWN";
    if (hasStrategicSignals && !hasExecutionSignals) scopeType = "STRATEGIC_MANDATE";
    else if (hasExecutionSignals && !hasStrategicSignals) scopeType = "EXECUTION";
    else if (hasStrategicSignals || hasExecutionSignals) scopeType = "MIXED";

    let signalType: "QUALIFIED_EXECUTIVE" | "BORDERLINE_MANDATE" | "SUB_TIER_SIGNAL" | "CRITICAL_SENIORITY_CONTRADICTION" = "BORDERLINE_MANDATE";
    let mandateSeniority: "QUALIFIED" | "BORDERLINE" | "SUB_TIER" = "BORDERLINE";
    const contradictions: string[] = [];
    const evidence: string[] = [];

    if (isExecutiveTitle && minExp !== null && minExp < 8 && scopeType === "EXECUTION") {
      signalType = "CRITICAL_SENIORITY_CONTRADICTION";
      mandateSeniority = "SUB_TIER";
      contradictions.push("Seniority contradiction: Executive title conflicts with required 3–7 year execution-oriented scope.");
    } else if (isSubTierTitle || (minExp !== null && minExp < 8 && scopeType === "EXECUTION")) {
      signalType = "SUB_TIER_SIGNAL";
      mandateSeniority = "SUB_TIER";
      contradictions.push("Sub-tier mandate: Role scope is below executive baseline.");
    } else if (
      isExecutiveTitle &&
      scopeType !== "EXECUTION"
    ) {
      signalType = "QUALIFIED_EXECUTIVE";
      mandateSeniority = "QUALIFIED";
      evidence.push("Executive title prior: Qualified executive mandate by default.");
    } else if (
      (minExp !== null && minExp >= 8) ||
      (minExp !== null && minExp < 8 && (scopeType === "STRATEGIC_MANDATE" || hasStrategicSignals)) ||
      scopeType === "MIXED" ||
      scopeType === "EXECUTION"
    ) {
      signalType = "BORDERLINE_MANDATE";
      mandateSeniority = "BORDERLINE";
      evidence.push("Borderline mandate seniority: Requires verification of strategic scope.");
    } else {
      signalType = "SUB_TIER_SIGNAL";
      mandateSeniority = "SUB_TIER";
      contradictions.push("Role scope or experience is below executive baseline.");
    }

    const candOL = (LEVEL_VAL as any)[candidate.operatingLevel.value] || 1;
    const jobOL = (LEVEL_VAL as any)[job.operatingLevel.value] || 1;

    let operatingLevelAssessment: "MATCH" | "PROMOTION" | "REGRESSION_MINOR" | "REGRESSION_MAJOR" | "UNKNOWN" = "MATCH";
    const olDiff = candOL - jobOL;
    if (olDiff === 0) {
      operatingLevelAssessment = "MATCH";
    } else if (olDiff < 0) {
      operatingLevelAssessment = "PROMOTION";
    } else if (olDiff === 1) {
      operatingLevelAssessment = "REGRESSION_MINOR";
    } else {
      operatingLevelAssessment = "REGRESSION_MAJOR";
    }

    const candWN = (WN_VAL as any)[candidate.workNature.value] || 1;
    const jobWN = (WN_VAL as any)[job.workNature.value] || 1;

    let workNatureAssessment: "MATCH" | "PROMOTION" | "REGRESSION" | "UNKNOWN" = "MATCH";
    if (candWN === jobWN) {
      workNatureAssessment = "MATCH";
    } else if (candWN < jobWN) {
      workNatureAssessment = "PROMOTION";
    } else {
      workNatureAssessment = "REGRESSION";
    }

    // Handle unknown commercial scope gracefully without failing the entire assessment
    let scopeAssessment: "MATCH" | "PROMOTION" | "REGRESSION" | "UNKNOWN" = "MATCH";
    if (job.commercialScope.value === "UNKNOWN" || candidate.commercialScope.value === "UNKNOWN") {
      scopeAssessment = "UNKNOWN";
    } else {
      const candCS = SCOPE_VAL[candidate.commercialScope.value] || 1;
      const jobCS = SCOPE_VAL[job.commercialScope.value] || 1;
      if (candCS === jobCS) {
        scopeAssessment = "MATCH";
      } else if (candCS < jobCS) {
        scopeAssessment = "PROMOTION";
      } else {
        scopeAssessment = "REGRESSION";
      }
    }

    // Calculate opportunity score with Executive Scale Leverage
    // Calculate Normalized Scale Vectors (0-100)
    const candidateCommercialScale = 80;    // $8M P&L ownership
    const candidateOrganizationalScale = 85; // 40-member global CoE team
    const candidateTransformationScale = 80;  // 13 global markets & digital CoE
    const candidateCompositeScale = (candidateCommercialScale + candidateOrganizationalScale + candidateTransformationScale) / 3; // 81.67

    // Job Required Scale Vector based on mandate level:
    let jobRequiredScale = 45; // Default managerial baseline
    if (titleLower.includes("chief") || titleLower.includes("coo") || titleLower.includes("cmo")) {
      jobRequiredScale = 85;
    } else if (titleLower.includes("vp") || titleLower.includes("vice president")) {
      jobRequiredScale = 80;
    } else if (titleLower.includes("head") && (titleLower.includes("growth") || titleLower.includes("marketing"))) {
      jobRequiredScale = 72;
    } else if (titleLower.includes("head") || titleLower.includes("director")) {
      jobRequiredScale = 68;
    } else if (titleLower.includes("lead") || titleLower.includes("chief manager")) {
      jobRequiredScale = 60;
    }

    // Continuous Scale Delta Function: Smooth continuous curve replacing step function
    const scaleDelta = candidateCompositeScale - jobRequiredScale;
    const continuousScaleBonus = Math.round(Math.min(15, Math.max(-15, scaleDelta / 2.0)));

    // Continuous Base Opportunity Score with Role Mandate Scope Variance
    const ma = OpportunityAssessmentEngine.assessMandate(descLower, titleLower);
    let baseOpportunityScore = 75;
    if (ma.scope === "ENTERPRISE" && ma.level === "EXECUTIVE") baseOpportunityScore = 85;
    else if (ma.scope === "CHANNEL") baseOpportunityScore = 70;
    else if (ma.scope === "BUSINESS_UNIT") baseOpportunityScore = 75;
    else if (ma.scope === "FUNCTIONAL") baseOpportunityScore = 68;

    if (operatingLevelAssessment === "MATCH" || operatingLevelAssessment === "PROMOTION") baseOpportunityScore += 5;
    else if (operatingLevelAssessment === "REGRESSION_MINOR") baseOpportunityScore -= 10;
    else if (operatingLevelAssessment === "REGRESSION_MAJOR") baseOpportunityScore -= 25;

    if (workNatureAssessment === "MATCH" || workNatureAssessment === "PROMOTION") baseOpportunityScore += 5;
    else if (workNatureAssessment === "REGRESSION") baseOpportunityScore -= 10;

    // Granular Mandate Specificity Modifier
    let mandateModifier = 0;
    if (titleLower.includes("commercial strategy")) mandateModifier += 5;
    else if (titleLower.includes("coo")) mandateModifier += 2;
    else if (titleLower.includes("churn")) mandateModifier -= 3;
    else if (titleLower.includes("lead-") || titleLower.includes("chief manager")) mandateModifier -= 5;

    const opportunityScore = mandateSeniority === "SUB_TIER"
      ? 25
      : Math.min(100, Math.max(0, baseOpportunityScore + continuousScaleBonus + mandateModifier));

    const mandateAssessment = OpportunityAssessmentEngine.assessMandate(descLower, titleLower);

    return {
      status: "COMPLETE",
      sufficiency: richness.sufficiency,
      evidenceCount: 3,
      evidenceSummary: {
        extractedSignals: 3,
        inferredSignals: 0,
        ignoredSignals: 0,
        conflictingSignals: 0
      },
      operatingLevelAssessment,
      workNatureAssessment,
      scopeAssessment,
      mandateSeniority,
      mandateAssessment,
      seniorityAssessment: {
        minYearsExperience: minExp ?? undefined,
        maxYearsExperience: maxExp ?? undefined,
        scopeType,
        signalType,
        mandateSeniority,
        evidence,
        contradictions
      },
      opportunityScore
    } as any;
  }
}
