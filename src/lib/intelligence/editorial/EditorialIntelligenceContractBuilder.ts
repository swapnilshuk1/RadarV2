import { isMeaningfulEvidenceQuote } from "@/domain/evidence";
import type { CandidateProjection } from "@/lib/domain/candidate_projection";
import type { EvidenceMatch } from "@/lib/domain/semantic";
import type { EvaluationArtifact } from "@/lib/intelligence/engine";
import { substantiveCandidateEvidence } from "./CandidateProofPolicy";
import type {
  CandidatePrecedent,
  DecisionHinge,
  EditorialEvidenceRef,
  EditorialIntelligenceContract,
  PublishedRoleOutcome,
} from "./EditorialIntelligenceContract";
import { sanitizePublishedEmployerDimensions } from "./PublishedEmployerEvidence";

const GENERIC_EDITORIAL_TEXT = [
  "no material structural risk identified",
  "proceed with standard executive due diligence",
  "reporting line & budget authority clarification",
  "strong functional alignment",
  "your background in marketing strategy aligns directly",
  "your commercial trajectory offers adjacent transferability",
];

const SCORE_SUMMARY_PATTERN = /^(?:radar career assessment:\s*)?quality score\b/i;
const FIT_METRIC_PATTERN = /\bidentity similarity\b.*\bcapability fit\b/i;
const CLASSIFIER_TOKEN_PATTERN = /^[A-Z0-9_&|/ -]{2,80}$/;
const ACTION_ONLY_POSITIONING_PATTERN = /^(?:proceed|request an initial screening call|initiate contact|contact immediately|apply immediately)\b/i;
const ROLE_OUTCOME_SIGNAL = /^(?:this role\s+)?(?:will\s+)?(?:lead|own|manage|deliver|drive|build|develop|execute|achieve|monitor|analy[sz]e|orchestrate|negotiate|track|conduct|enforce|protect|grow|scale|create|establish|oversee|direct|run)\b|\b(?:responsible for|accountable for|you will|this role)\b/i;

type JobProjectionMissionView = {
  executiveMission?: { successConditions?: readonly string[] };
};

type QualificationSignal = {
  capability: string;
  statement: string;
  materiality: "CORE" | "SUPPORTING";
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function meaningfulEditorialText(value: unknown): string | null {
  const text = normalized(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (GENERIC_EDITORIAL_TEXT.some((generic) => lower.includes(generic))) return null;
  if (SCORE_SUMMARY_PATTERN.test(text) || FIT_METRIC_PATTERN.test(text)) return null;
  if (CLASSIFIER_TOKEN_PATTERN.test(text) && !/[a-z]/.test(text)) return null;
  return text;
}

function meaningfulPositioningText(value: unknown): string | null {
  const text = meaningfulEditorialText(value);
  if (!text || ACTION_ONLY_POSITIONING_PATTERN.test(text)) return null;
  return /confirm operational scope and timeline/i.test(text) ? null : text;
}

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value).trim().toLowerCase();
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(meaningfulEditorialText).filter((item): item is string => Boolean(item));
  const text = meaningfulEditorialText(value);
  return text ? [text] : [];
}

const MAX_CANDIDATE_EVIDENCE_CHARS = 420;
const MAX_QUALIFICATION_EVIDENCE_CHARS = 420;

function safeCapabilityLabel(value: unknown): string {
  const text = normalized(value);
  if (!text || /^[A-Z0-9_]+$/.test(text) || text.includes("_") || text.length > 80) {
    return "Relevant candidate precedent";
  }
  return text;
}

function boundedCandidateStatement(value: unknown): string | null {
  const text = normalized(value);
  if (!text || text.length > MAX_CANDIDATE_EVIDENCE_CHARS) return null;
  return substantiveCandidateEvidence(text);
}

type CandidateSemanticEvidence = NonNullable<CandidateProjection["semanticEvidence"]>[number];

type RoutedCandidatePrecedent = CandidatePrecedent & {
  routeKeys: string[];
};

type RankedCandidatePrecedent = {
  precedent: RoutedCandidatePrecedent;
  mapping: EvidenceMatch;
  score: number;
};

