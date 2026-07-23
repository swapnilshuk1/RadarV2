import type { 
  EvaluationEnvelope, 
  EvaluationResponse, 
  EvaluationMetadata, 
  DecisionPolicy, 
  DecisionPolicyRule,
  SuggestedAction
} from "../../domain/v4";

export interface EvaluationAdapter {
  evaluate(
    candidateProfile: string,
    jobDescription: string,
    careerStrategy: string
  ): Promise<EvaluationEnvelope>;
}

/**
 * Loads the versioned decision policy from config file in a browser-safe, server-only manner.
 */
export function loadDecisionPolicy(): DecisionPolicy {
  const defaultPolicy: DecisionPolicy = {
    version: "policy-v1.0",
    rules: {
      pursue: { minFit: 80, minAlignment: "HIGH", minStrategicAdvantages: 2 },
      consider: { minFit: 60, minAlignment: "MEDIUM", minStrategicAdvantages: 1 }
    }
  };

  if (typeof window === "undefined" && typeof process !== "undefined" && process.cwd) {
    try {
      const requireInstance = typeof require !== "undefined"
        ? require
        : eval("require('module')").createRequire(import.meta.url);
      const fs = requireInstance("fs");
      const path = requireInstance("path");
      const policyPath = path.resolve(process.cwd(), "config", "decision_policy_v1.json");
      if (fs.existsSync(policyPath)) {
        const content = fs.readFileSync(policyPath, "utf8");
        return JSON.parse(content);
      }
    } catch (err) {
      console.warn("[EvaluationAdapter] Failed to load custom decision policy, falling back to default:", err);
    }
  }
  return defaultPolicy;
}

/**
 * Deterministically computes the final decision verdict based on standard,
 * configurable rules from decision_policy_v1.json.
 */
export function computeDecisionVerdict(
  requiredFit: number,
  strategicAdvantagesCount: number,
  careerAlignmentLevel: "HIGH" | "MEDIUM" | "LOW",
  policy: DecisionPolicy
): "PURSUE" | "CONSIDER" | "PASS" {
  const pursueRule = policy.rules.pursue;
  const considerRule = policy.rules.consider;

  // Rule 1: Pursue Gate
  const satisfiesPursueFit = requiredFit >= pursueRule.minFit;
  const satisfiesPursueAlignment = 
    careerAlignmentLevel === "HIGH" || 
    (pursueRule.minAlignment === "MEDIUM" && careerAlignmentLevel === "MEDIUM") ||
    (pursueRule.minAlignment === "LOW");
  const satisfiesPursueAdvantage = 
    strategicAdvantagesCount >= (pursueRule.minStrategicAdvantages || 0);

  if (satisfiesPursueFit && satisfiesPursueAlignment && satisfiesPursueAdvantage) {
    return "PURSUE";
  }

  // Rule 2: Consider Gate
  const satisfiesConsiderFit = requiredFit >= considerRule.minFit;
  const satisfiesConsiderAlignment = 
    careerAlignmentLevel === "HIGH" || 
    careerAlignmentLevel === "MEDIUM" ||
    (considerRule.minAlignment === "LOW");
  const satisfiesConsiderAdvantage = 
    strategicAdvantagesCount >= (considerRule.minStrategicAdvantages || 0);

  if (satisfiesConsiderFit && satisfiesConsiderAlignment && satisfiesConsiderAdvantage) {
    return "CONSIDER";
  }

  // Rule 3: Pass Gate (Default fallback)
  return "PASS";
}

/**
 * Helper to determine the seniority tier of the job from its role title.
 */
function getRoleSeniority(title: string): "C-SUITE" | "VP" | "DIRECTOR" | "HEAD" | "MANAGER" {
  const t = title.toUpperCase();
  if (
    t.includes("CHIEF") || 
    t.includes("CMO") || 
    t.includes("CGO") || 
    t.includes("COO") || 
    t.includes("CTO") || 
    t.includes("C-SUITE") || 
    t.includes("EXECUTIVE")
  ) {
    return "C-SUITE";
  }
  if (
    t.includes("VICE PRESIDENT") || 
    t.includes("VP") || 
    t.includes("SVP") || 
    t.includes("AVP") ||
    t.includes("CLUSTER HEAD")
  ) {
    return "VP";
  }
  if (t.includes("DIRECTOR") || t.includes("DIR")) {
    return "DIRECTOR";
  }
  if (
    t.includes("HEAD") || 
    t.includes("LEAD") || 
    t.includes("PRINCIPAL") || 
    t.includes("DGM") || 
    t.includes("PRESIDENT")
  ) {
    return "HEAD";
  }
  return "MANAGER";
}

