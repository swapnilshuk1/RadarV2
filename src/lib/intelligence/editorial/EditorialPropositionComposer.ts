import type {
  CandidateCapabilitySignal,
  CandidatePrecedent,
  CanonicalEditorialSignal,
  EditorialIntelligenceContract,
  PublishedQualificationRequirement,
  PublishedRoleContext,
  PublishedRoleWork,
} from "./EditorialIntelligenceContract";

/**
 * Phase 3's read-only composition model.  It intentionally accepts the
 * already-built editorial contract, never a job document, projection builder,
 * evaluator, or score engine.
 */
export type EditorialPropositionKind =
  | "EMPLOYER_FACT"
  | "CANDIDATE_FACT"
  | "CANONICAL_EVALUATION"
  | "RADAR_INFERENCE"
  | "EVIDENCE_LIMITATION";

export type EditorialCompositionMode =
  | "COMMERCIAL_LEADERSHIP"
  | "OPERATING_LEADERSHIP"
  | "FUNCTIONAL_SPECIALIST"
  | "PRODUCT_LEADERSHIP"
  | "TRANSFORMATION"
  | "ADVISORY_CONSULTING"
  | "EXECUTION_HEAVY"
  | "SPARSE_AMBIGUOUS";

export interface EditorialProposition {
  id: string;
  kind: EditorialPropositionKind;
  text: string;
  roleEvidenceIds: string[];
  candidateEvidenceIds: string[];
  canonicalSignalIds: string[];
  semanticKey: string;
  priority: number;
}

/** A persisted evaluator relationship selected for reader-facing positioning. */
export interface EditorialPositioningRelation {
  kind: "EVALUATOR_RELATION";
  basis: "CANONICAL_EVALUATION";
  traceRelationshipId: string;
  roleEvidenceIds: string[];
  candidateEvidenceIds: string[];
  canonicalSignalIds: string[];
  sharedConcepts: string[];
}

export interface EditorialCompositionSection {
  headline: string | null;
  propositions: EditorialProposition[];
}

export interface EditorialCompositionV2 {
  version: "editorial-composition-v2";
  compositionMode: EditorialCompositionMode;
  positioningRelations: EditorialPositioningRelation[];
  propositions: EditorialProposition[];
  sections: {
    hero: EditorialCompositionSection;
    whyAttention: EditorialCompositionSection;
    mandate: EditorialCompositionSection;
    candidatePositioning: EditorialCompositionSection;
    bottomLine: EditorialCompositionSection;
    howToWin: EditorialCompositionSection;
    verify: EditorialCompositionSection;
  };
  coverage: {
    hasRoleMandate: boolean;
    hasQualifications: boolean;
    hasCandidatePositioning: boolean;
    hasCanonicalEvaluation: boolean;
    scalarOnly: boolean;
  };
}