function semanticEvidenceStatement(evidence: CandidateSemanticEvidence): string | null {
  const direct = boundedCandidateStatement(evidence.sourcePhrase);
  if (direct) return direct;

  const rawContext = typeof evidence.context === "string" ? evidence.context.trim() : "";
  const sourcePhrase = normalized(evidence.sourcePhrase);
  if (!rawContext || !sourcePhrase) return null;

  const sourceLower = sourcePhrase.toLowerCase();
  const spans = rawContext
    .split(/(?:\r?\n)+|[•●▪]\s*|(?<=[.!?])\s+/)
    .map((span) => normalized(span))
    .filter(Boolean);

  for (const span of spans) {
    if (!span.toLowerCase().includes(sourceLower)) continue;
    const statement = boundedCandidateStatement(span);
    if (statement) return statement;
  }
  return null;
}

const SYNTHETIC_MAPPING_REASON = /\b(?:enterprise scope grounding|executive capability potential|unproven capability|functional divergence warning)\b/i;
const SYNTHETIC_MAPPING_PROOF = /\b(?:enterprise p&l ownership|board decision authority|executive career memory|functional divergence warning)\b/i;

function normalizedRouteKey(value: unknown): string {
  return normalized(value)
    .replace(/\bp\s*&\s*l\b/gi, "pnl")
    .replace(/[_/|&]+/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function routeTokens(value: unknown): Set<string> {
  const text = normalizedRouteKey(value);
  if (!text) return new Set();
  const ignored = new Set(["candidate", "capability", "evidence", "relevant", "experience", "proof", "direct"]);
  return new Set(text.split(" ").filter((token) => token.length >= 3 && !ignored.has(token)));
}

function routeSimilarity(left: unknown, right: unknown): number {
  const a = normalizedRouteKey(left);
  const b = normalizedRouteKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a))) return 0.9;
  const aTokens = routeTokens(a);
  const bTokens = routeTokens(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  if (intersection === 0) return 0;
  return intersection / new Set([...aTokens, ...bTokens]).size;
}

function roleEvidenceMappings(artifact: EvaluationArtifact): EvidenceMatch[] {
  const record = artifact.record as { trace?: { evidenceMapping?: readonly EvidenceMatch[] } } | undefined;
  const mappings = Array.isArray(record?.trace?.evidenceMapping) ? record.trace.evidenceMapping : [];
  return mappings.filter((mapping) =>
    typeof mapping?.jobCapability === "string"
    && typeof mapping?.candidateCapability === "string"
    && typeof mapping?.confidence === "number"
    && mapping.confidence >= 0.8
    && !SYNTHETIC_MAPPING_REASON.test(mapping.reason || "")
    && !SYNTHETIC_MAPPING_PROOF.test(mapping.candidateCapability),
  );
}

function projectedCapabilityTierWeight(artifact: EvaluationArtifact, jobCapability: string): number {
  const capabilities = Array.isArray(artifact.jobProjection?.capabilities) ? artifact.jobProjection.capabilities : [];
  let bestMatch: { similarity: number; tier?: string } | undefined;
  for (const capability of capabilities) {
    const name = typeof capability === "string" ? capability : capability?.name;
    const similarity = routeSimilarity(name, jobCapability);
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = { similarity, tier: typeof capability === "object" && capability ? capability.tier : undefined };
    }
  }
  if (!bestMatch || bestMatch.similarity < 0.6) return 0;
  switch (bestMatch.tier) {
    case "CORE_MANDATE": return 20;
    case "EXECUTION_CAPABILITY": return 12;
    case "TECHNOLOGY_STACK": return 5;
    case "DOMAIN_FAMILIARITY": return 4;
    default: return 8;
  }
}

const GENERIC_RELEVANCE_TOKENS = new Set([
  "marketing", "strategy", "strategic", "leadership", "leader", "growth", "commercial",
  "business", "management", "manage", "director", "head", "senior", "executive", "role",
  "team", "delivery", "experience", "global", "regional", "multi", "market", "markets",
  "across", "account", "accounts", "client", "clients", "campaign", "campaigns", "brand",
  "brands", "portfolio", "portfolios", "consumer", "centre", "center", "excellence", "build",
  "develop", "scalable", "priority", "outcomes",
  "and", "the", "for", "with", "from", "into", "that", "this", "will", "you", "your",
  "led", "lead", "built", "scaled", "multiple", "complex", "program", "programs", "programme",
  "programmes", "initiative", "initiatives",
]);

