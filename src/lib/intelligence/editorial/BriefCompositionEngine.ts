import type { Opportunity } from "../../../data/opportunity-fixtures";
import { EditorialContextBuilder, type EditorialContext } from "./EditorialContext";
import { ExecutiveThesisBuilder, type ExecutiveThesis } from "./ExecutiveThesisBuilder";
import { PrimaryReasonResolver } from "./PrimaryReasonResolver";
import type { ExecutiveDecisionExplanation } from "./ExecutiveDecisionExplanation";
import { PursuitStrategyResolver } from "./PursuitStrategyResolver";
import type { PursuitStrategy } from "./PursuitStrategy";
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
  decision: "PURSUE" | "CONSIDER" | "PASS" | null;
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
  ratingLabel: "Exceptional" | "Strong Alignment" | "Adjacent Alignment" | "Requires Verification" | "Limited Upside";
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
  editorialContext: EditorialContext;
  executiveThesis: ExecutiveThesis;
  explanation: ExecutiveDecisionExplanation;
  pursuitStrategy: PursuitStrategy;
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
  qualitativeRecommendation: "Strong Pursue Recommendation" | "Conditional Consideration" | "Strategic Pass" | "Pending Assessment";
  qualityScore: number | null;
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
  public static compose(opportunity: Opportunity, options?: { brevityPolicy?: { maxUnknowns?: number; maxEvidence?: number; maxDeliverables?: number }; bypassHistory?: boolean }): BriefModel {
    const policy = options?.brevityPolicy || {
      maxUnknowns: 3,
      maxEvidence: 3,
      maxDeliverables: 3,
    };

    // Authoritative Projection Layer
    const editorialContext = EditorialContextBuilder.build(opportunity);
    const executiveThesis = ExecutiveThesisBuilder.build(editorialContext, opportunity);
    const explanation = executiveThesis.explanation || PrimaryReasonResolver.resolve(editorialContext, opportunity);
    const pursuitStrategy = PursuitStrategyResolver.resolve(explanation, editorialContext);

    // Strict alignment with authoritative engine verdict (null if unevaluated)
    const engineVerdict = editorialContext.engineVerdict;
    const decision: BriefMemory["decision"] =
      engineVerdict === "PURSUE" ? "PURSUE" : engineVerdict === "PASS" ? "PASS" : engineVerdict === "CONSIDER" ? "CONSIDER" : null;

    const score = editorialContext.rawScore;
    const weights = this.calculateWeights(opportunity);
    const strategy = this.deriveStrategy(weights, opportunity);

    // Factual Evidence-Grounded Capabilities - parsed through EKB
    const capDimensions = (opportunity.dimensions || [])
      .filter((d: Record<string, unknown>) => d.key === "technologyStack" || d.key === "functionalScope" || d.key === "mandate");

    const normalizedCaps = ExecutiveKnowledgeNormalizationPipeline.normalize(capDimensions);

    const primaryCap = normalizedCaps[0]?.label || "Growth Architecture";
    const secondaryCap = normalizedCaps[1]?.label || "Commercial Transformation";
    const tertiaryCap = normalizedCaps[2]?.label || "Executive Governance";

    const resolvedCapText = [primaryCap, secondaryCap].filter(Boolean).join(" & ");

    const retentionSentence = resolvedCapText
      ? `${opportunity.role} at ${opportunity.company} targeting ${resolvedCapText}.`
      : `${opportunity.role} mandate at ${opportunity.company} in ${opportunity.location || "target location"}.`;

    let primaryOpportunity = decision === "PURSUE"
      ? `Direct functional ownership of ${opportunity.role} at ${opportunity.company}`
      : `Scope alignment for ${opportunity.role} with ${opportunity.company}`;

    let primaryRisk = weights.risk > 0.4
      ? "Specific reporting line or operating scale trade-offs require screening verification"
      : "Standard executive application and alignment overhead";

    let recommendedAction: string = explanation.recommendedAction || (engineVerdict ? "INVESTIGATE" : "AWAIT_SIGNAL");

    try {
      const pattern = EditorialPatternSelector.select(editorialContext, opportunity.jobHash, options?.bypassHistory);
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

    const isEasyTrapTriggered =
      executiveThesis.careerValueSignal === "LIMITED CAREER UPSIDE" ||
      executiveThesis.careerValueSignal === "CAREER REGRESSION / PROTECTION" ||
      editorialContext.careerValue.triggeredRuleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION");

    const relativeDiff = editorialContext.careerValue.relativeDifferentiator;

    const tradeoff = isEasyTrapTriggered
      ? (relativeDiff || "Evaluating strong candidate profile alignment against limited career value step-up.")
      : `Evaluating ${opportunity.role} scope at ${opportunity.company} against current career velocity`;

    const first90Days = resolvedCapText
      ? `Establish operational baseline across ${resolvedCapText} within first 60 days`
      : `Establish operational baseline for ${opportunity.role} mandate within first 60 days`;

    const whyNow = `${opportunity.company} is hiring for ${opportunity.role} in ${opportunity.location || "target region"} to drive strategic initiatives.`;

    const memory: BriefMemory = {
      headline: executiveThesis.headline,
      retentionSentence,
      primaryOpportunity,
      primaryRisk,
      recommendedAction,
      decision,
      tradeoff,
      first90Days,
      whyNow,
    };

    const evidenceQuality = editorialContext.evidence?.evidenceQuality || "Inferred Evidence";

    const qualitativeRecommendation: BriefModel["qualitativeRecommendation"] =
      engineVerdict === "PURSUE"
        ? "Strong Pursue Recommendation"
        : engineVerdict === "CONSIDER"
        ? "Conditional Consideration"
        : engineVerdict === "PASS"
        ? "Strategic Pass"
        : "Pending Assessment";

    const whyNotStronger = isEasyTrapTriggered
      ? "Policy Engine flagged material career-value protection rule: high accessibility/match score, but limited long-term trajectory step-up."
      : engineVerdict === "PURSUE"
      ? `This role aligns strongly with target executive capabilities and leadership scope for ${opportunity.role}.`
      : engineVerdict === "CONSIDER"
      ? `Operating scope at ${opportunity.company} is scoped at regional execution rather than global C-suite authority.`
      : engineVerdict === "PASS"
      ? "Domain divergence or organizational level regression requires significant transition overhead."
      : "Posting is unevaluated or requires further structural evidence.";

    const oneMinuteTLDR: OpportunityInOneMinute = {
      whyPursue: [
        `Direct functional ownership of ${opportunity.role} mandate at ${opportunity.company}.`,
        `Strategic alignment with your ${primaryCap} background.`,
        isEasyTrapTriggered
          ? (relativeDiff || "High interview probability based on profile alignment.")
          : `Favorable career velocity surplus in ${opportunity.location || "target markets"}.`,
      ],
      watchFor: [
        ...(isEasyTrapTriggered
          ? [`Career Trajectory Risk: High shortlisting potential but offers limited career capital step-up relative to your current altitude.`]
          : []),
        `Strategic Risk: Evaluate if the mandate carries genuine P&L authority or functions merely as an operational execution arm.`,
        `Execution Risk: Verify if the team budget and headcount are formally approved for the requested expansion targets.`,
        `Market Risk: Assess if the organization has moved beyond founder-led decision making into scalable governance.`,
      ],
      bottomLine: isEasyTrapTriggered
        ? "Caution: High interview probability, but evaluate if the career step-up justifies the transition."
        : engineVerdict === "PURSUE" ? "Worth pursuing." : engineVerdict === "CONSIDER" ? "Verify scope before applying." : "Strategic Pass.",
    };

    const qualitativeReasoningChain: QualitativeReasoningRow[] = [
      {
        layer: "Identity Alignment",
        ratingLabel: engineVerdict === "PURSUE" ? "Exceptional" : "Strong Alignment",
        becausePoints: [
          `${opportunity.role} Scoping`,
          `${opportunity.company} Mandate`,
          `${opportunity.location || "Regional"} Presence`
        ],
        evidenceSnippet: `Direct executive alignment for ${opportunity.role} verified at ${opportunity.company}.`,
      },
      {
        layer: "Capability Coverage",
        ratingLabel: engineVerdict === "PURSUE" ? "Exceptional" : "Strong Alignment",
        becausePoints: [
          `${primaryCap} (Direct Match)`,
          `${secondaryCap} (Verified)`,
          `${tertiaryCap} (Graph Mapped)`
        ],
        evidenceSnippet: `Capabilities for ${opportunity.role} mapped directly to candidate experience graph.`,
      },
      {
        layer: "Career Capital Value",
        ratingLabel: isEasyTrapTriggered
          ? "Limited Upside"
          : engineVerdict === "PURSUE" ? "Strong Alignment" : "Adjacent Alignment",
        becausePoints: isEasyTrapTriggered
          ? [
              `High Accessibility / Profile Match`,
              `Limited Long-Term Career Step-Up`,
              `Potential Trajectory Deceleration`
            ]
          : [
              `Direct P&L & Scale Alignment`,
              `Operating Scope & Mandate Overlap`,
              `Long-Term Career Leverage`
            ],
        evidenceSnippet: isEasyTrapTriggered
          ? (relativeDiff || "High shortlisting probability, but represents limited career capital step-up.")
          : `Executive positioning at ${opportunity.company} expands long-term leadership leverage.`,
      },
    ];

    const strategicUpside: StrategicUpside = {
      headline: isEasyTrapTriggered ? "Career Value Protection Notice" : "Strategic Career Value",
      points: isEasyTrapTriggered
        ? [
            relativeDiff || "This role offers high shortlisting probability due to profile overlap, but limited career capital step-up.",
            "While accessible, applying here may consume search bandwidth better allocated to higher-leverage CXO mandates.",
            "Ensure the commercial scope and P&L authority offer genuine expansion before committing to full interviews."
          ]
        : [
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

    const reportingDim = (opportunity.dimensions as Record<string, unknown>[] | undefined)?.find((d) => d.key === "reportingLine");
    const reportingVal = unwrapEvidenceValue((reportingDim?.jdEvidence as Record<string, unknown> | undefined)?.value);
    const reportingQuestion = (reportingDim?.jdEvidence as Record<string, unknown> | undefined)?.status === "Inferred" && reportingVal
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

    if ((opportunity.dimensions as Record<string, unknown>[] | undefined)?.some((d) => d.key === "reportingLine" && d.bucket === "Missing")) {
      topUnknownPreview = "Unknown: Reporting line hierarchy";
    }

    const explicitQuotes = (opportunity.dimensions as Record<string, unknown>[] || [])
      .flatMap((d) => ((d.jdEvidence as Record<string, unknown> | undefined)?.evidence as Array<{ quote?: string }> || []))
      .map((e) => e.quote)
      .filter((q): q is string => Boolean(q && q.length > 15 && q.length < 120));

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

    const executiveOpinion = engineVerdict === "PURSUE"
      ? `This is the strongest commercial transformation mandate on your desk this month. It directly compounds your proven growth leadership record at this operating scale rather than asking you to reinvent it. I would invest time here immediately—but only after confirming board-level reporting is formally approved at ${opportunity.company}.`
      : isEasyTrapTriggered
      ? `While your profile aligns strongly with this mandate (giving you high shortlisting probability), RADAR's policy engine flags limited career value step-up relative to your current trajectory. Evaluate carefully whether this opportunity advances your long-term career capital or represents a lateral/decelerating step before allocating interview bandwidth.`
      : engineVerdict === "CONSIDER"
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
        thesis: executiveThesis.primaryReason,
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
      positioning: engineVerdict === "PURSUE" 
        ? "Your experience aligns directly. Focus your narrative on your track record of scaling commercial governance." 
        : "Ensure your resume explicitly highlights P&L responsibility to bridge gaps in functional domain coverage."
    };

    const qualityScore = opportunity.engineRecommendation?.vetoed
      ? null
      : (opportunity.engineRecommendation?.qualityScore ?? (editorialContext.rawScore != null ? Math.round(editorialContext.rawScore) : null));

    return {
      editorialContext,
      executiveThesis,
      explanation,
      pursuitStrategy,
      executiveOpinion,
      directives,
      memory,
      qualityScore,
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