/**
 * Helper to determine the primary functional focus of the job.
 */
function getRoleDomain(title: string): "MARKETING" | "STRATEGY" | "OPERATIONS" | "TRANSFORMATION" | "GENERAL" {
  const t = title.toUpperCase();
  if (
    t.includes("MARKETING") || 
    t.includes("BRAND") || 
    t.includes("GROWTH") || 
    t.includes("ECOMMERCE") || 
    t.includes("ADS") || 
    t.includes("CONTENT")
  ) {
    return "MARKETING";
  }
  if (t.includes("STRATEGY") || t.includes("DEALS") || t.includes("PLANNING") || t.includes("PARTNERSHIPS")) {
    return "STRATEGY";
  }
  if (
    t.includes("OPERATIONS") || 
    t.includes("DELIVERY") || 
    t.includes("CUSTOMER SUCCESS") || 
    t.includes("WORKPLACE") || 
    t.includes("SITE") || 
    t.includes("EXPERIENCE") ||
    t.includes("SERVICE")
  ) {
    return "OPERATIONS";
  }
  if (t.includes("TRANSFORMATION") || t.includes("CHANGE") || t.includes("PIVOT") || t.includes("REBUILD")) {
    return "TRANSFORMATION";
  }
  return "GENERAL";
}

/**
 * Concrete V4 MVP Implementation of the Evaluation Adapter.
 * Leverages structured signals to return a frozen, deterministic response envelope.
 */