function relevanceTokens(value: unknown): Set<string> {
  const text = normalizedRouteKey(value);
  if (!text) return new Set();
  return new Set(text.split(" ").filter((token) => token.length >= 3 && !GENERIC_RELEVANCE_TOKENS.has(token)));
}

function roleEvidenceTexts(
  artifact: EvaluationArtifact,
  outcomes: readonly PublishedRoleOutcome[],
): string[] {
  const texts = outcomes.map((outcome) => outcome.statement);
  const jobProjection = artifact.jobProjection;
  for (const capability of Array.isArray(jobProjection?.capabilities) ? jobProjection.capabilities : []) {
    if (typeof capability !== "object" || capability == null || capability.source !== "explicit") continue;
    if (typeof capability.sourceQuote === "string" && capability.sourceQuote.trim()) texts.push(capability.sourceQuote);
    for (const evidence of Array.isArray(capability.evidence) ? capability.evidence : []) {
      if (typeof evidence === "string" && evidence.trim()) texts.push(evidence);
    }
  }
  for (const requirement of Array.isArray(jobProjection?.capabilityRequirements) ? jobProjection.capabilityRequirements : []) {
    for (const quote of Array.isArray(requirement.sourceQuotes) ? requirement.sourceQuotes : []) {
      if (typeof quote === "string" && quote.trim()) texts.push(quote);
    }
  }
  return unique(texts.map(normalized).filter(Boolean), (text) => text);
}

function specificEvidenceSimilarity(candidateValue: unknown, roleEvidence: unknown): number {
  const candidate = relevanceTokens(candidateValue);
  const role = relevanceTokens(roleEvidence);
  if (candidate.size === 0 || role.size === 0) return 0;
  const overlap = [...candidate].filter((token) => role.has(token));
  if (overlap.length === 0) return 0;
  return Math.max(overlap.length / candidate.size, overlap.length / role.size);
}

function roleEvidenceRelevance(
  precedent: RoutedCandidatePrecedent,
  roleEvidence: readonly string[],
): number {
  let best = 0;
  /*
   * Relevance is established only by the semantic/capability routing
   * identity. The achievement statement is display evidence after that
   * decision; incidental achievement words must never route it.
   */
  const candidateRouteKeys = unique(
    precedent.routeKeys.map(normalized).filter(Boolean),
    (key) => key,
  );
  for (const routeKey of candidateRouteKeys) {
    for (const evidenceText of roleEvidence) {
      best = Math.max(best, specificEvidenceSimilarity(routeKey, evidenceText));
    }
  }
  return best;
}

function precedentMappingScore(
  artifact: EvaluationArtifact,
  precedent: RoutedCandidatePrecedent,
  mapping: EvidenceMatch,
): number {
  let bestCandidateRoute = 0;
  let bestJobRoute = 0;
  for (const key of precedent.routeKeys) {
    bestCandidateRoute = Math.max(bestCandidateRoute, routeSimilarity(key, mapping.candidateCapability));
    bestJobRoute = Math.max(bestJobRoute, routeSimilarity(key, mapping.jobCapability));
  }
  const routeStrength = Math.max(bestCandidateRoute, bestJobRoute * 0.85);
  /*
   * The canonical evidenceMapping is a PER-PRECEDENT permission gate.
   *
   * A strong mapping existing somewhere on the role is not enough.
   * This specific candidate precedent must belong to the mapped
   * capability family.
   *
   * Broad family mappings still work:
   *
   *   MARKETING_STRATEGY -> marketing
   *   Performance Marketing -> marketing
   *
   * because routeSimilarity() handles phrase containment.
   *
   * But an unrelated CRM mapping must never authorize an operations
   * precedent merely because the JD also contains operations evidence.
   */
  if (routeStrength < 0.6) return 0;
  return routeStrength * 100
    + mapping.confidence * 20
    + projectedCapabilityTierWeight(artifact, mapping.jobCapability)
    + precedent.confidence * 10;
}

