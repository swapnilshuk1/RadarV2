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
import { AdvisoryConstitution, type SectionEvidenceInventory } from "./AdvisoryConstitution";
import {
  substantiveCandidateEvidence,
} from "./CandidateProofPolicy";
import type { EditorialIntelligenceContract } from "./EditorialIntelligenceContract";

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
  category: "Direct Evidence" | "Transferable Experience" | "Structural Risk" | "Candidate precedent";
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
  public static compose(opportunity: Opportunity, options?: { brevityPolicy?: { maxUnknowns?: number; maxEvidence?: number; maxDeliverables?: number }; bypassHistory?: boolean; canonicalEvidenceBound?: boolean; editorialIntelligence?: EditorialIntelligenceContract }): BriefModel {
    const policy = options?.brevityPolicy || {
      maxUnknowns: 3,
      maxEvidence: 3,
      maxDeliverables: 3,
    };

    // Authoritative Projection Layer
    const editorialContext = EditorialContextBuilder.build(opportunity);
    const sufficiency = AdvisoryConstitution.validateDataSufficiency(opportunity);
    const inventory = AdvisoryConstitution.inspectSectionEvidence(opportunity);

    const explicitlySparse =
      (opportunity as { evaluationState?: string; decision?: string })
        .evaluationState === "SPARSE_SPEC"
      || (opportunity as { evaluationState?: string; decision?: string })
        .decision === "SPARSE_SPEC";

    if (explicitlySparse) {
      return this.composeEvidenceLimitedBrief(
        opportunity,
        editorialContext,
        sufficiency.message
          || "The published role specification is sparse and requires verification.",
      );
    }

    // IMPORTANT:
    // A canonical EVALUATED dossier must retain RADAR's recorded intelligence.
    // Missing formal employer facts restrict factual claims section-by-section;
    // they do NOT turn the entire dossier into a sparse memo.
    if (
      options?.canonicalEvidenceBound
      && inventory.hasCanonicalEvaluation
    ) {
      return this.composeGroundedCanonicalBrief(
        opportunity,
        editorialContext,
        inventory,
        policy,
        options.editorialIntelligence,
      );
    }

    if (!sufficiency.isSufficient) {
      if (
        sufficiency.state === "SPARSE_SPEC"
        && inventory.hasUsableInformation
      ) {
        return this.composePartialEvidenceBrief(
          opportunity,
          editorialContext,
          inventory,
        );
      }

      return this.composeEvidenceLimitedBrief(
        opportunity,
        editorialContext,
        sufficiency.message
          || "The available evidence is insufficient for an executive recommendation.",
      );
    }
    // The legacy rich composer is not safe for a record whose only job signal
    // is a handful of extracted facts. Preserve those facts in the partial
    // composer instead of allowing role-pattern defaults to fill the gaps.
    if (!inventory.hasSourceText && inventory.hasUsableInformation) {
      return this.composePartialEvidenceBrief(opportunity, editorialContext, inventory);
    }

    const executiveThesis = ExecutiveThesisBuilder.build(editorialContext, opportunity);
    const explanation = executiveThesis.explanation || PrimaryReasonResolver.resolve(editorialContext, opportunity);
    const pursuitStrategy = PursuitStrategyResolver.resolve(explanation, editorialContext);

    // Strict alignment with authoritative engine verdict (null if unevaluated)
    const engineVerdict = editorialContext.engineVerdict;
    const decision: BriefMemory["decision"] =
      engineVerdict === "PURSUE" ? "PURSUE" : engineVerdict === "PASS" ? "PASS" : engineVerdict === "CONSIDER" ? "CONSIDER" : null;

    const score = editorialContext.rawScore ?? 0;
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
    const score = opportunity.recommendationResult?.score ?? 0;
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

  /**
   * Composition for an evaluated or partially evidenced record that does not
   * qualify for the legacy rich composer. This path intentionally never uses
   * role-pattern defaults: every populated section comes from an explicit JD
   * quote or an already-recorded canonical assessment.
   */
  private static composePartialEvidenceBrief(
    opportunity: Opportunity,
    editorialContext: EditorialContext,
    inventory: SectionEvidenceInventory,
  ): BriefModel {
    const role = opportunity.role || "This role";
    const company = opportunity.company || "the company";
    const verdict = editorialContext.engineVerdict;
    const decision: BriefMemory["decision"] = verdict === "PURSUE" || verdict === "CONSIDER" || verdict === "PASS" ? verdict : null;
    const capabilityNames = editorialContext.capability?.matchedCapabilities.filter(Boolean).slice(0, 3) || [];
    const capabilityAssessment = capabilityNames.length > 0
      ? `RADAR capability assessment identifies alignment in ${capabilityNames.join(", ")}.`
      : "No recorded capability assessment is available for this section.";
    const careerAssessment = editorialContext.careerValue.relativeDifferentiator
      ? `RADAR career assessment: ${editorialContext.careerValue.relativeDifferentiator}`
      : inventory.hasCareerAssessment
      ? "RADAR recorded a career assessment signal for this opportunity."
      : "No specific career-upside conclusion is recorded.";
    const recordedPrimaryDriver = this.recordedText(opportunity.primaryDriver);
    const recordedPrimaryRisk = this.recordedText(opportunity.primaryRisk);
    const recordedWhyNow = this.recordedText(opportunity.whyNow);
    const recordedRecommendedAction = this.recordedText(opportunity.recommendedAction);
    const mandateEvidence = [...inventory.mandateQuotes, ...inventory.functionalScopeQuotes];
    const headline = verdict ? `RADAR ${verdict} assessment: ${role} at ${company}` : `RADAR assessment: ${role} at ${company}`;
    const primaryReason = recordedPrimaryDriver
      ?? mandateEvidence[0]
      ?? (capabilityNames.length > 0 ? capabilityAssessment : null)
      ?? "Published evidence is partial; verify the role mandate before investing further effort.";
    const explanation: ExecutiveDecisionExplanation = {
      verdict,
      headline,
      bottomLine: primaryReason,
      primaryReason,
      supportingReasons: [
        ...(capabilityNames.length > 0 ? [capabilityAssessment] : []),
        ...(recordedPrimaryRisk ? [`Key recorded risk: ${recordedPrimaryRisk}`] : []),
      ],
      careerValueSignal: editorialContext.careerValue.trajectoryUpside ? String(editorialContext.careerValue.trajectoryUpside) : null,
      tradeoff: editorialContext.careerValue.relativeDifferentiator || null,
      evidenceStrength: inventory.hasExplicitEvidence ? "LIMITED" : "INSUFFICIENT",
      keyUncertainty: null,
      recommendedAction: verdict === "PASS" ? "PASS" : "INVESTIGATE",
      ruleIds: editorialContext.careerValue.triggeredRuleIds,
      provenance: [
        ...(verdict ? [{ source: "DECISION_POLICY" as const, ruleIds: editorialContext.careerValue.triggeredRuleIds, signal: "CANONICAL_ENGINE_VERDICT" }] : []),
        ...(capabilityNames.length > 0 ? [{ source: "CAPABILITY_ASSESSMENT" as const, signal: capabilityNames.join(", ") }] : []),
        ...(inventory.hasExplicitEvidence ? [{ source: "JOB_REQUIREMENT" as const, signal: "EXPLICIT_JD_EVIDENCE" }] : []),
      ],
    };
    const executiveThesis: ExecutiveThesis = {
      verdict,
      headline,
      careerValueSignal: explanation.careerValueSignal,
      primaryReason,
      tradeoff: explanation.tradeoff,
      relativeDifferentiator: editorialContext.careerValue.relativeDifferentiator,
      ruleIds: explanation.ruleIds,
      explanation,
    };
    const pursuitStrategy = PursuitStrategyResolver.resolve(explanation, editorialContext);
    const resolvedRecommendedAction = recordedRecommendedAction ?? pursuitStrategy.immediateNextAction;
    const resolvedPursuitStrategy: PursuitStrategy = {
      ...pursuitStrategy,
      immediateNextAction: resolvedRecommendedAction,
    };
    const explicitProofs = inventory.sourceGroundedQuotes.slice(0, 3);
    const substantiveProofs = BriefCompositionEngine.substantiveOpportunityProofs(opportunity);
    const proofPoints = [
      ...explicitProofs.map((quote) => ({ category: "Direct Evidence" as const, headline: "Published role evidence", detail: quote })),
      ...substantiveProofs,
    ].filter((point, index, points) => points.findIndex((candidate) => candidate.headline === point.headline && candidate.detail === point.detail) === index).slice(0, 4);
    const unknowns: RankedUnknown[] = [];
    if (inventory.reportingLineQuotes.length === 0) {
      unknowns.push({ rank: "CRITICAL", label: "Reporting line", question: "What reporting line is assigned to this role?" });
    }
    if (inventory.commercialAccountabilityQuotes.length === 0) {
      unknowns.push({ rank: "IMPORTANT", label: "Commercial ownership", question: "What commercial, budget, or P&L accountability is assigned to this role?" });
    }
    if (inventory.decisionRightsQuotes.length === 0) {
      unknowns.push({ rank: "IMPORTANT", label: "Decision rights", question: "Which decisions and approvals sit with this role?" });
    }
    const partial = this.composeEvidenceLimitedBrief(
      opportunity,
      editorialContext,
      "Some published role facts are not established; the sections below retain only recorded evidence and RADAR assessments.",
    );
    const qualityScore = opportunity.engineRecommendation?.vetoed
      ? null
      : opportunity.engineRecommendation?.qualityScore ?? null;
    const qualitativeRecommendation: BriefModel["qualitativeRecommendation"] = verdict === "PURSUE"
      ? "Strong Pursue Recommendation"
      : verdict === "CONSIDER"
      ? "Conditional Consideration"
      : verdict === "PASS"
      ? "Strategic Pass"
      : "Pending Assessment";

    return {
      ...partial,
      executiveThesis,
      explanation,
      pursuitStrategy: resolvedPursuitStrategy,
      executiveOpinion: primaryReason,
      memory: {
        headline,
        retentionSentence: recordedPrimaryDriver ?? `${role} at ${company}; published role evidence remains partial.`,
        primaryOpportunity: recordedPrimaryDriver ?? (capabilityNames.length > 0 ? capabilityAssessment : "Verify the published mandate before investing further effort."),
        primaryRisk: recordedPrimaryRisk ?? unknowns[0]?.question ?? "Published role facts remain partial.",
        recommendedAction: resolvedRecommendedAction,
        decision,
        tradeoff: careerAssessment,
        first90Days: "Not assessed from the available published evidence.",
        whyNow: recordedWhyNow ?? `The role is listed at ${company}; RADAR's assessment and published evidence are shown separately.`,
      },
      structuredSections: {
        context: { thesis: primaryReason },
        mandate: { thesis: mandateEvidence.length > 0 ? `Published mandate: ${mandateEvidence.join(" ")}` : "Published mandate not established." },
        synthesis: { thesis: careerAssessment },
        evidence: { thesis: proofPoints.length > 0 ? "Published and recorded candidate evidence is listed below." : "No source-grounded proof point is recorded." },
        strategy: { thesis: resolvedRecommendedAction },
      },
      oneMinuteTLDR: {
        whyPursue: this.uniqueTexts([recordedPrimaryDriver, mandateEvidence[0], capabilityNames.length > 0 ? capabilityAssessment : null]),
        watchFor: this.uniqueTexts([recordedPrimaryRisk, ...unknowns.map((unknown) => unknown.question)]),
        bottomLine: primaryReason,
      },
      qualitativeReasoning: [
        ...(recordedPrimaryDriver ? [{ layer: "Recorded RADAR assessment", ratingLabel: "Requires Verification" as const, becausePoints: [recordedPrimaryDriver], evidenceSnippet: recordedPrimaryDriver }] : []),
        ...(capabilityNames.length > 0 ? [{ layer: "Capability assessment", ratingLabel: "Requires Verification" as const, becausePoints: capabilityNames, evidenceSnippet: capabilityAssessment }] : []),
        ...(mandateEvidence.length > 0 ? [{ layer: "Published mandate", ratingLabel: "Requires Verification" as const, becausePoints: mandateEvidence, evidenceSnippet: mandateEvidence[0] }] : []),
      ],
      qualitativeReasoningChain: [
        ...(recordedPrimaryDriver ? [{ layer: "Recorded RADAR assessment", ratingLabel: "Requires Verification" as const, becausePoints: [recordedPrimaryDriver], evidenceSnippet: recordedPrimaryDriver }] : []),
        ...(capabilityNames.length > 0 ? [{ layer: "Capability assessment", ratingLabel: "Requires Verification" as const, becausePoints: capabilityNames, evidenceSnippet: capabilityAssessment }] : []),
        ...(mandateEvidence.length > 0 ? [{ layer: "Published mandate", ratingLabel: "Requires Verification" as const, becausePoints: mandateEvidence, evidenceSnippet: mandateEvidence[0] }] : []),
      ],
      strategicUpside: { headline: "RADAR career assessment", points: inventory.hasCareerAssessment ? [careerAssessment] : [] },
      decisionSensitivity: { becomesPursueIf: [], becomesPassIf: [] },
      rankedUnknowns: unknowns,
      deliverablesWork: explicitProofs,
      deliverablesValue: [],
      deliverablesProvenance: explicitProofs.map(() => "Observed in JD"),
      deliverables: { workRequired: explicitProofs, businessValue: [], provenance: explicitProofs.map(() => "Observed in JD") },
      proofPoints,
      fitProofs: substantiveProofs.map((proof) => proof.detail),
      certaintyLevel: inventory.hasExplicitEvidence && inventory.hasCanonicalEvaluation ? "MEDIUM" : "LOW",
      certaintyGuidance: "Partial dossier: claims are limited to published evidence and recorded RADAR assessments.",
      evidenceQuality: editorialContext.evidence?.evidenceQuality || "Inferred Evidence",
      qualitativeRecommendation,
      qualityScore,
      whyNotStronger: unknowns.length > 0 ? `Verification required: ${unknowns.map((unknown) => unknown.label.toLowerCase()).join(", ")}.` : undefined,
      topUnknownPreview: unknowns[0] ? `Unknown: ${unknowns[0].label}` : undefined,
      strategy: { focusTitle: "Evidence-led verification", heroAnchor: resolvedRecommendedAction },
      narrative: { intent: "Use published evidence and the recorded RADAR assessment; verify remaining role facts." },
      verdictGuidance: { actionNotice: resolvedRecommendedAction, tradeoffStatement: careerAssessment, pauseTrigger: unknowns[0]?.question || "No additional role fact is required." },
      directives: { action: resolvedRecommendedAction },
    };
  }

  private static recordedText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  private static uniqueTexts(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
  }

  /**
   * The only permitted fallback for sparse or unevaluated opportunities. It is
   * intentionally factual and useful, rather than a generic recommendation.
   */
  private static composeEvidenceLimitedBrief(
    opportunity: Opportunity,
    editorialContext: EditorialContext,
    limitation: string,
  ): BriefModel {
    const role = opportunity.role || "This role";
    const company = opportunity.company || "the company";
    const location = opportunity.location || "the listed location";
    const headline = `Assessment pending: ${role} at ${company}.`;
    const explanation: ExecutiveDecisionExplanation = {
      verdict: null,
      headline,
      bottomLine: limitation,
      primaryReason: limitation,
      supportingReasons: [],
      careerValueSignal: null,
      tradeoff: null,
      evidenceStrength: "INSUFFICIENT",
      keyUncertainty: "The published mandate, reporting line, and decision rights require verification.",
      recommendedAction: "INVESTIGATE",
      ruleIds: ["SPARSE_SPECIFICATION"],
      provenance: [{ source: "JOB_REQUIREMENT", signal: "INSUFFICIENT_EVIDENCE" }],
    };
    const executiveThesis: ExecutiveThesis = {
      verdict: null,
      headline,
      careerValueSignal: null,
      primaryReason: limitation,
      tradeoff: null,
      relativeDifferentiator: null,
      ruleIds: explanation.ruleIds,
      explanation,
    };
    const pursuitStrategy = PursuitStrategyResolver.resolve(explanation, editorialContext);
    const questions: RankedUnknown[] = [
      { rank: "CRITICAL", label: "Mandate and reporting line", question: "What business outcome, reporting line, and decision rights are assigned to this role?" },
      { rank: "IMPORTANT", label: "Team and resources", question: "What team, budget, and hiring authority are already approved?" },
      { rank: "SECONDARY", label: "Compensation", question: "What are the base, variable, and equity components?" },
    ];
    const safePoints = [
      `Published identity: ${role} at ${company}.`,
      `Listed location: ${location}.`,
    ];

    return {
      editorialContext,
      executiveThesis,
      explanation,
      pursuitStrategy,
      memory: {
        headline,
        retentionSentence: `Published details for ${role} at ${company} require validation before a recommendation can be made.`,
        primaryOpportunity: "Complete mandate verification before allocating application effort.",
        primaryRisk: "The published specification does not establish operating scope, reporting line, or decision rights.",
        recommendedAction: "INVESTIGATE",
        decision: null,
        tradeoff: "Do not infer mandate scope from title alone.",
        first90Days: "Not assessed until the role specification is verified.",
        whyNow: "The role is listed, but the available evidence is insufficient for an executive conclusion.",
      },
      structuredSections: {
        context: { thesis: limitation, transition: "Verify the core mandate before deciding whether the role warrants further time." },
        mandate: { thesis: "Mandate not established from the published evidence." },
        synthesis: { thesis: limitation },
        evidence: { thesis: "No recommendation-level evidence has been established." },
        strategy: { thesis: "Use the initial conversation to establish scope before tailoring an application." },
      },
      oneMinuteTLDR: {
        whyPursue: safePoints,
        watchFor: ["Reporting line and decision rights are not established.", "Team, budget, and compensation require confirmation."],
        bottomLine: "Investigate before investing application effort.",
      },
      qualitativeReasoning: [{ layer: "Evidence Availability", ratingLabel: "Requires Verification", becausePoints: ["Published details are limited"], evidenceSnippet: limitation }],
      qualitativeReasoningChain: [{ layer: "Evidence Availability", ratingLabel: "Requires Verification", becausePoints: ["Published details are limited"], evidenceSnippet: limitation }],
      strategicUpside: { headline: "Evidence Required", points: safePoints },
      decisionSensitivity: {
        becomesPursueIf: ["The recruiter confirms a mandate that matches the evaluated candidate criteria."],
        becomesPassIf: ["The confirmed scope, reporting line, or work model conflicts with the candidate criteria."],
      },
      rankedUnknowns: questions,
      deliverablesWork: [],
      deliverablesValue: [],
      deliverablesProvenance: [],
      deliverables: { workRequired: [], businessValue: [], provenance: [] },
      proofPoints: [],
      fitProofs: [],
      certaintyLevel: "LOW",
      certaintyGuidance: limitation,
      evidenceQuality: "Inferred Evidence",
      qualitativeRecommendation: "Pending Assessment",
      qualityScore: null,
      whyNotStronger: limitation,
      topUnknownPreview: "Critical Unknown: mandate, reporting line, and decision rights are not established.",
      strategy: { focusTitle: "Scope Verification Required", heroAnchor: `Verify the published scope for ${role} at ${company}.` },
      narrative: { intent: "Verify the mandate before deciding." },
      verdictGuidance: {
        actionNotice: "INVESTIGATE",
        tradeoffStatement: "Do not infer mandate scope from title alone.",
        pauseTrigger: "Pause application work until the core role specification is confirmed.",
      },
      executiveOpinion: limitation,
      directives: { action: "Confirm mandate, reporting line, and resources during the initial recruiter conversation." },
    };
  }

  private static clipEvidence(
    value: string | null | undefined,
    max = 220,
  ): string | null {
    if (typeof value !== "string") return null;

    const text = value.replace(/\s+/g, " ").trim();
    if (!text) return null;

    if (text.length <= max) return text;

    const clipped = text.slice(0, max);
    const boundary = clipped.lastIndexOf(" ");

    return `${clipped.slice(0, boundary > 80 ? boundary : max).trim()}…`;
  }

  private static lowerFirst(value: string): string {
    if (!value) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
  }

  private static substantiveOpportunityProofs(
    opportunity: Opportunity,
  ): ProofPointItem[] {
    const proofs: ProofPointItem[] = [];

    const primary = opportunity.primaryProof;
    const primaryDetail =
      substantiveCandidateEvidence(primary?.detail);

    if (
      primary
      && typeof primary.headline === "string"
      && primary.headline.trim()
      && primaryDetail
    ) {
      proofs.push({
        category: "Transferable Experience",
        headline: primary.headline.trim(),
        detail: primaryDetail,
      });
    }

    for (const dimension of opportunity.dimensions || []) {
      const proof = dimension.candidateProof;
      const detail = substantiveCandidateEvidence(proof?.detail);

      if (
        proof
        && typeof proof.headline === "string"
        && proof.headline.trim()
        && detail
      ) {
        proofs.push({
          category: "Transferable Experience",
          headline: proof.headline.trim(),
          detail,
        });
      }
    }

    return proofs.filter(
      (proof, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.headline === proof.headline
            && candidate.detail === proof.detail,
        ) === index,
    );
  }

  private static buildGroundedUnknowns(
    opportunity: Opportunity,
    inventory: SectionEvidenceInventory,
    recordedRisk: string | null,
    primaryRoleEvidence: string | null,
    verdict: string | null,
  ): RankedUnknown[] {
    if (verdict === "PASS") {
      return [];
    }

    const context = [
      opportunity.role,
      recordedRisk,
      primaryRoleEvidence,
      opportunity.primaryDriver,
      opportunity.positioning,
    ]
      .filter((value): value is string =>
        typeof value === "string" && value.trim().length > 0,
      )
      .join(" ");

    const unknowns: RankedUnknown[] = [];

    if (inventory.reportingLineQuotes.length === 0) {
      unknowns.push({
        rank: "CRITICAL",
        label: "Reporting line",
        question:
          `Who does the ${opportunity.role} role report to, and where does escalation authority sit?`,
      });
    }

    if (
      inventory.decisionRightsQuotes.length === 0
      && /director|head|vice president|\bvp\b|business head|operations/i.test(
        opportunity.role || "",
      )
    ) {
      unknowns.push({
        rank: "IMPORTANT",
        label: "Decision rights",
        question:
          `Which decisions can the ${opportunity.role} role make independently, and which require approval?`,
      });
    }

    const commercialRelevance =
      /commercial|revenue|sales|p\s*&\s*l|profit|margin|budget|business head/i.test(
        context,
      );

    if (
      commercialRelevance
      && inventory.commercialAccountabilityQuotes.length === 0
    ) {
      unknowns.push({
        rank: "IMPORTANT",
        label: "Commercial ownership",
        question:
          `What commercial outcome or budget, if any, is directly owned by the ${opportunity.role} role?`,
      });
    }

    const max =
      verdict === "PURSUE"
        ? 2
        : 3;

    return unknowns.slice(0, max);
  }

  private static composeGroundedCanonicalBrief(
    opportunity: Opportunity,
    editorialContext: EditorialContext,
    inventory: SectionEvidenceInventory,
    policy: {
      maxUnknowns?: number;
      maxEvidence?: number;
      maxDeliverables?: number;
    },
    editorialIntelligence?: EditorialIntelligenceContract,
  ): BriefModel {
    const role = opportunity.role || "This role";
    const company = opportunity.company || "the company";

    const verdict = editorialIntelligence?.verdict
      ?? (
      editorialContext.engineVerdict === "PURSUE"
      || editorialContext.engineVerdict === "CONSIDER"
      || editorialContext.engineVerdict === "PASS"
        ? editorialContext.engineVerdict
        : null);

    const decision: BriefMemory["decision"] = verdict;

    const recordedDriver = editorialIntelligence?.careerCase
      ?? this.recordedText(opportunity.primaryDriver);

    const recordedRisk = editorialIntelligence?.principalRisk
      ?? this.recordedText(opportunity.primaryRisk)
      ?? this.recordedText(opportunity.hiringRisk);

    const recordedWhyNow = editorialIntelligence?.whyNow
      ?? this.recordedText(opportunity.whyNow);

    const recordedAction = editorialIntelligence?.recommendedAction
      ?? this.recordedText(opportunity.recommendedAction);

    const recordedPositioning = editorialIntelligence?.positioningAngles[0]
      ?? this.recordedText(opportunity.positioning);

    const careerDifferentiator = editorialIntelligence?.careerTradeoff
      ?? this.recordedText(
        editorialContext.careerValue.relativeDifferentiator,
      );

    const trajectoryUpside =
      editorialContext.careerValue.trajectoryUpside
        ? String(editorialContext.careerValue.trajectoryUpside)
        : null;

    const capabilityNames = editorialIntelligence?.capabilityMatches
      ?? (editorialContext.capability?.matchedCapabilities
        ?.filter(Boolean)
        .slice(0, 3)
      || []);

    const capabilityAssessment =
      capabilityNames.length > 0
        ? `RADAR sees the strongest capability overlap in ${capabilityNames.join(", ")}.`
        : null;

    const roleEvidence = editorialIntelligence
      ? editorialIntelligence.publishedRoleOutcomes.map((outcome) => outcome.statement)
      : this.uniqueTexts([
      ...inventory.mandateQuotes,
      ...inventory.functionalScopeQuotes,
      ...inventory.sourceGroundedQuotes,
    ])
      .map((quote) => this.clipEvidence(quote))
      .filter((quote): quote is string => Boolean(quote))
      .slice(0, policy.maxDeliverables ?? 3);

    const primaryRoleEvidence =
      roleEvidence[0] ?? null;

    const candidateProofs = editorialIntelligence
      ? editorialIntelligence.candidatePrecedents.map((precedent) => ({
          category: "Candidate precedent" as const,
          headline: `Candidate precedent: ${precedent.capability}`,
          detail: precedent.statement,
        }))
      : this.substantiveOpportunityProofs(opportunity)
        .slice(0, policy.maxEvidence ?? 3);

    const primaryCandidateProof =
      candidateProofs[0] ?? null;

    const attentionThesis =
      primaryCandidateProof && primaryRoleEvidence
        ? `${primaryCandidateProof.detail} is the clearest transferable precedent for a ${role} brief whose published work includes ${this.lowerFirst(primaryRoleEvidence)}`
        : recordedDriver && primaryRoleEvidence
        ? `${recordedDriver} The published role evidence makes the opportunity more specific: ${primaryRoleEvidence}`
        : primaryCandidateProof
        ? `${primaryCandidateProof.detail} is the strongest recorded reason this ${role} opportunity deserves attention.`
        : recordedDriver
        ? recordedDriver
        : careerDifferentiator
        ? `The career case for ${role} at ${company} is ${this.lowerFirst(careerDifferentiator)}`
        : primaryRoleEvidence
        ? `The ${role} opportunity is worth examining because the published work includes ${this.lowerFirst(primaryRoleEvidence)}`
        : capabilityAssessment
        ? capabilityAssessment
        : `RADAR has a canonical ${verdict || "evaluated"} assessment for ${role} at ${company}, but the published role detail remains limited.`;

    const formalMandate = editorialIntelligence
      ? editorialIntelligence.publishedRoleOutcomes.find((outcome) => outcome.dimensionKey === "mandate")?.statement ?? null
      : (inventory.mandateQuotes[0] ? this.clipEvidence(inventory.mandateQuotes[0]) : null);

    const successThesis =
      formalMandate
        ? `The published mandate is explicit: ${formalMandate}`
        : roleEvidence.length > 0
        ? "The published description establishes concrete work and outcomes, but it does not establish formal authority."
        : "The role has been evaluated, but formal operating authority is not published.";

    const successBody =
      roleEvidence.length > 0
        ? roleEvidence.map((quote) => `• ${quote}`).join("\n")
        : undefined;

    const unknowns = (
      editorialIntelligence
        ? editorialIntelligence.decisionHinges.map((hinge) => ({
            rank: "IMPORTANT" as const,
            label: hinge.topic,
            question: hinge.question,
          }))
        : this.buildGroundedUnknowns(
        opportunity,
        inventory,
        recordedRisk,
        primaryRoleEvidence,
        verdict,
      )
    ).slice(0, policy.maxUnknowns ?? 3);

    const riskStatement =
      recordedRisk
        ?? (
          unknowns[0]
            ? `The first unresolved issue is ${this.lowerFirst(
                unknowns[0].question.replace(/\?$/, ""),
              )}.`
            : null
        );

    const careerAssessment =
      careerDifferentiator
        ? `RADAR career assessment: ${careerDifferentiator}`
        : trajectoryUpside
        ? `RADAR trajectory assessment: ${trajectoryUpside}`
        : null;

    const explanationPrimaryReason =
      attentionThesis;

    const explanation: ExecutiveDecisionExplanation = {
      verdict,
      headline: attentionThesis,
      bottomLine:
        verdict === "PASS"
          ? (
              careerAssessment
              ?? recordedDriver
              ?? `RADAR does not recommend allocating further search bandwidth to ${role} at ${company}.`
            )
          : riskStatement
          ? `${attentionThesis} The decision hinges on ${this.lowerFirst(riskStatement)}`
          : attentionThesis,
      primaryReason: explanationPrimaryReason,
      supportingReasons: this.uniqueTexts([
        careerAssessment,
        riskStatement,
        primaryCandidateProof?.detail,
      ]),
      careerValueSignal:
        editorialContext.careerValue.trajectoryUpside
          ? String(editorialContext.careerValue.trajectoryUpside)
          : null,
      tradeoff:
        careerDifferentiator,
      evidenceStrength:
        inventory.hasExplicitEvidence
          ? "LIMITED"
          : "INSUFFICIENT",
      keyUncertainty:
        verdict === "PURSUE"
          ? null
          : (unknowns[0]?.question ?? null),
      recommendedAction:
        verdict === "PASS"
          ? "PASS"
          : "INVESTIGATE",
      ruleIds:
        editorialContext.careerValue.triggeredRuleIds,
      provenance: [
        ...(verdict
          ? [{
              source: "DECISION_POLICY" as const,
              ruleIds:
                editorialContext.careerValue.triggeredRuleIds,
              signal: "CANONICAL_ENGINE_VERDICT",
            }]
          : []),
        ...(capabilityNames.length > 0
          ? [{
              source: "CAPABILITY_ASSESSMENT" as const,
              signal: capabilityNames.join(", "),
            }]
          : []),
        ...(inventory.hasExplicitEvidence
          ? [{
              source: "JOB_REQUIREMENT" as const,
              signal: "EXPLICIT_JD_EVIDENCE",
            }]
          : []),
      ],
    };

    const executiveThesis: ExecutiveThesis = {
      verdict,
      headline: attentionThesis,
      careerValueSignal: explanation.careerValueSignal,
      primaryReason: explanation.primaryReason,
      tradeoff: explanation.tradeoff,
      relativeDifferentiator:
        editorialContext.careerValue.relativeDifferentiator,
      ruleIds: explanation.ruleIds,
      explanation,
    };

    const pursuitStrategy =
      PursuitStrategyResolver.resolve(
        explanation,
        editorialContext,
      );

    const resolvedRecommendedAction =
      recordedAction
      ?? pursuitStrategy.immediateNextAction;

    const resolvedPursuitStrategy: PursuitStrategy = {
      ...pursuitStrategy,
      immediateNextAction:
        resolvedRecommendedAction,
    };

    const positioningAdvice =
      recordedPositioning
        ?? (
          primaryCandidateProof
            ? `Lead with ${primaryCandidateProof.headline.toLowerCase()}: ${primaryCandidateProof.detail}`
            : capabilityNames.length > 0
            ? `Anchor the conversation in ${capabilityNames.join(", ")}, then use the first discussion to test the unresolved scope questions.`
            : `Use the first conversation to connect your strongest relevant operating precedent to the published ${role} work.`
        );

    const bottomLine =
      verdict === "PURSUE"
        ? riskStatement
          ? `${attentionThesis} Move now, but test ${this.lowerFirst(riskStatement)}`
          : `${attentionThesis} There is enough signal to justify focused outreach now.`
        : verdict === "CONSIDER"
        ? riskStatement
          ? `${attentionThesis} The role becomes worth deeper investment only if ${this.lowerFirst(riskStatement)} resolves favorably.`
          : `${attentionThesis} Clarify the remaining scope before committing significant interview time.`
        : verdict === "PASS"
        ? (
            careerAssessment
            ?? recordedDriver
            ?? `The role does not justify further search bandwidth relative to stronger opportunities.`
          )
        : attentionThesis;

    const contextBody =
      this.uniqueTexts([
        careerAssessment,
        recordedWhyNow,
        primaryRoleEvidence,
      ])
        .filter((value) => value !== attentionThesis)
        .join(" ");

    const proofPoints: ProofPointItem[] = [
      ...candidateProofs,
      ...roleEvidence
        .slice(0, 2)
        .map((quote) => ({
          category: "Direct Evidence" as const,
          headline: "Published role evidence",
          detail: quote,
        })),
    ]
      .filter(
        (point, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.headline === point.headline
              && candidate.detail === point.detail,
          ) === index,
      )
      .slice(0, 4);

    const qualitativeReasoningChain: QualitativeReasoningRow[] = [
      ...(recordedDriver
        ? [{
            layer: "RADAR career thesis",
            ratingLabel:
              verdict === "PURSUE"
                ? "Strong Alignment" as const
                : verdict === "CONSIDER"
                ? "Adjacent Alignment" as const
                : "Limited Upside" as const,
            becausePoints: [recordedDriver],
            evidenceSnippet: recordedDriver,
          }]
        : []),

      ...(primaryCandidateProof
        ? [{
            layer: "Candidate precedent",
            ratingLabel: "Strong Alignment" as const,
            becausePoints: [
              primaryCandidateProof.headline,
            ],
            evidenceSnippet:
              primaryCandidateProof.detail,
          }]
        : []),

      ...(primaryRoleEvidence
        ? [{
            layer: "Published role signal",
            ratingLabel: "Requires Verification" as const,
            becausePoints: [primaryRoleEvidence],
            evidenceSnippet: primaryRoleEvidence,
          }]
        : []),

      ...(riskStatement
        ? [{
            layer: "Decision risk",
            ratingLabel: "Requires Verification" as const,
            becausePoints: [riskStatement],
            evidenceSnippet: riskStatement,
          }]
        : []),
    ];

    const certaintyLevel: BriefModel["certaintyLevel"] =
      inventory.hasCanonicalEvaluation
      && inventory.hasExplicitEvidence
      && candidateProofs.length > 0
        ? "HIGH"
        : inventory.hasCanonicalEvaluation
          && (
            inventory.hasExplicitEvidence
            || candidateProofs.length > 0
          )
        ? "MEDIUM"
        : "LOW";

    const qualitativeRecommendation:
      BriefModel["qualitativeRecommendation"] =
        verdict === "PURSUE"
          ? "Strong Pursue Recommendation"
          : verdict === "CONSIDER"
          ? "Conditional Consideration"
          : verdict === "PASS"
          ? "Strategic Pass"
          : "Pending Assessment";

    return {
      editorialContext,
      executiveThesis,
      explanation,
      pursuitStrategy:
        resolvedPursuitStrategy,

      executiveOpinion:
        riskStatement
          ? `${attentionThesis} The first thing I would test is ${this.lowerFirst(riskStatement)}`
          : attentionThesis,

      directives: {
        reflection:
          careerAssessment ?? undefined,
        action:
          resolvedRecommendedAction,
        observation:
          riskStatement ?? undefined,
        positioning:
          positioningAdvice,
      },

      memory: {
        headline:
          attentionThesis,

        retentionSentence:
          careerAssessment
            ?? capabilityAssessment
            ?? `${role} at ${company}: ${verdict || "evaluated"} opportunity.`,

        primaryOpportunity:
          primaryRoleEvidence
            ?? recordedDriver
            ?? attentionThesis,

        primaryRisk:
          riskStatement
            ?? "No material structural risk is recorded beyond normal executive due diligence.",

        recommendedAction:
          resolvedRecommendedAction,

        decision,

        tradeoff:
          careerAssessment
            ?? "Evaluate the role against current career trajectory and search bandwidth.",

        first90Days:
          "Not inferred unless published role evidence establishes it.",

        whyNow:
          recordedWhyNow
            ?? `RADAR has evaluated the ${role} opportunity at ${company}; the decision case is summarized here.`,
      },

      structuredSections: {
        context: {
          thesis:
            attentionThesis,
          body:
            contextBody || undefined,
          transition:
            riskStatement
              ? `The next question is whether ${this.lowerFirst(riskStatement)}`
              : undefined,
        },

        mandate: {
          thesis:
            successThesis,
          body:
            successBody,
          transition:
            unknowns[0]
              ? `The remaining issue is ${this.lowerFirst(unknowns[0].question)}`
              : undefined,
        },

        synthesis: {
          thesis:
            careerAssessment
            ?? recordedDriver
            ?? attentionThesis,
        },

        evidence: {
          thesis:
            candidateProofs.length > 0
              ? "The strongest candidate precedent and relevant published role evidence are below."
              : roleEvidence.length > 0
              ? "Published role evidence is available, but RADAR does not have a substantive candidate precedent recorded for this requirement."
              : "No substantive candidate precedent or published role proof is recorded.",
        },

        strategy: {
          thesis:
            resolvedRecommendedAction,
          body:
            positioningAdvice,
        },
      },

      oneMinuteTLDR: {
        whyPursue:
          this.uniqueTexts([
            attentionThesis,
            careerAssessment,
            primaryCandidateProof?.detail,
          ]).slice(0, 3),

        watchFor:
          this.uniqueTexts([
            riskStatement,
            ...unknowns.map(
              (unknown) => unknown.question,
            ),
          ]).slice(0, 3),

        bottomLine,
      },

      qualitativeReasoning:
        qualitativeReasoningChain,

      qualitativeReasoningChain,

      strategicUpside: {
        headline:
          verdict === "PASS"
            ? "Career trade-off"
            : "Strategic career case",
        points:
          this.uniqueTexts([
            careerAssessment,
            recordedDriver,
            primaryCandidateProof?.detail,
          ]).slice(0, 3),
      },

      decisionSensitivity: {
        becomesPursueIf:
          verdict === "CONSIDER"
          && unknowns[0]
            ? [
                `The ${unknowns[0].label.toLowerCase()} question resolves in favor of materially broader scope.`,
              ]
            : [],

        becomesPassIf:
          recordedRisk
            ? [
                `The recorded risk is confirmed and materially reduces the career or operating value of the role.`,
              ]
            : [],
      },

      rankedUnknowns:
        unknowns,

      deliverablesWork:
        roleEvidence,

      deliverablesValue:
        [],

      deliverablesProvenance:
        roleEvidence.map(
          () => "Observed in JD" as const,
        ),

      deliverables: {
        workRequired:
          roleEvidence,
        businessValue:
          [],
        provenance:
          roleEvidence.map(
            () => "Observed in JD" as const,
          ),
      },

      proofPoints,

      fitProofs:
        candidateProofs.map(
          (proof) => proof.detail,
        ),

      certaintyLevel,

      certaintyGuidance:
        certaintyLevel === "HIGH"
          ? "Canonical evaluation, published role evidence, and substantive candidate precedent are all present."
          : certaintyLevel === "MEDIUM"
          ? "The recommendation is usable, but one side of the evidence chain remains incomplete."
          : "The canonical recommendation is available, but supporting role or candidate evidence remains limited.",

      evidenceQuality:
        editorialContext.evidence?.evidenceQuality
          || "Inferred Evidence",

      qualitativeRecommendation,

      qualityScore:
        editorialIntelligence
          ? editorialIntelligence.qualityScore
          : opportunity.engineRecommendation?.vetoed
          ? null
          : (
              opportunity.engineRecommendation?.qualityScore
              ?? null
            ),

      whyNotStronger:
        riskStatement
          ?? undefined,

      frictionPreview:
        recordedRisk
          ?? undefined,

      topUnknownPreview:
        unknowns[0]
          ? `${unknowns[0].label}: ${unknowns[0].question}`
          : undefined,

      strategy: {
        focusTitle:
          verdict === "PURSUE"
            ? "Convert the strongest signal"
            : verdict === "CONSIDER"
            ? "Resolve the decision hinge"
            : verdict === "PASS"
            ? "Preserve search bandwidth"
            : "Clarify the opportunity",

        heroAnchor:
          resolvedRecommendedAction,
      },

      narrative: {
        intent:
          positioningAdvice,
      },

      verdictGuidance: {
        actionNotice:
          resolvedRecommendedAction,

        tradeoffStatement:
          careerAssessment
            ?? bottomLine,

        pauseTrigger:
          riskStatement
            ?? unknowns[0]?.question
            ?? "No additional pause trigger is recorded.",
      },
    };
  }

}