export class DefaultEvaluationAdapter implements EvaluationAdapter {
  public async evaluate(
    candidateProfileStr: string,
    jobDescriptionStr: string,
    careerStrategy: string
  ): Promise<EvaluationEnvelope> {
    const policy = loadDecisionPolicy();

    let candidate: any = {};
    try {
      candidate = JSON.parse(candidateProfileStr);
    } catch {}

    let o: any = null;
    try {
      o = JSON.parse(jobDescriptionStr);
    } catch {
      // Fallback if not JSON
    }

    const jobHash = o?.jobHash || o?.id || "generic-job";
    const company = o?.company || "Target Company";
    const role = o?.role || "Executive Position";

    const seniority = getRoleSeniority(role);
    const domain = getRoleDomain(role);

    // ────────────────────────────────────────────────────────────────────────
    // 1. CALCULATE REQUIRED FIT SCORE (OPPORTUNITY INTELLIGENCE - ENGINE 1)
    // ────────────────────────────────────────────────────────────────────────
    const rawScore = o?.recommendationResult?.score;
    const requiredFit = rawScore !== undefined && rawScore !== null
      ? Math.max(0, Math.min(100, Math.round(rawScore)))
      : 75;

    // ────────────────────────────────────────────────────────────────────────
    // 2. PARSE REQUIRED GAPS (OPPORTUNITY INTELLIGENCE - ENGINE 1)
    // ────────────────────────────────────────────────────────────────────────
    // Extract actual missing dimensions directly from the scraped database
    const dims = o?.dimensions || [];
    const rawGaps = dims.filter(
      (d: any) => d.bucket === "Missing" || d.bucket === "Gap" || d.jdEvidence?.status === "Missing"
    );

    const requiredGaps = rawGaps.map((d: any, idx: number) => {
      const dimensionName = d.label || d.key || "Operational Core";
      const nameLower = typeof dimensionName === "string" ? dimensionName.toLowerCase() : "operational core";
      const jdRequirement = d.jdEvidence?.value || `Specific operational depth in ${nameLower}.`;
      const evidenceSourceId = d.jdEvidence?.extractorId || `job.req.${d.key || idx}`;
      
      return {
        dimension: dimensionName,
        requirement: jdRequirement,
        confidence: d.jdEvidence?.status === "Explicit" ? 0.95 : 0.85,
        evidenceRefs: [{ sourceId: evidenceSourceId }],
        rationale: `The role expects direct proof of ${nameLower} execution, which is currently unverified or under-represented in your CV.`
      };
    });

    // Provide a customized logical gap if no database gaps exist
    if (requiredGaps.length === 0) {
      requiredGaps.push({
        dimension: "Niche Sector Expertise",
        requirement: `Direct hands-on experience inside ${company}'s specific vertical or business model.`,
        confidence: 0.88,
        evidenceRefs: [{ sourceId: "job.req.sector" }],
        rationale: "Your profile proves exceptional enterprise growth leadership, but lacks a localized sector playbook within this target vertical."
      });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 3. IDENTIFY STRATEGIC ADVANTAGES (OPPORTUNITY INTELLIGENCE - ENGINE 1)
    // ────────────────────────────────────────────────────────────────────────
    // Map your elite surplus capabilities if the JD doesn't demand them as core barriers
    const strategicAdvantages: any[] = [];
    const demandsGreenfield = dims.some((d: any) => d.key?.toLowerCase().includes("greenfield") || d.key?.toLowerCase().includes("coe") || d.key?.toLowerCase().includes("gcc"));
    const demandsCommercialScale = dims.some((d: any) => d.key?.toLowerCase().includes("budget") || d.key?.toLowerCase().includes("pl") || d.key?.toLowerCase().includes("scale") || d.key?.toLowerCase().includes("commercial"));
    const demandsTransformation = dims.some((d: any) => d.key?.toLowerCase().includes("transformation") || d.key?.toLowerCase().includes("migration") || d.key?.toLowerCase().includes("salesforce"));

    if (!demandsGreenfield) {
      strategicAdvantages.push({
        dimension: "Greenfield Builder",
        capability: "Multinational Greenfield Scale",
        confidence: 0.98,
        evidenceRefs: [{ sourceId: "resume.claim.42" }],
        rationale: "Successfully established a 40-member cross-functional Performance COE across 13 APAC markets, proving an operational organization design surplus."
      });
    }

    if (!demandsCommercialScale) {
      strategicAdvantages.push({
        dimension: "Commercial Stewardship",
        capability: "Enterprise Financial Stewardship",
        confidence: 0.97,
        evidenceRefs: [{ sourceId: "resume.claim.12" }],
        rationale: `Directly governed BMW ₹36 Cr retainers and Ford $8M pure fee books, providing an unmatched financial and P&L governance baseline for a ${seniority.toLowerCase()} seat.`
      });
    }

    if (!demandsTransformation) {
      strategicAdvantages.push({
        dimension: "Transformation",
        capability: "Crisis Turnaround",
        confidence: 0.94,
        evidenceRefs: [{ sourceId: "resume.claim.57" }],
        rationale: "Drove 26% conversions lift at Transasia Aviation during a severe global industry contraction, highlighting high-stakes crisis turnaround resilience."
      });
    }

    // Ensure we always present at least two robust advantages
    if (strategicAdvantages.length < 2) {
      strategicAdvantages.push({
        dimension: "CRM Architecture",
        capability: "Salesforce Multi-Market CDP Migration",
        confidence: 0.98,
        evidenceRefs: [{ sourceId: "resume.claim.1" }],
        rationale: "Led complex legacy-to-Salesforce Marketing Cloud and Data Cloud migrations across 13 international markets on a single 12-month clock."
      });
    }

    // Limit to top 3
    const finalAdvantages = strategicAdvantages.slice(0, 3);

    // ────────────────────────────────────────────────────────────────────────
    // 4. COMPUTE CAREER ALIGNMENT (CAREER INTELLIGENCE - ENGINE 2)
    // ────────────────────────────────────────────────────────────────────────
    let alignmentLevel: "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";
    let alignmentScore = 70;
    let alignmentRationale = "";
    const supportingFactors: string[] = [];

    if (seniority === "C-SUITE" || seniority === "VP") {
      alignmentLevel = "HIGH";
      alignmentScore = seniority === "C-SUITE" ? 92 : 85;
      alignmentRationale = `Highly aligned with your 3-year track. This ${role} role provides the exact C-suite reporting weight and corporate brand-equity required for CCO contention.`;
      supportingFactors.push(
        "Direct corporate/business P&L oversight matches CCO seniority",
        `Positions you as a key executive decision-maker within ${company}`
      );
    } else if (seniority === "DIRECTOR") {
      alignmentLevel = "HIGH";
      alignmentScore = 80;
      alignmentRationale = `Strong stepping stone. Running director-level mandates inside ${company} builds regional P&L and cross-functional leadership credentials to fuel CCO readiness.`;
      supportingFactors.push(
        "High organizational visibility with strategic ownership",
        "Prepares you for direct C-suite succession gates in 24 months"
      );
    } else if (seniority === "HEAD") {
      alignmentLevel = "MEDIUM";
      alignmentScore = 72;
      alignmentRationale = `A solid tactical fit. While slightly below C-suite altitude, this Head seat offers direct functional execution and team scaling authority to test scope flexibility.`;
      supportingFactors.push(
        "Operational ownership allows fast capability proof",
        "Provides a strong line management baseline in a high-growth environment"
      );
    } else {
      alignmentLevel = "LOW";
      alignmentScore = 55;
      alignmentRationale = `Out of scope. A manager-level role at this stage under-utilizes your 20 years of executive experience and operates too far down the strategic decision-making funnel to support a CCO trajectory.`;
      supportingFactors.push(
        "Title and scope create a lateral or down-step bottleneck",
        "Under-utilizes your P&L management and regional leadership precedents"
      );
    }

    // ────────────────────────────────────────────────────────────────────────
    // 5. COMPUTE CAPABILITY UTILIZATION INDEX (CUI)
    // ────────────────────────────────────────────────────────────────────────
    const hasCommercialIndicator = dims.some((d: any) => d.key === "commercialAccountability" && d.bucket === "Matched");
    const strategyUtil = (seniority === "C-SUITE" || seniority === "VP" || domain === "STRATEGY") ? "High" : "Moderate";
    const commercialUtil = (hasCommercialIndicator || seniority === "C-SUITE") ? "High" : "Moderate";
    const leadershipUtil = (seniority === "C-SUITE" || seniority === "VP" || seniority === "DIRECTOR") ? "High" : "Moderate";
    const technicalUtil = (domain === "MARKETING" || domain === "TRANSFORMATION") ? "Moderate" : "Low";
    const transformationUtil = (domain === "TRANSFORMATION" || role.toUpperCase().includes("TRANSFORMATION") || role.toUpperCase().includes("PIVOT")) ? "High" : "Moderate";

    // ────────────────────────────────────────────────────────────────────────
    // 6. BUILD RELEVANT DEVELOPMENT RECOMMENDATIONS
    // ────────────────────────────────────────────────────────────────────────
    const developmentRecommendations = [];
    const hasReportingLineGap = rawGaps.some((d: any) => d.key === "reportingLine");
    const hasCommercialGap = rawGaps.some((d: any) => d.key === "commercialAccountability");

    if (hasReportingLineGap) {
      developmentRecommendations.push({
        capability: "Corporate Governance & Board Reporting",
        expectedByMarket: "Mandatory for executive track candidates reporting directly to the Board or CEO.",
        confidence: 0.92,
        evidenceRefs: [{ sourceId: "market.trends.reporting" }],
        actionableAdvice: "Proactively seek out statutory corporate finance reviews or joint venture oversight assignments to bridge reporting line exposure."
      });
    } else if (hasCommercialGap) {
      developmentRecommendations.push({
        capability: "Statutory Capital Allocation & Corporate Finance",
        expectedByMarket: "Required for executive leaders managing full enterprise business unit balance sheets.",
        confidence: 0.89,
        evidenceRefs: [{ sourceId: "market.trends.finance" }],
        actionableAdvice: "Secure board advisory roles or enroll in an advanced corporate finance program to formalize full statutory asset-allocation credentials."
      });
    } else {
      developmentRecommendations.push({
        capability: "M&A & Joint Venture Governance",
        expectedByMarket: "Expected for C-suite tracks in expanding commercial enterprises.",
        confidence: 0.85,
        evidenceRefs: [{ sourceId: "market.trends.cc" }],
        actionableAdvice: "Seek governance exposure or board observer seats within high-growth startups to bridge statutory corporate finance gaps."
      });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 7. COMPUTE FINAL DECISION VERDICT & ACTIONS (DECISION INTELLIGENCE - ENGINE 3)
    // ────────────────────────────────────────────────────────────────────────
    const verdict = computeDecisionVerdict(requiredFit, finalAdvantages.length, alignmentLevel, policy);

    let strategicRationale = "";
    const nextActions: SuggestedAction[] = [];

    if (verdict === "PURSUE") {
      strategicRationale = `An exceptional fit. Your executive experience matches the core required fit (${requiredFit}%), while your surpluses in regional scale and commercial retainers provide high-leverage strategic advantages. This role directly accelerates your progress toward a Chief Commercial Officer (CCO) track.`;
      nextActions.push(
        {
          actionItem: `Anchor your first conversation on your WPP / Ogilvy ₹36 Cr BMW retainer precedent.`,
          type: "INTERVIEW_PREP",
          confidence: 0.95,
          rationale: "Reframes you instantly as a high-value commercial partner rather than an applicant."
        },
        {
          actionItem: "Negotiate for direct C-suite or board-advisory representation to expand local country scope.",
          type: "NEGOTIATION",
          confidence: 0.92,
          rationale: "Ensures you maintain high-altitude network visibility and bridge any local-market operational narrowness."
        }
      );
    } else if (verdict === "CONSIDER") {
      strategicRationale = `A highly viable tactical option. While this seat has specific required gaps or presents a narrower organizational scope, it offers an excellent screen to test your strategic capabilities or expand your vertical network in ${company}.`;
      nextActions.push({
        actionItem: `Verify the reporting matrix, true team size, and 24-month succession path in writing.`,
        type: "INTERVIEW_PREP",
        confidence: 0.91,
        rationale: "This is the single critical filter that decides whether this role is a step-up or a lateral bottleneck."
      });
    } else {
      strategicRationale = `We recommend passing on this opening. A matching score of ${requiredFit}% combined with low seniority alignment means this role operates too far down the execution funnel and would create a major lateral bottleneck.`;
      nextActions.push({
        actionItem: "Redirect focus to active Chief, VP, or Senior Director pipeline listings in similar high-leverage domains.",
        type: "REFERENCE_CHECK",
        confidence: 0.96,
        rationale: "Preserves your high executive momentum for high-altitude C-suite opportunities."
      });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 8. COMBINE INTO COMPLETED EVALUATION ENVELOPE
    // ────────────────────────────────────────────────────────────────────────
    const metadata: EvaluationMetadata = {
      evaluationVersion: "4.0.0",
      promptVersion: "v4.5-algorithmic-pipeline",
      roleModelVersion: "VP_Growth@1.2",
      decisionPolicyVersion: policy.version,
      generatedAt: new Date().toISOString()
    };

    const response: EvaluationResponse = {
      opportunity: {
        requiredFit,
        requiredGaps,
        strategicAdvantages: finalAdvantages
      },
      growth: {
        careerAlignment: {
          level: alignmentLevel,
          score: alignmentScore,
          rationale: alignmentRationale,
          supportingFactors,
          confidence: 0.90
        },
        capabilityUtilization: {
          strategy: { level: strategyUtil, confidence: 0.92, reason: `Highly exercises your positioning frameworks in a ${seniority.toLowerCase()}-level environment.` },
          commercial: { level: commercialUtil, confidence: 0.90, reason: `Matches your proven budget administration and contract scale precedents.` },
          leadership: { level: leadershipUtil, confidence: 0.94, reason: `Matches the managerial oversight level expected for ${seniority.toLowerCase()} tiers.` },
          technical: { level: technicalUtil, confidence: 0.88, reason: `Operational requirements focus mostly on brand strategy and growth rather than MarTech engineering.` },
          transformation: { level: transformationUtil, confidence: 0.91, reason: `Applies your organizational transformation experience to drive growth.` }
        },
        developmentRecommendations
      },
      decision: {
        verdict,
        strategicRationale,
        nextActions
      }
    };

    return {
      metadata,
      response
    };
  }
}