function roleRelevantCandidatePrecedents(
  artifact: EvaluationArtifact,
  precedents: readonly RoutedCandidatePrecedent[],
  outcomes: readonly PublishedRoleOutcome[],
): CandidatePrecedent[] {
  const mappings = roleEvidenceMappings(artifact);
  const roleEvidence = roleEvidenceTexts(artifact, outcomes);
  if (mappings.length === 0) return [];
  const ranked: RankedCandidatePrecedent[] = [];
  for (const precedent of precedents) {
    const relevance = roleEvidenceRelevance(precedent, roleEvidence);
    if (relevance <= 0) continue;
    let best: RankedCandidatePrecedent | null = null;
    for (const mapping of mappings) {
      const mappingScore = precedentMappingScore(artifact, precedent, mapping);
      if (mappingScore <= 0) continue;
      const score = mappingScore + relevance * 100;
      if (!best || score > best.score) best = { precedent, mapping, score };
    }
    if (best) ranked.push(best);
  }
  ranked.sort((left, right) => right.score - left.score);
  return unique(ranked, (item) => item.precedent.statement).slice(0, 3).map(({ precedent, mapping }) => {
    const mappedJobLabel = safeCapabilityLabel(mapping.jobCapability);
    return {
      capability: precedent.capability === "Relevant candidate precedent" && mappedJobLabel !== "Relevant candidate precedent"
        ? mappedJobLabel
        : precedent.capability,
      statement: precedent.statement,
      evidenceIds: precedent.evidenceIds,
      confidence: precedent.confidence,
    };
  });
}

function canonicalVerdict(value: unknown): EditorialIntelligenceContract["verdict"] {
  return value === "PURSUE" || value === "CONSIDER" || value === "PASS" ? value : null;
}

function candidatePrecedents(
  artifact: EvaluationArtifact,
  projection: CandidateProjection,
  outcomes: readonly PublishedRoleOutcome[],
): CandidatePrecedent[] {
  const precedents: RoutedCandidatePrecedent[] = [];
  for (const capability of projection.inferredCapabilities ?? []) {
    if (capability.confidence < 0.7) continue;
    for (const evidence of capability.supportingEvidence ?? []) {
      const statement = boundedCandidateStatement(evidence.quote);
      if (!statement) continue;
      precedents.push({
        capability: safeCapabilityLabel(capability.name),
        statement,
        evidenceIds: unique(
          [...capability.evidenceIds, evidence.id].filter(Boolean),
          (id) => id,
        ),
        confidence: capability.confidence,
        routeKeys: [capability.name],
      });
    }
  }

  for (const evidence of projection.semanticEvidence ?? []) {
    if (evidence.confidence < 0.7 || evidence.negated || evidence.temporalState === "ASPIRATIONAL") continue;
    if (evidence.evidenceStrength === "EXCLUDED" || evidence.evidenceRelationship === "NON_SATISFYING" || evidence.evidenceRelationship === "EXCLUDED") continue;
    if (!["CAPABILITY", "FINANCIAL_SCOPE", "MANDATE", "PEOPLE_SCOPE"].includes(evidence.entityType)) continue;
    const statement = semanticEvidenceStatement(evidence);
    if (!statement) continue;
    const sourceId = typeof evidence.metadata?.sourceId === "string" ? evidence.metadata.sourceId.trim() : "";
    precedents.push({
      capability: safeCapabilityLabel(evidence.canonicalConcept),
      statement,
      evidenceIds: sourceId ? [sourceId] : [],
      confidence: evidence.confidence,
      routeKeys: [evidence.canonicalConcept, evidence.sourcePhrase],
    });
  }

  const boundedUnique = unique(
    precedents.sort((left, right) => right.confidence - left.confidence),
    (precedent) => precedent.statement,
  );
  return roleRelevantCandidatePrecedents(artifact, boundedUnique, outcomes);
}

function isClassifierLikeEvidence(value: string): boolean {
  const text = normalized(value);
  return !text || (CLASSIFIER_TOKEN_PATTERN.test(text) && !/[a-z]/.test(text));
}