const GENERIC_TOKENS = new Set([
  "and", "the", "with", "from", "this", "that", "for", "role", "work",
  "business", "management", "leadership", "strategy", "commercial", "growth",
  "operations", "executive", "team", "across", "your", "candidate", "performance",
  "marketing", "sales", "digital", "service", "delivery", "experience",
  "design", "model", "ownership", "accountability", "planning", "analysis", "analytics",
]);

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function semanticKey(value: string): string {
  const tokens = normalized(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const filtered = tokens
    .filter((token) => token.length > 2 && !GENERIC_TOKENS.has(token))
    .sort()
    .join("|");
  if (filtered.length > 0) return filtered;
  return tokens.sort().join("|") || "proposition";
}

function proposition(
  kind: EditorialPropositionKind,
  text: string,
  refs: Pick<EditorialProposition, "roleEvidenceIds" | "candidateEvidenceIds" | "canonicalSignalIds">,
  priority: number,
  suffix: string,
): EditorialProposition {
  const clean = normalized(text);
  const key = semanticKey(clean);
  return {
    id: `${kind}:${suffix}:${key || clean.toLowerCase()}`,
    kind,
    text: clean,
    ...refs,
    semanticKey: key,
    priority,
  };
}

function employerWorkProposition(work: PublishedRoleWork, index: number): EditorialProposition {
  return proposition("EMPLOYER_FACT", work.statement, {
    roleEvidenceIds: [work.sourceEvidenceId],
    candidateEvidenceIds: [],
    canonicalSignalIds: [],
  }, work.kind === "OUTCOME" ? 95 - index : 90 - index, `work-${index}`);
}

function qualificationProposition(requirement: PublishedQualificationRequirement, index: number): EditorialProposition {
  return proposition("EMPLOYER_FACT", requirement.statement, {
    roleEvidenceIds: requirement.sourceEvidenceIds,
    candidateEvidenceIds: [],
    canonicalSignalIds: [],
  }, requirement.materiality === "CORE" ? 76 - index : 68 - index, `requirement-${index}`);
}

function contextProposition(context: PublishedRoleContext, index: number): EditorialProposition {
  return proposition("EMPLOYER_FACT", context.statement, {
    roleEvidenceIds: [context.sourceEvidenceId],
    candidateEvidenceIds: [],
    canonicalSignalIds: [],
  }, 60 - index, `context-${index}`);
}

function precedentProposition(precedent: CandidatePrecedent, index: number): EditorialProposition {
  return proposition("CANDIDATE_FACT", precedent.statement, {
    roleEvidenceIds: [],
    candidateEvidenceIds: precedent.evidenceIds,
    canonicalSignalIds: [],
  }, 75 - index, `precedent-${index}`);
}

function capabilityProposition(capability: CandidateCapabilitySignal, index: number): EditorialProposition | null {
  const label = normalized(capability.capability);
  const statement = capability.statement ? normalized(capability.statement) : "";
  if (!label || !statement || capability.evidenceIds.length === 0 || /^[A-Z0-9_]+$/.test(label)) return null;
  return proposition("CANDIDATE_FACT", statement, {
    roleEvidenceIds: [],
    candidateEvidenceIds: capability.evidenceIds,
    canonicalSignalIds: [],
  }, 45 - index, `capability-${index}`);
}

function signalProposition(signal: CanonicalEditorialSignal, index: number): EditorialProposition | null {
  const value = normalized(signal.value);
  // Projection enum values are useful internal signals, but not executive
  // prose. A verdict is readable; other all-caps classifier tokens remain in
  // the contract/appendix but are deliberately omitted from composition.
  if (
    !value
    || signal.kind === "SCORE"
    // A capability-family label is a useful contract key but not a reader
    // proposition. Employer facts and resolved evaluator evidence must carry
    // the narrative, rather than a generic capability inventory label.
    || signal.kind === "CAPABILITY"
    || (signal.kind !== "VERDICT" && (/^[A-Z0-9_]+$/.test(value) || value === "Relevant candidate precedent"))
  ) return null;
  return proposition("CANONICAL_EVALUATION", signal.value, {
    roleEvidenceIds: [],
    candidateEvidenceIds: [],
    canonicalSignalIds: [signal.id],
  }, 55 - index, `signal-${index}`);
}

type CapabilityPositioningPair = {
  candidate: CandidateCapabilitySignal;
  work?: PublishedRoleWork;
  requirement?: PublishedQualificationRequirement;
  jobEvidence?: EditorialIntelligenceContract["candidateFitEvidence"][number]["jobEvidence"][number];
  relation: EditorialPositioningRelation;
};

function substantiveConcepts(values: readonly string[]): string[] {
  return [...new Set(values
    .flatMap((value) => normalized(value).toLowerCase().match(/[a-z0-9&+]{3,}/g) ?? [])
    .filter((token) => !GENERIC_TOKENS.has(token))
    .map((token) => token.replace(/s$/, "")))];
}

function rankFitEvidence(
  fit: EditorialIntelligenceContract["candidateFitEvidence"][number],
  contract: EditorialIntelligenceContract,
): number {
  const jobEvidenceIds = fit.jobEvidenceIds ?? [];
  const work = contract.publishedRoleWork.find((item) => jobEvidenceIds.includes(item.sourceEvidenceId));
  if (work) {
    return work.kind === "OUTCOME" ? 100 : 90;
  }
  const requirement = contract.qualificationRequirements.find((item) =>
    item.sourceEvidenceIds.some((id) => jobEvidenceIds.includes(id)),
  );
  if (requirement) {
    return requirement.materiality === "CORE" ? 80 : 70;
  }
  if (fit.jobEvidence && fit.jobEvidence.length > 0) {
    return 60;
  }
  return 10;
}

function capabilityPositioningPairs(contract: EditorialIntelligenceContract): CapabilityPositioningPair[] {
  const pairs: CapabilityPositioningPair[] = [];
  const matches = contract.candidateFitEvidence.filter((fit) => fit.relationship === "MATCH");
  const sortedMatches = [...matches].sort((a, b) => {
    const diff = rankFitEvidence(b, contract) - rankFitEvidence(a, contract);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  for (const fit of sortedMatches) {
    const candidate = contract.candidateCapabilities.find((item) =>
      item.evidenceIds.some((id) => fit.candidateEvidenceIds.includes(id)),
    );
    const jobEvidenceIds = fit.jobEvidenceIds ?? [];
    const work = contract.publishedRoleWork.find((item) => jobEvidenceIds.includes(item.sourceEvidenceId));
    const requirement = contract.qualificationRequirements.find((item) => item.sourceEvidenceIds.some((id) => jobEvidenceIds.includes(id)));
    const sortedJobEvidence = [...(fit.jobEvidence ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    const jobEvidence = sortedJobEvidence[0];
    // Capability-evidence blobs are not an independently publishable mandate
    // or requirement. Positioning needs a resolved role-work or qualification
    // endpoint, not merely a shared evaluator capability family.
    if (!candidate || (!work && !requirement)) continue;

    const roleEvidenceIds = work
      ? [work.sourceEvidenceId]
      : requirement
        ? requirement.sourceEvidenceIds
      : [];

    pairs.push({
      candidate,
      work,
      requirement,
      jobEvidence,
      relation: {
        kind: "EVALUATOR_RELATION",
        basis: "CANONICAL_EVALUATION",
        traceRelationshipId: fit.id,
        roleEvidenceIds,
        candidateEvidenceIds: fit.candidateEvidenceIds,
        canonicalSignalIds: [fit.id, ...(fit.canonicalSignalId ? [fit.canonicalSignalId] : [])],
        sharedConcepts: [fit.candidateCapabilityKey, fit.jobCapabilityKey].filter(Boolean),
      },
    });
  }
  return pairs.filter((pair, index, all) => all.findIndex((other) => other.candidate === pair.candidate) === index).slice(0, 2);
}

function distinct(propositions: readonly EditorialProposition[]): EditorialProposition[] {
  const seen = new Set<string>();
  return propositions
    .filter((item) => {
      const identity = item.semanticKey || item.text.toLowerCase();
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

function containsAny(values: readonly string[], pattern: RegExp): boolean {
  return values.some((value) => pattern.test(value));
}

export function determineEditorialCompositionMode(contract: EditorialIntelligenceContract): EditorialCompositionMode {
  const employerEvidence = [
    ...contract.publishedRoleWork.map((item) => item.statement),
    ...contract.qualificationRequirements.map((item) => item.statement),
  ];
  const evidence = employerEvidence.length > 0
    ? employerEvidence
    : contract.canonicalSignals.map((item) => item.value);
  if (containsAny(evidence, /\b(?:transform|change management|operating model|turnaround|moderni[sz])\b/i)) return "TRANSFORMATION";
  if (containsAny(evidence, /\b(?:p&l|revenue|pricing|margin|unit economics|forecast|commercial)\b/i)) return "COMMERCIAL_LEADERSHIP";
  if (containsAny(evidence, /\b(?:product|roadmap|platform|customer discovery)\b/i)) return "PRODUCT_LEADERSHIP";
  if (containsAny(evidence, /\b(?:advisory|consulting|client advisory|engagement)\b/i)) return "ADVISORY_CONSULTING";
  if (containsAny(evidence, /\b(?:vendor|service delivery|operations|compliance|quality|supply chain)\b/i)) return "OPERATING_LEADERSHIP";
  if (contract.publishedRoleWork.length >= 3) return "EXECUTION_HEAVY";
  if (contract.qualificationRequirements.length > 0 || contract.publishedRoleWork.length > 0) return "FUNCTIONAL_SPECIALIST";
  return "SPARSE_AMBIGUOUS";
}

function employerInference(
  work: PublishedRoleWork,
  mode: EditorialCompositionMode,
): EditorialProposition {
  const modeDescription: Record<Exclude<EditorialCompositionMode, "SPARSE_AMBIGUOUS">, string> = {
    COMMERCIAL_LEADERSHIP: "a commercially accountable leadership mandate",
    OPERATING_LEADERSHIP: "an operating mandate with execution accountability",
    FUNCTIONAL_SPECIALIST: "a specialist mandate with explicit functional expectations",
    PRODUCT_LEADERSHIP: "a product leadership mandate with delivery accountability",
    TRANSFORMATION: "a transformation mandate with change and execution demands",
    ADVISORY_CONSULTING: "an advisory mandate requiring client-facing judgment",
    EXECUTION_HEAVY: "an execution-heavy mandate with multiple published workstreams",
  };
  const text = mode === "SPARSE_AMBIGUOUS"
    ? `The published work points to a defined mandate: ${work.statement}`
    : `The published work indicates ${modeDescription[mode]}: ${work.statement}`;
  return proposition("RADAR_INFERENCE", text, {
    roleEvidenceIds: [work.sourceEvidenceId],
    candidateEvidenceIds: [],
    canonicalSignalIds: [],
  }, 88, "employer-synthesis");
}

function modeMandateDescription(mode: EditorialCompositionMode): string {
  const descriptions: Record<EditorialCompositionMode, string> = {
    COMMERCIAL_LEADERSHIP: "commercial ownership, economics, and accountable growth",
    OPERATING_LEADERSHIP: "operating control, execution discipline, and delivery accountability",
    FUNCTIONAL_SPECIALIST: "specific functional depth and demonstrable craft expectations",
    PRODUCT_LEADERSHIP: "product direction, customer value, and delivery trade-offs",
    TRANSFORMATION: "change leadership, target-state execution, and cross-functional adoption",
    ADVISORY_CONSULTING: "client judgment, advisory credibility, and stakeholder outcomes",
    EXECUTION_HEAVY: "multiple concrete workstreams requiring disciplined execution",
    SPARSE_AMBIGUOUS: "a mandate that still needs direct scope confirmation",
  };
  return descriptions[mode];
}

function roleStrategyInference(
  work: PublishedRoleWork | undefined,
  requirement: PublishedQualificationRequirement | undefined,
): EditorialProposition {
  if (work) {
    return proposition("RADAR_INFERENCE", "Lead the conversation with the published mandate. Ask how success will be measured, what authority comes with delivery, and where ownership begins and ends.", {
      roleEvidenceIds: [work.sourceEvidenceId], candidateEvidenceIds: [], canonicalSignalIds: [],
    }, 62, "role-strategy");
  }
  if (requirement) {
    return proposition("RADAR_INFERENCE", `Treat this as a published screening requirement, not evidence of the operating mandate: ${requirement.statement} Establish how central it is before making a direct-fit claim.`, {
      roleEvidenceIds: requirement.sourceEvidenceIds, candidateEvidenceIds: [], canonicalSignalIds: [],
    }, 61, "requirement-strategy");
  }
  return proposition("EVIDENCE_LIMITATION", "Use the first conversation to establish the mandate and success conditions before positioning a direct fit.", {
    roleEvidenceIds: [], candidateEvidenceIds: [], canonicalSignalIds: [],
  }, 11, "strategy-limited");
}

function candidatePositioningInference(
  pair: CapabilityPositioningPair | undefined,
): EditorialProposition | null {
  if (!pair) return null;
  const { candidate, work, requirement, jobEvidence } = pair;
  const employer = work ?? requirement ?? jobEvidence;
  if (!employer) return null;
  const scope = work
    ? "published work"
    : requirement
      ? "published requirement"
      : "published capability evidence";
  const employerStatement = employer.statement;
  return proposition("RADAR_INFERENCE", [
    `Position ${candidate.statement ?? candidate.capability} when discussing this evaluator-linked ${scope}: ${employerStatement}.`,
    `The persisted evaluator relationship is between ${pair.relation.sharedConcepts[0] ?? "candidate capability"} and ${pair.relation.sharedConcepts[1] ?? "job capability"}.`,
    "Confirm the employer's required scope before making a direct-fit claim.",
  ].join(" "), {
    roleEvidenceIds: pair.relation.roleEvidenceIds.length
      ? pair.relation.roleEvidenceIds
      : jobEvidence ? [jobEvidence.id] : [],
    candidateEvidenceIds: pair.relation.candidateEvidenceIds,
    canonicalSignalIds: pair.relation.canonicalSignalIds,
  }, 80, "candidate-positioning");
}

function traceBackedFitExplanation(contract: EditorialIntelligenceContract): EditorialProposition | null {
  const eligibleMatches = contract.candidateFitEvidence.filter((fit) =>
    fit.relationship === "MATCH"
    && (fit.candidateEvidenceIds?.length ?? 0) > 0
    && (fit.jobEvidenceIds?.length ?? 0) > 0
    && rankFitEvidence(fit, contract) >= 70,
  );
  if (eligibleMatches.length === 0) return null;

  const sortedMatches = [...eligibleMatches].sort((left, right) => {
    const rankDiff = rankFitEvidence(right, contract) - rankFitEvidence(left, contract);
    if (rankDiff !== 0) return rankDiff;
    return left.id.localeCompare(right.id);
  });

  const relationship = sortedMatches[0];
  const candidate = contract.candidateCapabilities.find((item) =>
    item.evidenceIds.some((id) => relationship.candidateEvidenceIds.includes(id)),
  );
  if (!candidate) return null;
  const candidateFact = candidate.statement ?? candidate.capability;
  const matchedEvidence = relationship.jobEvidence[0];
  const matchedWork = contract.publishedRoleWork.find((item) => relationship.jobEvidenceIds.includes(item.sourceEvidenceId));
  const matchedRequirement = contract.qualificationRequirements.find((item) =>
    item.sourceEvidenceIds.some((id) => relationship.jobEvidenceIds.includes(id)),
  );
  const matchedConcept = (
    matchedWork?.statement
    ?? matchedRequirement?.statement
    ?? matchedEvidence?.statement
    ?? relationship.jobCapabilityKey
    ?? "job evidence"
  );
  const roleEvidenceIds = [
    ...new Set([
      ...relationship.jobEvidenceIds,
      ...relationship.jobEvidence.map((e) => e.id),
    ]),
  ];

  return proposition("CANONICAL_EVALUATION", `The stored evaluator trace links ${candidateFact} to this employer evidence: ${matchedConcept}. The relationship is recorded as ${relationship.relationship.toLowerCase()}.`, {
    roleEvidenceIds,
    candidateEvidenceIds: relationship.candidateEvidenceIds,
    canonicalSignalIds: [relationship.id, ...(relationship.canonicalSignalId ? [relationship.canonicalSignalId] : [])],
  }, 79, "trace-backed-fit");
}

function verificationInference(
  work: PublishedRoleWork | undefined,
  requirement: PublishedQualificationRequirement | undefined,
  hinge: CanonicalEditorialSignal | undefined,
): EditorialProposition {
  if (hinge) {
    return proposition("RADAR_INFERENCE", `Use the first conversation to resolve: ${hinge.value}`, {
      roleEvidenceIds: [], candidateEvidenceIds: [], canonicalSignalIds: [hinge.id],
    }, 58, "hinge");
  }
  if (work) {
    return proposition("RADAR_INFERENCE", "Clarify the authority, resources, and success measures attached to the published mandate before assuming the scope of ownership.", {
      roleEvidenceIds: [work.sourceEvidenceId], candidateEvidenceIds: [], canonicalSignalIds: [],
    }, 57, "work-verification");
  }
  if (requirement) {
    return proposition("RADAR_INFERENCE", `Establish how central this published requirement is to the mandate: ${requirement.statement}`, {
      roleEvidenceIds: requirement.sourceEvidenceIds, candidateEvidenceIds: [], canonicalSignalIds: [],
    }, 56, "requirement-verification");
  }
  return proposition("EVIDENCE_LIMITATION", "Published role evidence is limited; establish the mandate and success conditions before making a direct-fit claim.", {
    roleEvidenceIds: [], candidateEvidenceIds: [], canonicalSignalIds: [],
  }, 10, "evidence-limited");
}

/**
 * Absence is not an employer fact.  These are bounded verification prompts
 * derived only from the contract's established role context and canonical
 * signals; they deliberately never inspect the source document.
 */
function structuralVerificationInferences(
  contract: EditorialIntelligenceContract,
): EditorialProposition[] {
  const establishedContext = contract.roleContext.map((item) => item.statement).join(" ");
  const hingeText = contract.decisionDrivers.hinges.map((item) => item.value).join(" ");
  const reportingEstablished = /\b(?:reports?\s+(?:directly\s+)?to|reporting\s+to)\b/i.test(establishedContext);
  const authoritySignal = contract.canonicalSignals.find((signal) =>
    signal.kind === "DECISION_AUTHORITY"
    && Boolean(normalized(signal.value))
    && !/^(?:unknown|not established|none)$/i.test(normalized(signal.value)),
  );
  const hasReportingHinge = /\breport(?:ing)?\b/i.test(hingeText);
  const hasAuthorityHinge = /\bdecision(?:\s+rights?|\s+authority)?\b/i.test(hingeText);
  const propositions: EditorialProposition[] = [];

  if (!reportingEstablished && !hasReportingHinge) {
    propositions.push(proposition(
      "EVIDENCE_LIMITATION",
      "Reporting line is not established in the available published evidence. Ask: Who does the role report to?",
      { roleEvidenceIds: [], candidateEvidenceIds: [], canonicalSignalIds: [] },
      53,
      "reporting-line-verification",
    ));
  }

  if (!authoritySignal && !hasAuthorityHinge) {
    propositions.push(proposition(
      "EVIDENCE_LIMITATION",
      "Decision authority is not established in the available published evidence. Ask: Which decisions does the role own directly?",
      { roleEvidenceIds: [], candidateEvidenceIds: [], canonicalSignalIds: [] },
      52,
      "decision-authority-verification",
    ));
  }

  return propositions;
}

function takeUnused(
  candidates: readonly EditorialProposition[],
  used: Set<string>,
  count: number,
): EditorialProposition[] {
  const selected = candidates.filter((candidate) => !used.has(candidate.id)).slice(0, count);
  selected.forEach((candidate) => used.add(candidate.id));
  return selected;
}

/**
 * Builds a non-persistent Phase 3 brief. Every output proposition carries the
 * input evidence identities that support it. No raw employer source is read.
 */
export function composeEditorialIntelligenceV2(contract: EditorialIntelligenceContract): EditorialCompositionV2 {
  const mode = determineEditorialCompositionMode(contract);
  const work = contract.publishedRoleWork;
  const requirements = contract.qualificationRequirements;
  const context = contract.roleContext;
  const capabilityPairs = capabilityPositioningPairs(contract);
  const candidateFacts = distinct([
    ...contract.candidatePrecedents.map(precedentProposition),
    ...capabilityPairs.map((pair, index) => capabilityProposition(pair.candidate, index)).filter((item): item is EditorialProposition => Boolean(item)),
  ]);
  const canonicalFacts = distinct(contract.canonicalSignals.map(signalProposition).filter((item): item is EditorialProposition => Boolean(item)));
  const workFacts = distinct(work.map(employerWorkProposition));
  const qualificationFacts = distinct(requirements.map(qualificationProposition));
  const contextFacts = distinct(context.map(contextProposition));
  const employerFacts = distinct([...workFacts, ...qualificationFacts, ...contextFacts]);

  const primaryWork = work[0];
  const primaryRequirement = requirements[0];
  const primaryContext = context[0];

  // The hierarchy distinguishes employer facts from RADAR's interpretation.
  // A published qualification or context can make a useful statement about
  // what the posting establishes, but never becomes an operating mandate.
  const employerSynthesis = primaryWork
    ? employerInference(primaryWork, mode)
    : primaryRequirement
      ? proposition("RADAR_INFERENCE", `The posting is clearer about the screening bar than the operating mandate: ${primaryRequirement.statement}.`, {
        roleEvidenceIds: primaryRequirement.sourceEvidenceIds,
        candidateEvidenceIds: [],
        canonicalSignalIds: [],
      }, 82, "qualification-hero")
      : primaryContext
        ? proposition("RADAR_INFERENCE", `The posting establishes ${primaryContext.statement}, but publishes limited concrete ownership for the role.`, {
          roleEvidenceIds: [primaryContext.sourceEvidenceId],
          candidateEvidenceIds: [],
          canonicalSignalIds: [],
        }, 80, "context-hero")
        : null;

  const positioning = candidatePositioningInference(capabilityPairs[0]);
  const traceExplanation = traceBackedFitExplanation(contract);
  const roleStrategy = roleStrategyInference(primaryWork, primaryRequirement);
  const verify = verificationInference(
    primaryWork,
    primaryRequirement,
    contract.decisionDrivers.hinges[0],
  );
  const verdict = contract.canonicalSignals.find((signal) => signal.kind === "VERDICT");
  const verdictFact = verdict ? signalProposition(verdict, 0) : null;
  const principalConstraint = contract.decisionDrivers.constraints[0];
  const structuralVerification = structuralVerificationInferences(contract);

  // 5-tier evidence hierarchy for bottom line:
  const bottomLine = primaryWork
    ? proposition("RADAR_INFERENCE", `${contract.verdict ?? "RADAR"}: this is an opportunity defined by ${modeMandateDescription(mode)}.${principalConstraint ? ` The retained evaluation constraint to test is ${principalConstraint.value}.` : " Validate the practical scope of the mandate before treating it as a direct-fit conclusion."}`, {
      roleEvidenceIds: [primaryWork.sourceEvidenceId],
      candidateEvidenceIds: [],
      canonicalSignalIds: [
        ...(verdict ? [verdict.id] : []),
        ...(principalConstraint ? [principalConstraint.id] : []),
      ],
    }, 84, "bottom-line")
    : primaryRequirement
      ? proposition("RADAR_INFERENCE", `${contract.verdict ?? "RADAR"}: the posting establishes a screening bar of ${primaryRequirement.statement}, while leaving the operating mandate less explicit. Validate the practical scope before treating this as a direct-fit conclusion.`, {
        roleEvidenceIds: primaryRequirement.sourceEvidenceIds,
        candidateEvidenceIds: [],
        canonicalSignalIds: [
          ...(verdict ? [verdict.id] : []),
          ...(principalConstraint ? [principalConstraint.id] : []),
        ],
      }, 35, "bottom-line-requirement-limited")
      : primaryContext
        ? proposition("RADAR_INFERENCE", `${contract.verdict ?? "RADAR"}: the posting establishes ${primaryContext.statement}, but does not publish enough concrete ownership to support a mandate claim. Clarify operational scope before pursuing direct-fit positioning.`, {
          roleEvidenceIds: [primaryContext.sourceEvidenceId],
          candidateEvidenceIds: [],
          canonicalSignalIds: verdict ? [verdict.id] : [],
        }, 30, "bottom-line-context-limited")
        : traceExplanation
          ? proposition("RADAR_INFERENCE", `${contract.verdict ?? "RADAR"}: the available canonical trace contains an evaluator-linked evidence relationship, but the posting does not publish a bounded operating mandate. Use that evidence carefully and establish the mandate directly.`, {
            roleEvidenceIds: traceExplanation.roleEvidenceIds,
            candidateEvidenceIds: traceExplanation.candidateEvidenceIds,
            canonicalSignalIds: traceExplanation.canonicalSignalIds,
          }, 28, "bottom-line-trace-limited")
        : proposition("EVIDENCE_LIMITATION", `${contract.verdict ?? "RADAR"}: published mandate detail is limited, so treat the first conversation as a mandate-validation step.`, {
          roleEvidenceIds: [], candidateEvidenceIds: [], canonicalSignalIds: verdict ? [verdict.id] : [],
        }, 18, "bottom-line-limited");

  const evidenceLimitedHero = proposition("EVIDENCE_LIMITATION", `${contract.verdict ?? "RADAR"}: published role detail is limited, so establish the mandate before treating the evaluation as a direct-fit explanation.`, {
    roleEvidenceIds: [], candidateEvidenceIds: [], canonicalSignalIds: verdict ? [verdict.id] : [],
  }, 20, "hero-limited");

  const all = distinct([
    ...employerFacts,
    ...candidateFacts,
    ...canonicalFacts,
    ...(employerSynthesis ? [employerSynthesis] : []),
    ...(positioning ? [positioning] : []),
    ...(traceExplanation ? [traceExplanation] : []),
    roleStrategy,
    verify,
    ...structuralVerification,
    ...(verdictFact ? [verdictFact] : []),
    bottomLine,
    ...(!employerSynthesis ? [evidenceLimitedHero] : []),
  ]);

  const used = new Set<string>();
  const hero = employerSynthesis
    ? [employerSynthesis]
    : takeUnused(
      traceExplanation
        ? [traceExplanation, ...employerFacts, ...canonicalFacts]
        : [evidenceLimitedHero, ...employerFacts, ...canonicalFacts],
      used,
      1,
    );
  hero.forEach((item) => used.add(item.id));
  const mandate = [
    ...takeUnused(workFacts, used, 2),
    ...takeUnused(qualificationFacts, used, workFacts.length === 0 ? 2 : 1),
    ...takeUnused(contextFacts, used, 1),
  ];
  const whyAttention = takeUnused([...employerFacts, ...canonicalFacts], used, 2);
  // Candidate evidence belongs in its own factual section. The strategy is a
  // separate RADAR inference, so a proof point is never silently re-used as a
  // mandate claim or a second copy of the same sentence.
  const candidatePositioning = takeUnused(candidateFacts, used, 2);
  const bottomLineSection = [bottomLine];
  used.add(bottomLine.id);
  const howToWin = takeUnused([positioning ?? roleStrategy], used, 1);
  const verifySection = takeUnused([verify, ...structuralVerification], used, 3);

  return {
    version: "editorial-composition-v2",
    compositionMode: mode,
    positioningRelations: capabilityPairs.map((pair) => pair.relation),
    propositions: all,
    sections: {
      hero: { headline: hero[0]?.text ?? null, propositions: hero },
      whyAttention: { headline: "Why this deserves attention", propositions: whyAttention },
      mandate: { headline: "What success requires", propositions: mandate },
      candidatePositioning: { headline: "Why this reached your desk", propositions: candidatePositioning },
      bottomLine: { headline: "Bottom line", propositions: bottomLineSection },
      howToWin: { headline: "How to win", propositions: howToWin },
      verify: { headline: "What to verify", propositions: verifySection },
    },
    coverage: {
      hasRoleMandate: work.length > 0,
      hasQualifications: requirements.length > 0,
      hasCandidatePositioning: Boolean(positioning),
      hasCanonicalEvaluation: Boolean(contract.verdict),
      scalarOnly: contract.decisionDrivers.availability === "SCALAR_ONLY",
    },
  };
}
