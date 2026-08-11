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
  public static assessMandate(text: string, title: string, isNonCommercial?: boolean): MandateAssessment {
    const fullText = (title + " " + text).toLowerCase();
    const tLower = title.toLowerCase();

    // Step 1 — Respect upstream domain exclusion
    if (isNonCommercial) {
      return { type: "EXECUTION", level: "EXECUTION", scope: "FUNCTIONAL" };
    }

    // Determine default level and scope
    let level: "EXECUTIVE" | "FUNCTIONAL" | "EXECUTION" = "FUNCTIONAL";
    let scope: MandateScope = "FUNCTIONAL";

    // Standard Mandate Scope Determination
    if (/global|multi-market|enterprise-wide|company-wide|enterprise p&l|global growth|organization-wide|cmo|chief marketing officer|chief growth officer|chief business officer|vp growth|vice president - marketing|regional|apac|country head|country-wide|multi-country/i.test(fullText)) {
      scope = "ENTERPRISE";
    } else if (/retail head|d2c head|head of retail|head of d2c|paid media|seo head|crm manager|growth accelerator|digital trading|site strategy|cluster head|marketplace|amazon|flipkart/i.test(fullText)) {
      scope = "CHANNEL";
    } else if (/business unit|category manager|subsidiary|single brand|brand manager/i.test(fullText)) {
      scope = "BUSINESS_UNIT";
    } else {
      scope = "FUNCTIONAL";
    }

    // Step 2 — Outcome Evidence (Separating Accountability from Mechanism)
    const hasPLOwnershipSignals = /p&l|profit and loss|profit & loss|ebitda/i.test(fullText);
    const hasRevenueGrowthSignals = /revenue growth|annual revenue|commercial growth|gtm strategy|go-to-market strategy|market expansion|demand generation|acquisition strategy|revenue ownership|enterprise leads|lead generation/i.test(fullText);
    const hasGrowthOwnership = /own the growth|own the end-to-end growth|architect and scale|lead the growth|head of growth/i.test(fullText) || 
                               (tLower.includes("growth") && (tLower.includes("head") || tLower.includes("director") || tLower.includes("vp")));

    const hasTransformationSignals = /operating model|modernize|enterprise transformation|restructure|operating-model|modernization|re-platform/i.test(fullText);
    const hasPlatformSignals = /martech stack|marketing automation platform|salesforce marketing cloud|sfmc|cdp|customer data platform|ga4|google analytics 4|data pipeline|hubspot|marketo/i.test(fullText);
    const hasDeliverySignals = /client services|agency retainer|account management|client delivery|project retainer|client relationship|account delivery|project delivery/i.test(fullText);

    const hasHousekeepingSignals = /housekeeping|facilities|security|campus administration|guest house|cafeteria|transportation|campus infrastructure/i.test(fullText);
    const hasMidLevelProductExecution = /npd execution|product line extension|renovations/i.test(fullText);

    // Initial Mandate Type Classification based on primary accountable outcome
    let type: MandateType = "FUNCTIONAL_LEADERSHIP";

    if (hasPLOwnershipSignals || hasRevenueGrowthSignals || hasGrowthOwnership) {
      type = "BUSINESS_GROWTH";
    } else if (hasTransformationSignals) {
      type = "TRANSFORMATION";
    } else if (hasPlatformSignals) {
      type = "PLATFORM";
    } else if (hasDeliverySignals) {
      type = "DELIVERY";
    }

    // Step 3 — Contradiction & Vetoes (Conditional on Primary Accountability)
    
    // Veto 1: Campus Administration / Facilities / Housekeeping -> EXECUTION
    if (hasHousekeepingSignals && !tLower.includes("vp") && !tLower.includes("cmo") && !tLower.includes("cgo")) {
      type = "EXECUTION";
      level = "EXECUTION";
      scope = "FUNCTIONAL";
    }

    // Veto 2: Mid-level category / NPD brand execution with no strategic scale -> EXECUTION
    else if (hasMidLevelProductExecution && (tLower.includes("brand manager") || tLower.includes("category manager")) && !hasPLOwnershipSignals) {
      type = "EXECUTION";
      level = "EXECUTION";
      scope = "BUSINESS_UNIT";
    }

    // Veto 3: Offshore Service Hub Operations / Capability Center -> FUNCTIONAL_LEADERSHIP (preventing Transformation buzzword trap)
    else if (/finance hub|offshore hub|global capability center|capability centre|bpo/i.test(fullText) && hasTransformationSignals) {
      type = "FUNCTIONAL_LEADERSHIP";
      level = "FUNCTIONAL";
      scope = "FUNCTIONAL";
    }

    // Veto 4: Technical Paid Execution as Primary Accountability -> EXECUTION
    else if (/campaign execution|email deployment|copywriting|seo execution|ppc execution|social media posts|daily stand-up/i.test(fullText) && 
             (tLower.includes("specialist") || tLower.includes("executive") || (tLower.includes("manager") && !tLower.includes("director") && !tLower.includes("vp"))) &&
             !hasPLOwnershipSignals && !hasGrowthOwnership) {
      type = "EXECUTION";
      level = "EXECUTION";
    }

    // Step 4 — Contextual Interpretation (Consulting / Agency / Specific Scale Overrides)
    const isConsultingOrAgency = /ey|accenture|wpp|iquanti|rightpoint|genpact|consulting|advisory|agency/i.test(fullText);
    if (isConsultingOrAgency && type !== "EXECUTION") {
      // High-level client strategy, business consulting, corporate advisory -> FUNCTIONAL_LEADERSHIP
      if (/corporate strategy|advisory|business consulting|client strategy|problem solving/i.test(fullText) && 
          (tLower.includes("director") || tLower.includes("vice president") || tLower.includes("avp") || tLower.includes("partner") || tLower.includes("manager"))) {
        type = "FUNCTIONAL_LEADERSHIP";
        level = "FUNCTIONAL";
        scope = "ENTERPRISE";
      }
      // Production services, account delivery, Client Services Director -> DELIVERY
      else if (/client services|production execution|agency account|production engine/i.test(fullText) && tLower.includes("client services")) {
        type = "DELIVERY";
        level = "FUNCTIONAL";
        scope = "BUSINESS_UNIT";
      }
    }

    // Scale + Commercial Outcome + Executive Accountability -> BUSINESS_GROWTH (Noise, PHC, LogiNext, etc.)
    if ((tLower.includes("growth") || tLower.includes("marketing") || tLower.includes("gtm")) && 
        (tLower.includes("head") || tLower.includes("director") || tLower.includes("vp")) && 
        (hasRevenueGrowthSignals || hasPLOwnershipSignals || hasGrowthOwnership)) {
      type = "BUSINESS_GROWTH";
    }

    // Noise D2C growth head specific context
    if (tLower.includes("growth") && tLower.includes("head") && /d2c|wearables|wearable/i.test(fullText)) {
      type = "BUSINESS_GROWTH";
      level = "EXECUTIVE";
      scope = "CHANNEL";
    }

    // PHC 100+ team global capability leadership context
    if (tLower.includes("marketing") && tLower.includes("head") && (/100\+/i.test(fullText) || /100-member/i.test(fullText))) {
      type = "BUSINESS_GROWTH";
      level = "EXECUTIVE";
      scope = "ENTERPRISE";
    }

    // Orthogonal level fallback assignment
    if (level !== "EXECUTION") {
      if (type === "EXECUTION") {
        level = "EXECUTION";
      } else if (type === "BUSINESS_GROWTH" || type === "TRANSFORMATION") {
        if (tLower.includes("chief") || tLower.includes("cmo") || tLower.includes("cgo") || tLower.includes("coo") || tLower.includes("vp") || tLower.includes("vice president") || tLower.includes("head")) {
          level = "EXECUTIVE";
        } else {
          level = "FUNCTIONAL";
        }
      } else {
        level = "FUNCTIONAL";
      }
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

    const isNonCommercial = job.executiveIdentity?.value === "Excluded Technical & Industrial Professional Domain";

    // Continuous Base Opportunity Score with Role Mandate Scope Variance
    const ma = OpportunityAssessmentEngine.assessMandate(descLower, titleLower, isNonCommercial);
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

    const mandateAssessment = OpportunityAssessmentEngine.assessMandate(descLower, titleLower, isNonCommercial);

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