function qualificationSignals(artifact: EvaluationArtifact): QualificationSignal[] {
  const requirements = Array.isArray(artifact.jobProjection?.capabilityRequirements)
    ? artifact.jobProjection.capabilityRequirements
    : [];
  const signals: QualificationSignal[] = [];

  for (const requirement of requirements) {
    if (typeof requirement !== "object" || requirement == null || requirement.required !== true) continue;
    const capability = safeCapabilityLabel(requirement.capability);
    if (capability === "Relevant candidate precedent") continue;

    for (const quote of Array.isArray(requirement.sourceQuotes) ? requirement.sourceQuotes : []) {
      const statement = normalized(quote);
      if (
        !statement
        || statement.length > MAX_QUALIFICATION_EVIDENCE_CHARS
        || !isMeaningfulEvidenceQuote(statement)
        || isClassifierLikeEvidence(statement)
      ) continue;
      signals.push({
        capability,
        statement,
        materiality: requirement.materiality === "CORE" ? "CORE" : "SUPPORTING",
      });
    }
  }

  return unique(
    signals.sort((left, right) => (right.materiality === "CORE" ? 1 : 0) - (left.materiality === "CORE" ? 1 : 0)),
    (signal) => `${signal.capability}:${signal.statement}`,
  ).slice(0, 3);
}

function isProjectedRoleOutcome(value: string): boolean {
  const text = normalized(value);
  return Boolean(text) && isMeaningfulEvidenceQuote(text) && !isClassifierLikeEvidence(text) && ROLE_OUTCOME_SIGNAL.test(text);
}

function roleOutcomeScore(statement: string): number {
  const words = statement.split(/\s+/).filter(Boolean);
  return (ROLE_OUTCOME_SIGNAL.test(statement) ? 4 : 0) + (words.length >= 8 ? 2 : 0) - (words.length < 5 ? 2 : 0);
}

function publishedRoleOutcomes(artifact: EvaluationArtifact): PublishedRoleOutcome[] {
  const dimensions = sanitizePublishedEmployerDimensions(
    Array.isArray(artifact.opportunity?.dimensions) ? artifact.opportunity.dimensions : [],
  );
  const outcomes: PublishedRoleOutcome[] = [];
  for (const dimension of dimensions) {
    if (dimension.jdEvidence?.status !== "Explicit") continue;
    const quotes = [
      dimension.jdEvidence.value,
      ...(dimension.jdEvidence.evidence ?? []).map((evidence) => evidence.quote),
    ];
    for (const quote of quotes) {
      const statement = normalized(quote);
      if (!isMeaningfulEvidenceQuote(statement) || isClassifierLikeEvidence(statement)) continue;
      outcomes.push({ statement, dimensionKey: String(dimension.key) });
    }
  }
  const mission = artifact.jobProjection as unknown as JobProjectionMissionView;
  for (const condition of mission.executiveMission?.successConditions ?? []) {
    const statement = normalized(condition);
    if (isProjectedRoleOutcome(statement)) outcomes.push({ statement, dimensionKey: "successConditions" });
  }
  return unique(outcomes.sort((left, right) => roleOutcomeScore(right.statement) - roleOutcomeScore(left.statement)), (outcome) => outcome.statement).slice(0, 5);
}

function buildGroundedCareerCase(
  artifact: EvaluationArtifact,
  recorded: string | null,
  tradeoff: string | null,
  precedents: readonly CandidatePrecedent[],
  outcomes: readonly PublishedRoleOutcome[],
  capabilities: readonly string[],
): string | null {
  if (recorded) return recorded;
  const role = normalized(artifact.opportunity?.role) || "this role";
  const company = normalized(artifact.opportunity?.company) || "the company";
  const outcome = outcomes[0];
  // Candidate precedents are Section III evidence, never the career-case bridge.
  if (outcome && tradeoff) return `${tradeoff} The published remit makes the decision concrete: ${outcome.statement}`;
  if (outcome) return `The case for ${role} at ${company} rests on the published remit: ${outcome.statement}`;
  return tradeoff ? `The career case for ${role} at ${company} is ${tradeoff.charAt(0).toLowerCase()}${tradeoff.slice(1)}` : null;
}

function deriveFunctionalAdjacencyRisk(precedents: readonly CandidatePrecedent[], outcomes: readonly PublishedRoleOutcome[]): string | null {
  const roleText = outcomes.map((outcome) => outcome.statement).join(" ");
  const candidateText = precedents.map((precedent) => `${precedent.capability} ${precedent.statement}`).join(" ");
  const operational = /\b(?:operations?|vendor|service delivery|inventory|merchandising|category|qbr|capa|escalation|supply|fulfilment|fulfillment)\b/i;
  return operational.test(roleText) && !operational.test(candidateText) && /\b(?:marketing|commercial|growth|brand|client|media|revenue|customer)\b/i.test(candidateText)
    ? "The published remit is materially more operating-delivery heavy than the strongest recorded candidate precedent. Validate how much of the role is execution ownership versus strategic or commercial leadership."
    : null;
}

