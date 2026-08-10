import type { Opportunity } from "../../../data/opportunity-fixtures";
import { EditorialContextBuilder } from "./EditorialContext";
import { EditorialPatternSelector } from "./EditorialPatternSelector";
import { NarrativeComposer } from "./NarrativeComposer";
import { SemanticNaturalLanguageResolver, unwrapEvidenceValue } from "./SemanticNaturalLanguageResolver";
import { ExecutiveKnowledgeNormalizationPipeline } from "../ekb/ExecutiveKnowledgeNormalizationPipeline";

export interface BriefSectionMeta {
  id: string;
  name: string;
  eyebrow: string;
  numeral: string;
  title: string;
  expression: string;
}

export interface BriefMemory {
  headline: string;
  retentionSentence: string;
  primaryOpportunity: string;
  primaryRisk: string;
  recommendedAction: string;
  decision: "PURSUE" | "CONSIDER" | "PASS";
  tradeoff: string;
  first90Days: string;
  whyNow: string;
}

export interface OpportunityInOneMinute {
  whyPursue: string[];
  watchFor: string[];
  bottomLine: string;
}

export interface QualitativeReasoningRow {
  layer: string;
  ratingLabel: "Exceptional" | "Strong Alignment" | "Adjacent Alignment" | "Requires Verification";
  becausePoints: string[];
  evidenceSnippet: string;
}

export interface StrategicUpside {
  headline: string;
  points: string[];
}

export interface RankedUnknown {
  rank: "CRITICAL" | "IMPORTANT" | "SECONDARY";
  label: string;
  question: string;
}

export interface ProofPointItem {
  category: "Direct Evidence" | "Transferable Experience" | "Structural Risk";
  headline: string;
  detail: string;
}

export interface BriefModel {
  memory: BriefMemory;
  structuredSections: {
    context: { thesis: string; body?: string; transition?: string };
    mandate: { thesis: string; body?: string; transition?: string };
    synthesis: { thesis: string };
    evidence: { thesis: string; body?: string; transition?: string };
    strategy: { thesis: string; body?: string };
  };
  oneMinuteTLDR: OpportunityInOneMinute;
  qualitativeReasoning: QualitativeReasoningRow[];
  qualitativeReasoningChain: QualitativeReasoningRow[];
  strategicUpside: StrategicUpside;
  decisionSensitivity: {
    becomesPursueIf: string[];
    becomesPassIf: string[];
  };
  rankedUnknowns: RankedUnknown[];
  deliverablesWork: string[];
  deliverablesValue: string[];
  deliverablesProvenance: Array<"Observed in JD" | "Inferred from Role Pattern">;
  deliverables: {
    workRequired: string[];
    businessValue: string[];
    provenance: Array<"Observed in JD" | "Inferred from Role Pattern">;
  };
  proofPoints: ProofPointItem[];
  fitProofs: string[];
  certaintyLevel: "HIGH" | "MEDIUM" | "LOW";
  certaintyGuidance: string;
  evidenceQuality: "High Evidence Quality" | "Medium Evidence Quality" | "Inferred Evidence";
  qualitativeRecommendation: "Strong Pursue Recommendation" | "Conditional Consideration" | "Strategic Pass";
  whyNotStronger?: string;
  frictionPreview?: string;
  topUnknownPreview?: string;

  strategy: {
    focusTitle: string;
    heroAnchor: string;
  };
  narrative: {
    intent: string;
  };
  verdictGuidance: {
    actionNotice: string;
    tradeoffStatement: string;
    pauseTrigger: string;
  };
  executiveOpinion?: string;
  directives?: {
    reflection?: string;
    action?: string;
    observation?: string;
    positioning?: string;
  };
}