function decisionHinges(
  artifact: EvaluationArtifact,
  outcomes: readonly PublishedRoleOutcome[],
  qualifications: readonly QualificationSignal[],
  principalRisk: string | null,
  careerTradeoff: string | null,
): DecisionHinge[] {
  const role = normalized(artifact.opportunity?.role) || "this role";
  const published = new Set(outcomes.map((outcome) => outcome.dimensionKey));
  const hinges: DecisionHinge[] = [];
  const add = (topic: string, question: string, reason: string) => hinges.push({ topic, question, reason });

  if (!published.has("reportingLine")) {
    add("Reporting line", `Who does the ${role} role report to?`, "The published role does not establish a reporting line.");
  }
  if (!published.has("decisionAuthority")) {
    add("Decision rights", `What decision rights accompany the ${role} role?`, "Published authority is not established.");
  }
  const commercialSignals = outcomes.some((outcome) => /commercial|revenue|profit|p\s*&\s*l|budget/i.test(outcome.statement));
  if (commercialSignals && !published.has("commercialScope") && !published.has("commercialAccountability")) {
    add("Commercial ownership", "Which commercial outcome, if any, is directly owned by the role?", "The published role signal is commercially relevant but ownership is not established.");
  }
  const primaryQualification = qualifications[0];
  if (primaryQualification) {
    const requirementAlreadyEstablishedAsWork = outcomes.some(
      (outcome) => specificEvidenceSimilarity(primaryQualification.capability, outcome.statement) > 0,
    );
    if (!requirementAlreadyEstablishedAsWork) {
      add(
        "Qualification vs mandate",
        `How central is ${primaryQualification.capability} to the day-to-day mandate, versus being a candidate qualification?`,
        `The published source requires "${primaryQualification.statement}", but RADAR does not have independent published evidence that this is work the role directly owns.`,
      );
    }
  }
  if (principalRisk) {
    add("Principal risk", `What evidence would resolve this risk: ${principalRisk}?`, "RADAR recorded this as the material decision risk.");
  } else if (careerTradeoff) {
    add("Career tradeoff", `How does the role resolve this tradeoff: ${careerTradeoff}?`, "RADAR recorded this as the career tradeoff.");
  }
  return unique(hinges, (hinge) => hinge.topic).slice(0, 3);
}

function clippedEditorialEvidence(value: string, max = 260): string {
  const text = normalized(value);
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const boundary = slice.lastIndexOf(" ");
  const safe = boundary >= 160 ? slice.slice(0, boundary) : slice;
  return `${safe.replace(/[\s,;:.-]+$/, "")}…`;
}

function buildGroundedPositioningAngles(
  artifact: EvaluationArtifact,
  precedents: readonly CandidatePrecedent[],
  outcomes: readonly PublishedRoleOutcome[],
  qualifications: readonly QualificationSignal[],
  hinges: readonly DecisionHinge[],
): string[] {
  const role = normalized(artifact.opportunity?.role) || "this role";
  const company = normalized(artifact.opportunity?.company) || "the company";
  const outcome = outcomes[0];
  const qualification = qualifications[0];
  const hinge = hinges[0];
  const generated: string[] = [];

  if (outcome) {
    generated.push([
      "Anchor the conversation on the published remit:",
      clippedEditorialEvidence(outcome.statement),
      "Clarify the scope and authority required to deliver it.",
      hinge ? `Use the first discussion to answer "${hinge.question}"` : "",
    ].filter(Boolean).join(" "));
  } else if (qualification) {
    generated.push([
      `Treat ${qualification.capability} as a published qualification hurdle, not as proof of the operating mandate.`,
      `The source says: "${clippedEditorialEvidence(qualification.statement)}"`,
      "Do not claim direct operating fit from that requirement alone.",
      hinge
        ? `Use the first discussion to answer "${hinge.question}"`
        : `Establish how this requirement translates into actual ownership in ${role} at ${company}.`,
    ].filter(Boolean).join(" "));
  } else if (hinge) {
    generated.push([
      "Do not lead with a generic portfolio story.",
      `Use the first conversation to answer "${hinge.question}"`,
      "Then position only candidate evidence that maps to the confirmed scope.",
    ].join(" "));
  } else {
    generated.push(`Do not lead with a generic portfolio story. Establish the actual success conditions for ${role} at ${company} before making a direct-fit claim.`);
  }

  const groundedReferences = [
    ...outcomes.map((item) => item.statement),
    ...precedents.map((item) => item.capability),
    ...qualifications.map((item) => item.capability),
  ];
  const legacyValues = Array.isArray(artifact.opportunity?.positioning)
    ? artifact.opportunity!.positioning
    : [artifact.opportunity?.positioning];
  const groundedLegacy = legacyValues
    .map(meaningfulPositioningText)
    .filter((value): value is string => Boolean(value))
    .filter((value) => groundedReferences.some(
      (reference) => specificEvidenceSimilarity(value, reference) > 0,
    ));

  return unique([...generated, ...groundedLegacy], (angle) => angle.toLowerCase());
}

/** Builds persisted editorial material without participating in canonical evaluation truth. */
export function buildEditorialIntelligenceContract(
  artifact: EvaluationArtifact,
  candidateProjection: CandidateProjection,
): EditorialIntelligenceContract {
  const opportunity = artifact.opportunity;
  const recommendation = opportunity?.engineRecommendation;
  const verdict = canonicalVerdict(recommendation?.engineVerdict);
  const qualityScore = typeof recommendation?.qualityScore === "number" ? recommendation.qualityScore : null;
  const careerTradeoff = meaningfulEditorialText(recommendation?.relativeDifferentiator)
    ?? meaningfulEditorialText(recommendation?.trajectoryUpside);
  const whyNow = meaningfulEditorialText(opportunity?.whyNow);
  const capabilityMatches = unique(
    textList((opportunity?.recommendationResult as { capabilityFit?: { matchedCapabilities?: unknown } } | undefined)?.capabilityFit?.matchedCapabilities),
    (capability) => capability.toLowerCase(),
  );
  const outcomes = publishedRoleOutcomes(artifact);
  const precedents = candidatePrecedents(artifact, candidateProjection, outcomes);
  const qualifications = qualificationSignals(artifact);
  const careerCase = buildGroundedCareerCase(
    artifact,
    meaningfulEditorialText(opportunity?.primaryDriver),
    careerTradeoff,
    precedents,
    outcomes,
    capabilityMatches,
  );
  const principalRisk = meaningfulEditorialText(opportunity?.primaryRisk)
    ?? meaningfulEditorialText(opportunity?.hiringRisk)
    ?? deriveFunctionalAdjacencyRisk(precedents, outcomes);
  const recommendedAction = meaningfulEditorialText(opportunity?.recommendedAction);
  const hinges = decisionHinges(artifact, outcomes, qualifications, principalRisk, careerTradeoff);
  const positioningAngles = buildGroundedPositioningAngles(
    artifact,
    precedents,
    outcomes,
    qualifications,
    hinges,
  );
  const provenance: EditorialEvidenceRef[] = [
    ...precedents.map((precedent) => ({ kind: "CANDIDATE_FACT" as const, text: precedent.statement, sourceId: precedent.evidenceIds[0], confidence: precedent.confidence })),
    ...outcomes.map((outcome) => ({ kind: "EMPLOYER_FACT" as const, text: outcome.statement })),
    ...qualifications.map((qualification) => ({ kind: "EMPLOYER_FACT" as const, text: qualification.statement })),
    ...[careerCase, principalRisk, careerTradeoff, whyNow, recommendedAction, ...positioningAngles]
      .filter((text): text is string => Boolean(text))
      .map((text) => ({ kind: "RADAR_INFERENCE" as const, text })),
  ];

  return {
    version: "editorial-intelligence-v1",
    verdict,
    qualityScore,
    careerCase,
    principalRisk,
    careerTradeoff,
    whyNow,
    capabilityMatches,
    candidatePrecedents: precedents,
    publishedRoleOutcomes: outcomes,
    decisionHinges: hinges,
    positioningAngles,
    recommendedAction,
    provenance: unique(provenance, (item) => `${item.kind}:${item.text.toLowerCase()}`),
  };
}