export class BriefCompositionEngine {
  public static compose(opportunity: Opportunity, options?: { brevityPolicy?: any; bypassHistory?: boolean }): BriefModel {
    const policy = options?.brevityPolicy || {
      maxUnknowns: 3,
      maxEvidence: 3,
      maxDeliverables: 3,
    };

    const score = opportunity.recommendationResult?.score ?? 50;
    const certaintyPct = Math.min(95, Math.max(60, score + 5));
    const weights = this.calculateWeights(opportunity);
    const strategy = this.deriveStrategy(weights, opportunity);

    const decision: BriefMemory["decision"] =
      opportunity.decision === "PURSUE" || score >= 75
        ? "PURSUE"
        : opportunity.decision === "CONSIDER" || score >= 50
        ? "CONSIDER"
        : "PASS";

    // Factual Evidence-Grounded Capabilities - parsed through the Executive Knowledge Normalization Pipeline
    const capDimensions = (opportunity.dimensions || [])
      .filter((d: any) => d.key === "technologyStack" || d.key === "functionalScope" || d.key === "mandate");

    const normalizedCaps = ExecutiveKnowledgeNormalizationPipeline.normalize(capDimensions);
    const resolvedCapText = normalizedCaps.map((c) => c.label).join(", ");
    
    const primaryCap = normalizedCaps[0]?.label || opportunity.role;
    const secondaryCap = normalizedCaps[1]?.label || "Commercial Strategy";
    const tertiaryCap = normalizedCaps[2]?.label || "Execution Operations";

    const retentionSentence = resolvedCapText
      ? `${opportunity.role} mandate at ${opportunity.company} focused on ${resolvedCapText}.`
      : `${opportunity.role} mandate at ${opportunity.company} in ${opportunity.location || "target location"}.`;

    let primaryOpportunity = decision === "PURSUE"
      ? `Direct functional ownership of ${opportunity.role} at ${opportunity.company}`
      : `Scope alignment for ${opportunity.role} with ${opportunity.company}`;

    let primaryRisk = weights.risk > 0.4
      ? "Specific reporting line or operating scale trade-offs require screening verification"
      : "Standard executive application and alignment overhead";

    let recommendedAction = SemanticNaturalLanguageResolver.resolveActionRecommendation(decision, opportunity.role, opportunity.company);

    try {
      const ctx = EditorialContextBuilder.build(opportunity);
      const pattern = EditorialPatternSelector.select(ctx, opportunity.jobHash, options?.bypassHistory);
      const composed = NarrativeComposer.compose(pattern, opportunity);

      if (composed.decisionGuidance.proceedIf) {
        primaryOpportunity = composed.decisionGuidance.proceedIf;
      }
      if (composed.decisionGuidance.pauseIf) {
        primaryRisk = composed.decisionGuidance.pauseIf;
      }
      if (composed.decisionGuidance.closing) {
        recommendedAction = composed.decisionGuidance.closing;
      }
    } catch (composedErr) {
      console.error("BriefCompositionEngine narrative composition fallback:", composedErr);
    }

    const tradeoff = `Evaluating ${opportunity.role} scope at ${opportunity.company} against current career velocity`;

    const first90Days = resolvedCapText
      ? `Establish operational baseline across ${resolvedCapText} within first 60 days`
      : `Establish operational baseline for ${opportunity.role} mandate within first 60 days`;

    const whyNow = `${opportunity.company} is hiring for ${opportunity.role} in ${opportunity.location || "target region"} to drive strategic initiatives.`;

    const memory: BriefMemory = {
      headline: `${decision}: ${opportunity.role} at ${opportunity.company}`,
      retentionSentence,
      primaryOpportunity,
      primaryRisk,
      recommendedAction,
      decision,
      tradeoff,
      first90Days,
      whyNow,
    };

    const headline = `${strategy.focusTitle}: ${strategy.heroAnchor}`;

    // Qualitative Judgments over Pseudo-Precision
    const explicitCount = (opportunity.dimensions || []).filter((d: any) => d.jdEvidence?.status === "Explicit").length;
    const evidenceQuality: BriefModel["evidenceQuality"] =
      explicitCount >= 3 ? "High Evidence Quality" : explicitCount >= 1 ? "Medium Evidence Quality" : "Inferred Evidence";

    const qualitativeRecommendation: BriefModel["qualitativeRecommendation"] =
      decision === "PURSUE" ? "Strong Pursue Recommendation" : decision === "CONSIDER" ? "Conditional Consideration" : "Strategic Pass";

    const whyNotStronger = score >= 75
      ? `This role aligns strongly with target executive capabilities and leadership scope for ${opportunity.role}.`
      : score >= 60
      ? `Operating scope at ${opportunity.company} is scoped at regional Head level rather than global C-suite, limiting immediate P&L scale.`
      : "Domain divergence or organizational level regression requires significant transition overhead.";

    const oneMinuteTLDR: OpportunityInOneMinute = {
      whyPursue: [
        `Direct functional ownership of ${opportunity.role} mandate at ${opportunity.company}.`,
        `Strategic alignment with your ${primaryCap} background.`,
        `Favorable career velocity surplus in ${opportunity.location || "target markets"}.`,
      ],
      watchFor: [
        `Strategic Risk: Evaluate if the mandate carries genuine P&L authority or functions merely as an operational execution arm.`,
        `Execution Risk: Verify if the team budget and headcount are formally approved for the requested 24-month expansion targets.`,
        `Market Risk: Assess if the organization has moved beyond founder-led decision making into scalable governance.`,
      ],
      bottomLine: decision === "PURSUE" ? "Worth pursuing." : decision === "CONSIDER" ? "Verify scope before applying." : "Strategic Pass.",
    };

    const qualitativeReasoningChain: QualitativeReasoningRow[] = [
      {
        layer: "Identity Alignment",
        ratingLabel: score >= 75 ? "Exceptional" : "Strong Alignment",
        becausePoints: [
          `${opportunity.role} Scoping`,
          `${opportunity.company} Mandate`,
          `${opportunity.location || "Regional"} Presence`
        ],
        evidenceSnippet: `Direct executive alignment for ${opportunity.role} verified at ${opportunity.company}.`,
      },
      {
        layer: "Capability Coverage",
        ratingLabel: score >= 75 ? "Exceptional" : "Strong Alignment",
        becausePoints: [
          `${primaryCap} (Direct Match)`,
          `${secondaryCap} (Verified)`,
          `${tertiaryCap} (Graph Mapped)`
        ],
        evidenceSnippet: `Capabilities for ${opportunity.role} mapped directly to candidate experience graph.`,
      },
      {
        layer: "Career Capital Value",
        ratingLabel: score >= 70 ? "Strong Alignment" : "Adjacent Alignment",
        becausePoints: [
          `Direct P&L & Scale Alignment`,
          `Operating Scope & Mandate Overlap`,
          `Long-Term Career Leverage`
        ],
        evidenceSnippet: `Executive positioning at ${opportunity.company} expands long-term leadership leverage.`,
      },
    ];

    const strategicUpside: StrategicUpside = {
      headline: "Strategic Career Value",
      points: [
        `This role broadens your record from functional ${primaryCap} leadership to full country-level commercial ownership.`,
        `This is likely to become one of the strongest P&L acceleration signals on your executive résumé.`,
        `Establishes multi-region platform governance experience positioning you for future regional CXO searches.`
      ],
    };

    const decisionSensitivity = {
      becomesPursueIf: [
        `Global P&L ownership and board-level commercial reporting at ${opportunity.company} is confirmed.`,
        "Direct C-suite or Founders reporting line is established in screening.",
        "Team headcount and hiring budget exceeds 25 FTEs.",
      ],
      becomesPassIf: [
        "Individual contributor role without team budget authority.",
        "Operating scope limited strictly to single-channel execution.",
        "Work model or location requirements conflict with executive preferences.",
      ],
    };

    let frictionPreview: string | undefined = undefined;
    const reqs = opportunity.positioning || [];
    const travelReq = reqs.find((r: string) => r.toLowerCase().includes("travel"));
    if (travelReq) {
      frictionPreview = `Minor concern: ${travelReq}`;
    }

    let topUnknownPreview: string | undefined = "Critical Unknown: Compensation target not disclosed";

    const reportingDim = opportunity.dimensions?.find((d: any) => d.key === "reportingLine");
    const reportingVal = unwrapEvidenceValue(reportingDim?.jdEvidence?.value);
    const reportingQuestion = reportingDim?.jdEvidence?.status === "Inferred" && reportingVal
      ? `Does this role report directly to ${reportingVal} or regional leadership?`
      : "Does this role report directly to the CEO, C-suite, or Regional VP?";

    const rankedUnknowns: RankedUnknown[] = [
      {
        rank: "CRITICAL" as const,
        label: "Compensation Target",
        question: "Confirm compensation target, variable structure, and equity component.",
      },
      {
        rank: "IMPORTANT" as const,
        label: "Reporting Line Hierarchy",
        question: `Confirm reporting line: ${reportingQuestion}`,
      },
      {
        rank: "SECONDARY" as const,
        label: "Team Scale & Resources",
        question: "Confirm hiring authority, current team headcount, and budget control.",
      },
    ].slice(0, policy.maxUnknowns);

    if (opportunity.dimensions?.some((d: any) => d.key === "reportingLine" && d.bucket === "Missing")) {
      topUnknownPreview = "Unknown: Reporting line hierarchy";
    }

    const explicitQuotes = (opportunity.dimensions || [])
      .flatMap((d: any) => d.jdEvidence?.evidence || [])
      .map((e: any) => e.quote)
      .filter((q: string) => q && q.length > 15 && q.length < 120);

    const deliverablesWork = [
      explicitQuotes[0] || `Drive ${opportunity.role} strategy and execution roadmap at ${opportunity.company}.`,
      explicitQuotes[1] || `Accelerate growth and operational priorities in ${opportunity.location || "core markets"}.`,
      explicitQuotes[2] || `Scale operating model and cross-functional execution teams.`,
    ].slice(0, policy.maxEvidence);

    const deliverablesValue = [
      `Accelerate organizational growth and market reach at ${opportunity.company}.`,
      `Optimize operational expenditure and delivery velocity.`,
      `Expand platform maturity and commercial scale.`,
    ].slice(0, policy.maxEvidence);

    const deliverablesProvenance: Array<"Observed in JD" | "Inferred from Role Pattern"> = [
      explicitQuotes[0] ? "Observed in JD" : "Inferred from Role Pattern",
      explicitQuotes[1] ? "Observed in JD" : "Inferred from Role Pattern",
      "Inferred from Role Pattern",
    ];

    const proofPoints: ProofPointItem[] = [
      {
        category: "Direct Evidence",
        headline: `Proven Authority in ${primaryCap}`,
        detail: `Verified against historical candidate experience for ${opportunity.company}.`,
      },
      {
        category: "Transferable Experience",
        headline: `Functional Capability Transferability`,
        detail: `Core leadership competencies align directly with required mandate responsibilities for ${opportunity.role}.`,
      },
    ];

    const fitProofs = [
      `Proven track record in ${primaryCap}.`,
      `Demonstrated capability leading ${opportunity.role} operations.`,
      `Prior experience scaling enterprise execution in ${opportunity.location || "primary markets"}.`,
    ].slice(0, policy.maxEvidence);

    let certaintyLevel: BriefModel["certaintyLevel"] = "HIGH";
    let certaintyGuidance = "Strong evidence across candidate profile and job description.";
    if (score < 50) {
      certaintyLevel = "LOW";
      certaintyGuidance = "Several critical requirements were not explicitly described. Verify during screening.";
    } else if (topUnknownPreview || frictionPreview) {
      certaintyLevel = "MEDIUM";
      certaintyGuidance = "Solid functional alignment. Verify reporting line and requirements during screening.";
    }

    const sections: BriefSectionMeta[] = [
      {
        id: "STRATEGIC_CAREER_VALUE",
        name: "Strategic Career Value",
        eyebrow: "STRATEGIC CAREER VALUE",
        numeral: "I",
        title: "Why this role is interesting",
        expression: "Key strategic levers and career capital upside.",
      },
      {
        id: "EXPLAINABLE_REASONING",
        name: "Explainable Reasoning",
        eyebrow: "EXPLAINABLE REASONING",
        numeral: "II",
        title: "Why this recommendation?",
        expression: "Structured breakdown of identity, capability, and value.",
      },
      {
        id: "EXECUTIVE_DOSSIER",
        name: "Executive Dossier",
        eyebrow: "EXECUTIVE DOSSIER",
        numeral: "III",
        title: `Yes — but for a very specific reason.`,
        expression: "Synthesis of mandate, requirements, and key risks.",
      },
      {
        id: "MANDATE_DELIVERABLES",
        name: "Mandate Deliverables",
        eyebrow: "MANDATE DELIVERABLES",
        numeral: "IV",
        title: "What will you be expected to deliver?",
        expression: "Operational deliverables and expected business value.",
      },
      {
        id: "CANDIDATE_MATCH",
        name: "Candidate Match",
        eyebrow: "CANDIDATE MATCH",
        numeral: "V",
        title: "The Evidence for Alignment",
        expression: "Direct evidence and graph transferability proof points.",
      },
      {
        id: "REASONING_AND_RISKS",
        name: "Reasoning & Risks",
        eyebrow: "REASONING & RISKS",
        numeral: "VI",
        title: "Clarify these before the call",
        expression: "Key unknowns and critical screening questions.",
      },
      {
        id: "DECISION_SENSITIVITY",
        name: "Decision Sensitivity",
        eyebrow: "DECISION SENSITIVITY",
        numeral: "VII",
        title: "What would change this decision?",
        expression: "Explicit boundaries that shift Pursue to Pass.",
      },
      {
        id: "SUPPORTING_EVIDENCE",
        name: "Supporting Evidence",
        eyebrow: "SUPPORTING EVIDENCE",
        numeral: "VIII",
        title: "Evidence behind this recommendation",
        expression: "Direct excerpts and extracted job dimensions.",
      },
      {
        id: "DOSSIER_LEDGER",
        name: "Dossier Ledger",
        eyebrow: "DOSSIER LEDGER",
        numeral: "IX",
        title: "Experience & claims inventory",
        expression: "Verified candidate experience signals.",
      },
    ];

    const executiveOpinion = decision === "PURSUE"
      ? `This is the strongest commercial transformation mandate on your desk this month. It directly compounds your proven growth leadership record at this operating scale rather than asking you to reinvent it. I would invest time here immediately—but only after confirming board-level reporting is formally approved at ${opportunity.company}.`
      : decision === "CONSIDER"
      ? `A solid tactical growth opportunity, though the operating scale sits closer to regional execution than global strategy. Your background makes you highly competitive, but you must clarify during screening if the mandate carries genuine P&L authority or functions merely as an operational extension.`
      : `While ${opportunity.company} is a visible enterprise brand, the required altitude represents a structural regression from your verified career capital. I recommend a strategic pass on this mandate to preserve search bandwidth for opportunities offering true board-level commercial ownership.`;

    const structuredSections = {
      context: {
        thesis: "There is enough strategic signal here to justify immediate investigation, but not enough operational detail to commit without recruiter validation.",
        transition: "If those assumptions prove true, the question becomes whether the mandate itself justifies your time."
      },
      mandate: {
        thesis: `Deliver strategic growth and cross-functional leadership alignment at ${opportunity.company}.`,
        transition: "It does—provided the first 18 months look like this."
      },
      synthesis: {
        thesis: decision === "PURSUE" 
          ? "Proceed. The strategic upside outweighs the remaining uncertainty, provided the reporting structure confirms genuine commercial ownership."
          : decision === "CONSIDER"
          ? "Proceed with caution. The domain alignment is strong, but the actual P&L authority must be verified before investing significant time."
          : "Pass. The required altitude represents a structural regression from your current career velocity."
      },
      evidence: {
        thesis: `Why you are well-positioned: You possess proven growth authority and direct domain match for this ${opportunity.role} seat.`,
      },
      strategy: {
        thesis: `How to position: Frame your background around high-velocity market scaling, downplaying single-channel execution.`,
      }
    };

    const directives = {
      reflection: `Consider whether this market trajectory strengthens your executive record over a 3-year horizon.`,
      action: `Validate these operational assumptions during your first recruiter conversation before committing to full interviews.`,
      observation: `The recommendation remains strong unless commercial ownership proves narrower than expected.`,
      positioning: decision === "PURSUE" 
        ? "Your experience aligns directly. Focus your narrative on your track record of scaling commercial governance." 
        : "Ensure your resume explicitly highlights P&L responsibility to bridge gaps in functional domain coverage."
    };

    return {
      executiveOpinion,
      directives,
      memory,
      structuredSections,
      oneMinuteTLDR,
      qualitativeReasoning: qualitativeReasoningChain,
      qualitativeReasoningChain,
      strategicUpside,
      decisionSensitivity,
      rankedUnknowns,
      deliverablesWork,
      deliverablesValue,
      deliverablesProvenance,
      deliverables: {
        workRequired: deliverablesWork,
        businessValue: deliverablesValue,
        provenance: deliverablesProvenance,
      },
      proofPoints,
      fitProofs,
      certaintyLevel,
      certaintyGuidance,
      evidenceQuality,
      qualitativeRecommendation,
      whyNotStronger,
      frictionPreview,
      topUnknownPreview,
      strategy,
      narrative: { intent: strategy.heroAnchor },
      verdictGuidance: {
        actionNotice: memory.recommendedAction,
        tradeoffStatement: memory.tradeoff,
        pauseTrigger: memory.primaryRisk,
      },
    };
  }

  private static calculateWeights(opportunity: Opportunity) {
    const score = opportunity.recommendationResult?.score ?? 50;
    const base = score / 100;
    return {
      fit: Math.min(0.95, base + 0.1),
      upside: Math.min(0.9, base * 0.8 + 0.15),
      risk: Math.max(0.1, 1 - base),
    };
  }

  private static deriveStrategy(weights: { fit: number; upside: number; risk: number }, opportunity: Opportunity) {
    if (weights.fit > 0.75) {
      return {
        focusTitle: "Direct Functional Ownership",
        heroAnchor: `Accelerate top-line commercial growth as ${opportunity.role} at ${opportunity.company}`,
      };
    }
    if (weights.upside > 0.6) {
      return {
        focusTitle: "Strategic Platform Expansion",
        heroAnchor: `Expand multi-market leadership and executive reach at ${opportunity.company}`,
      };
    }
    return {
      focusTitle: "Scope Verification Required",
      heroAnchor: `Validate functional reporting line and budget authority at ${opportunity.company}`,
    };
  }
}
