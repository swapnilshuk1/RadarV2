import { isMeaningfulEvidenceQuote } from "@/domain/evidence";
import type { CandidateProjection } from "@/lib/domain/candidate_projection";
import type { EvidenceMatch } from "@/lib/domain/semantic";
import type { CanonicalDecisionTraceV1, UnavailableReasonCode } from "@/lib/domain/evaluation_payloads";
import type { ProjectedQualificationEvidence, ProjectedRoleWorkEvidence } from "@/lib/domain/job_projection";
import type { EvaluationArtifact } from "@/lib/intelligence/engine";
import { substantiveCandidateEvidence } from "./CandidateProofPolicy";
import type {
  CandidatePrecedent,
  CandidateCapabilitySignal,
  CandidateFitEvidence,
  CanonicalEditorialSignal,
  DecisionHinge,
  EditorialDecisionDrivers,
  EditorialEvidenceRef,
  EditorialIntelligenceContract,
  EditorialSynthesisInput,
  PublishedQualificationRequirement,
  PublishedRoleContext,
  PublishedRoleWork,
  PublishedRoleOutcome,
} from "./EditorialIntelligenceContract";

export type EditorialContractInput =
  | {
      state: "EVALUATED";
      artifact: EvaluationArtifact;
      candidateProjection: CandidateProjection;
      presentationEvidence?: EditorialIntelligenceContractOptions;
    }
  | {
      state: "UNAVAILABLE";
      reasonCode: UnavailableReasonCode;
      presentationEvidence?: EditorialIntelligenceContractOptions;
    };

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

type QualificationSignal = {
  capability: string;
  statement: string;
  materiality: "CORE" | "SUPPORTING";
  sourceEvidenceIds: string[];
};

export interface EditorialIntelligenceContractOptions {
  /**
   * Exact-source presentation augmentation supplied by the Phase 1 boundary.
   * The builder never reads or reconstructs raw opportunity source itself.
   */
  roleWorkEvidence?: readonly ProjectedRoleWorkEvidence[];
  /** Exact-source qualification augmentation from the same Phase 1 pass. */
  presentationQualificationEvidence?: readonly ProjectedQualificationEvidence[];
}

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
  if (!text || /^[A-Z0-9_]+$/.test(text) || text.includes("_") || text.includes("|") || text.length > 80) {
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

/**
 * The candidate projection is a fact source, but not every semantic record is
 * safe editorial material. In particular, a profile-wide `sourcePhrase` is a
 * locator/corpus, never a candidate fact. This admission boundary is shared by
 * the Section III precedent path and the Phase 2 candidate-capability view.
 */
function admissibleCandidateSemanticEvidence(evidence: CandidateSemanticEvidence): boolean {
  return evidence.confidence >= 0.7
    && !evidence.negated
    && evidence.temporalState !== "ASPIRATIONAL"
    && evidence.evidenceStrength !== "EXCLUDED"
    && evidence.evidenceRelationship !== "NON_SATISFYING"
    && evidence.evidenceRelationship !== "EXCLUDED"
    && ["CAPABILITY", "FINANCIAL_SCOPE", "MANDATE", "PEOPLE_SCOPE"].includes(evidence.entityType)
    && Boolean(semanticEvidenceStatement(evidence));
}

function boundedCandidateCapabilityIdentity(evidence: CandidateSemanticEvidence): string | null {
  // This is a capability signal, not proof. It can preserve a concise source
  // phrase such as "revenue accountability", but never a profile corpus and
  // never `context` as a fallback display value.
  const phrase = normalized(evidence.sourcePhrase);
  if (!phrase || phrase.length < 3 || phrase.length > 80) return null;
  return safeCapabilityLabel(phrase) === "Relevant candidate precedent" || !meaningfulEditorialText(phrase)
    ? null
    : phrase;
}

function admissibleCandidateSemanticCapability(evidence: CandidateSemanticEvidence): boolean {
  return evidence.confidence >= 0.7
    && !evidence.negated
    && evidence.temporalState !== "ASPIRATIONAL"
    && evidence.evidenceStrength !== "EXCLUDED"
    && evidence.evidenceRelationship !== "NON_SATISFYING"
    && evidence.evidenceRelationship !== "EXCLUDED"
    && ["CAPABILITY", "FINANCIAL_SCOPE", "MANDATE", "PEOPLE_SCOPE"].includes(evidence.entityType)
    && Boolean(boundedCandidateCapabilityIdentity(evidence));
}

function safeSemanticCapabilityLabel(evidence: CandidateSemanticEvidence): string {
  const direct = safeCapabilityLabel(evidence.canonicalConcept);
  if (direct !== "Relevant candidate precedent") return direct;

  return boundedCandidateCapabilityIdentity(evidence) ?? "Relevant candidate precedent";
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
  const persistedTrace = decisionTrace(artifact);
  if (persistedTrace) {
    return persistedTrace.relationships.map((relationship) => ({
      jobCapability: relationship.jobCapabilityKey,
      candidateCapability: relationship.candidateCapabilityKey,
      confidence: 1,
      reason: "Persisted evaluator relationship",
    }));
  }
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
      provenance: "CANDIDATE_FACT" as const,
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
      provenance: "CANDIDATE_FACT",
      routeKeys: [capability.name],
      });
    }
  }

  for (const evidence of projection.semanticEvidence ?? []) {
    if (!admissibleCandidateSemanticEvidence(evidence)) continue;
    const statement = semanticEvidenceStatement(evidence);
    if (!statement) continue;
    const sourceId = typeof evidence.metadata?.sourceId === "string" ? evidence.metadata.sourceId.trim() : "";
    precedents.push({
      capability: safeCapabilityLabel(evidence.canonicalConcept),
      statement,
      evidenceIds: sourceId ? [sourceId] : [],
      confidence: evidence.confidence,
      provenance: "CANDIDATE_FACT",
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
        sourceEvidenceIds: Array.isArray(requirement.evidenceIds)
          ? requirement.evidenceIds.filter((id: unknown): id is string => typeof id === "string" && Boolean(id.trim()))
          : [],
      });
    }
  }

  return unique(
    signals.sort((left, right) => (right.materiality === "CORE" ? 1 : 0) - (left.materiality === "CORE" ? 1 : 0)),
    (signal) => `${signal.capability}:${signal.statement}`,
  ).slice(0, 3);
}

function roleWorkEvidence(
  artifact: EvaluationArtifact,
  options?: EditorialIntelligenceContractOptions,
): readonly ProjectedRoleWorkEvidence[] {
  const augmented = options?.roleWorkEvidence;
  if (Array.isArray(augmented)) return augmented;
  const stored = artifact.jobProjection?.roleWorkEvidence;
  return Array.isArray(stored) ? stored : [];
}

function presentationQualificationEvidence(
  artifact: EvaluationArtifact,
  options?: EditorialIntelligenceContractOptions,
): readonly ProjectedQualificationEvidence[] {
  const augmented = options?.presentationQualificationEvidence;
  if (Array.isArray(augmented)) return augmented;
  const stored = artifact.jobProjection?.presentationQualificationEvidence;
  return Array.isArray(stored) ? stored : [];
}

function sourceQualificationSignals(
  artifact: EvaluationArtifact,
  options?: EditorialIntelligenceContractOptions,
): QualificationSignal[] {
  return presentationQualificationEvidence(artifact, options)
    .map<QualificationSignal | null>((atom) => {
      const statement = normalized(atom.statement);
      if (!statement || statement.length > MAX_QUALIFICATION_EVIDENCE_CHARS || !isMeaningfulEvidenceQuote(statement)) return null;
      const capability = safeCapabilityLabel(Array.isArray(atom.capabilityKeys) ? atom.capabilityKeys[0] : undefined);
      return {
        capability: capability === "Relevant candidate precedent" ? "Published qualification" : capability,
        statement,
        materiality: "CORE" as const,
        sourceEvidenceIds: [normalized(atom.id)].filter(Boolean),
      };
    })
    .filter((signal): signal is QualificationSignal => Boolean(signal));
}

function allQualificationSignals(
  artifact: EvaluationArtifact,
  options?: EditorialIntelligenceContractOptions,
): QualificationSignal[] {
  const sourceQualifications = sourceQualificationSignals(artifact, options);
  // At the pinned-source presentation boundary, only the shared extractor is
  // authorized to classify a requirement. Legacy projection requirement
  // quotes remain available to canonical evaluation, but cannot reintroduce
  // a heading, benefit, or fused blob into the editorial contract.
  const hasSourceQualifiedEvidence =
    options?.presentationQualificationEvidence !== undefined
    || Array.isArray(
      artifact.jobProjection
        ?.presentationQualificationEvidence,
    );
  if (hasSourceQualifiedEvidence) {
    return unique(
      sourceQualifications,
      (signal) => signal.statement.toLowerCase(),
    ).slice(0, 5);
  }
  return unique(
    // The exact-source presentation atom is authoritative when canonical
    // capability-requirement extraction retained the same qualification too.
    // This preserves the source evidence ID rather than allowing a legacy
    // projection evidence id to displace it in the editorial contract.
    [...sourceQualifications, ...qualificationSignals(artifact)],
    (signal) => signal.statement.toLowerCase(),
  ).slice(0, 5);
}

function publishedRoleWork(
  artifact: EvaluationArtifact,
  options?: EditorialIntelligenceContractOptions,
): PublishedRoleWork[] {
  return unique(
    roleWorkEvidence(artifact, options)
      .filter((atom) => atom.kind === "RESPONSIBILITY" || atom.kind === "OUTCOME")
      .map((atom) => ({
        kind: atom.kind as PublishedRoleWork["kind"],
        statement: normalized(atom.statement),
        sourceEvidenceId: normalized(atom.id),
        capabilityKeys: Array.isArray(atom.capabilityKeys)
          ? atom.capabilityKeys.map(safeCapabilityLabel).filter((key: string) => key !== "Relevant candidate precedent")
          : [],
      }))
      .filter((atom) => Boolean(atom.statement) && Boolean(atom.sourceEvidenceId)),
    (atom) => atom.sourceEvidenceId,
  );
}

/**
 * Stored evaluations may expose an evaluator-produced trace. Its absence is
 * meaningful historical state, not permission to reconstruct one from scalar
 * scores or broad candidate inventory.
 */
function decisionTrace(artifact: EvaluationArtifact): CanonicalDecisionTraceV1 | null {
  const trace = (artifact as EvaluationArtifact & { decisionTrace?: unknown }).decisionTrace;
  if (!trace || typeof trace !== "object") return null;
  const candidate = trace as Partial<CanonicalDecisionTraceV1>;
  if (
    candidate.version !== "canonical-decision-trace/v1"
    || !Array.isArray(candidate.relationships)
    || !Array.isArray(candidate.components)
  ) return null;
  return candidate as CanonicalDecisionTraceV1;
}

function roleContext(
  artifact: EvaluationArtifact,
  options?: EditorialIntelligenceContractOptions,
): PublishedRoleContext[] {
  return unique(
    roleWorkEvidence(artifact, options)
      .filter((atom) => atom.kind === "ROLE_CONTEXT")
      .map((atom) => ({
        kind: "ROLE_CONTEXT" as const,
        statement: normalized(atom.statement),
        sourceEvidenceId: normalized(atom.id),
        capabilityKeys: Array.isArray(atom.capabilityKeys)
          ? atom.capabilityKeys.map(safeCapabilityLabel).filter((key: string) => key !== "Relevant candidate precedent")
          : [],
      }))
      .filter((atom) => Boolean(atom.statement) && Boolean(atom.sourceEvidenceId)),
    (atom) => atom.sourceEvidenceId,
  );
}

function legacyPublishedRoleOutcomes(work: readonly PublishedRoleWork[]): PublishedRoleOutcome[] {
  return work.map((atom) => ({
    statement: atom.statement,
    dimensionKey: atom.sourceEvidenceId,
  }));
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
  const published = new Set(outcomes.map((outcome) => outcome.dimensionKey));
  const hinges: DecisionHinge[] = [];
  const add = (topic: string, question: string, reason: string) => hinges.push({ topic, question, reason });

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

function candidateCapabilities(
  projection: CandidateProjection,
): CandidateCapabilitySignal[] {
  const inferred = (projection.inferredCapabilities ?? [])
    .filter((capability) => typeof capability?.confidence === "number" && capability.confidence >= 0.7)
    .map((capability) => ({
      capability: safeCapabilityLabel(capability.name),
      statement: (capability.supportingEvidence ?? [])
        .map((evidence) => boundedCandidateStatement(evidence.quote))
        .find((statement): statement is string => Boolean(statement)) ?? null,
      confidence: capability.confidence,
      evidenceIds: Array.isArray(capability.evidenceIds)
        ? capability.evidenceIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        : [],
      provenance: "CANDIDATE_FACT" as const,
      capabilityKeys: [normalized(capability.name)].filter(Boolean),
    }));

  const semantic = (projection.semanticEvidence ?? [])
    .map((evidence, index) => ({ evidence, index }))
    .filter(({ evidence }) => admissibleCandidateSemanticCapability(evidence))
    .map(({ evidence, index }) => ({
      capability: safeSemanticCapabilityLabel(evidence),
      statement: semanticEvidenceStatement(evidence),
      confidence: evidence.confidence,
      // Canonical semantic evidence does not carry a first-class id. The
      // immutable pinned projection plus this stable record position is the
      // narrowest available provenance reference; the source phrase itself is
      // never copied into the contract unless it already passed bounded-fact
      // admission above.
      evidenceIds: [
        typeof evidence.metadata?.sourceId === "string" && evidence.metadata.sourceId.trim()
          ? evidence.metadata.sourceId.trim()
          // This is the same deterministic fallback identity used by the
          // evaluator. Keeping the pinned profile version in the reference is
          // essential: a persisted decision trace must resolve to the exact
          // candidate fact that the evaluator received, never merely to an
          // identically-positioned semantic record from another projection.
          : `candidate-projection:${projection.profileVersion}:semantic:${index}`,
      ],
      provenance: "CANDIDATE_FACT" as const,
      capabilityKeys: [normalized(evidence.canonicalConcept), normalized(evidence.sourcePhrase)].filter(Boolean),
    }));

  const byCapability = new Map<string, CandidateCapabilitySignal>();
  for (const capability of [...inferred, ...semantic]
    .filter((item) => item.capability !== "Relevant candidate precedent" && Boolean(meaningfulEditorialText(item.capability)))) {
    const key = normalized(capability.capability).toLowerCase();
    const prior = byCapability.get(key);
    if (!prior) {
      byCapability.set(key, capability);
      continue;
    }
    // Candidate capability labels are an editorial inventory, whereas evidence
    // IDs are provenance. Coalesce identical labels without dropping the
    // source facts referenced by an evaluator-produced trace.
    byCapability.set(key, {
      ...prior,
      statement: prior.statement ?? capability.statement,
      confidence: Math.max(prior.confidence, capability.confidence),
      evidenceIds: [...new Set([...prior.evidenceIds, ...capability.evidenceIds])].sort(),
      capabilityKeys: [...new Set([...prior.capabilityKeys, ...capability.capabilityKeys])].sort(),
    });
  }
  return [...byCapability.values()];
}

function candidateFitEvidence(
  artifact: EvaluationArtifact,
  capabilities: readonly CandidateCapabilitySignal[],
  signals: readonly CanonicalEditorialSignal[],
  work: readonly PublishedRoleWork[],
  qualifications: readonly PublishedQualificationRequirement[],
): CandidateFitEvidence[] {
  const jobEvidenceById = new Map<string, CandidateFitEvidence["jobEvidence"][number]>();
  for (const item of work) {
    jobEvidenceById.set(item.sourceEvidenceId, { id: item.sourceEvidenceId, statement: item.statement, kind: "ROLE_WORK" });
  }
  for (const item of qualifications) {
    for (const id of item.sourceEvidenceIds) {
      jobEvidenceById.set(id, { id, statement: item.statement, kind: "QUALIFICATION" });
    }
  }
  for (const requirement of artifact.jobProjection?.capabilityRequirements ?? []) {
    for (const [index, id] of (requirement.evidenceIds ?? []).entries()) {
      const statement = normalized(requirement.sourceQuotes?.[index] ?? requirement.sourceQuotes?.[0]);
      if (typeof id === "string" && id.trim() && statement) {
        jobEvidenceById.set(id.trim(), { id: id.trim(), statement, kind: "QUALIFICATION" });
      }
    }
  }
  for (const capability of artifact.jobProjection?.capabilities ?? []) {
    if (typeof capability === "string" || capability.source !== "explicit") continue;
    const statement = normalized(capability.sourceQuote);
    if (!statement) continue;
    for (const id of capability.evidenceIds ?? []) {
      if (typeof id === "string" && id.trim()) {
        jobEvidenceById.set(id.trim(), { id: id.trim(), statement, kind: "CAPABILITY_EVIDENCE" });
      }
    }
  }
  const persistedTrace = decisionTrace(artifact);
  if (persistedTrace) {
    return persistedTrace.relationships.map((relationship, index) => {
      const roleSignal = signals.find((signal) =>
        signal.kind === "CAPABILITY"
        && (signal.capabilityKeys ?? []).some((key) => routeSimilarity(key, relationship.jobCapabilityKey) >= 0.6),
      );
      return {
        id: `canonical:trace-relationship:${index}`,
        candidateEvidenceIds: [...new Set(relationship.candidateEvidenceIds)].sort(),
        jobEvidenceIds: [...new Set(relationship.jobEvidenceIds)].sort(),
        jobEvidence: [...new Set(relationship.jobEvidenceIds)]
          .map((id) => jobEvidenceById.get(id))
          .filter((item): item is CandidateFitEvidence["jobEvidence"][number] => Boolean(item)),
        candidateCapabilityKey: relationship.candidateCapabilityKey,
        jobCapabilityKey: relationship.jobCapabilityKey,
        relationship: relationship.relationship,
        ...(roleSignal ? { canonicalSignalId: roleSignal.id } : {}),
      };
    });
  }

  const mappings = roleEvidenceMappings(artifact);
  const fits: CandidateFitEvidence[] = [];

  for (const [index, mapping] of mappings.entries()) {
    const roleSignal = signals.find((signal) =>
      signal.kind === "CAPABILITY"
      && (signal.capabilityKeys ?? []).some((key) => routeSimilarity(key, mapping.jobCapability) >= 0.6),
    );
    fits.push({
      id: `legacy:mapping:${index}`,
      // Legacy artifacts did not persist a trace. Preserve their existing
      // capability mapping as a single relationship with all matching
      // source-backed candidate references; do not expand it once per ID.
      candidateEvidenceIds: [...new Set(
        capabilities
          .filter((candidate) => (candidate.capabilityKeys ?? []).some((key) => routeSimilarity(key, mapping.candidateCapability) >= 0.6))
          .flatMap((candidate) => candidate.evidenceIds),
      )].sort(),
      jobEvidenceIds: [],
      jobEvidence: [],
      candidateCapabilityKey: mapping.candidateCapability,
      jobCapabilityKey: mapping.jobCapability,
      relationship: "MATCH",
      ...(roleSignal ? { canonicalSignalId: roleSignal.id } : {}),
    });
  }

  return unique(fits, (fit) => fit.id);
}
function publishedQualificationRequirements(
  qualifications: readonly QualificationSignal[],
): PublishedQualificationRequirement[] {
  return qualifications.map((qualification) => ({
    capability: qualification.capability,
    statement: qualification.statement,
    materiality: qualification.materiality,
    sourceEvidenceIds: qualification.sourceEvidenceIds,
  }));
}

function canonicalSignals(
  artifact: EvaluationArtifact,
  verdict: EditorialIntelligenceContract["verdict"],
  qualityScore: number | null,
  principalRisk: string | null,
  careerTradeoff: string | null,
  hinges: readonly DecisionHinge[],
): CanonicalEditorialSignal[] {
  const projection = artifact.jobProjection;
  const signals: CanonicalEditorialSignal[] = [];
  const add = (kind: CanonicalEditorialSignal["kind"], value: unknown, id: string, capabilityKeys?: string[]) => {
    const text = normalized(value);
    if (text) signals.push({ id, kind, value: text, provenance: "CANONICAL_EVALUATION", ...(capabilityKeys?.length ? { capabilityKeys } : {}) });
  };

  if (verdict) signals.push({ id: "canonical:verdict", kind: "VERDICT", value: verdict, provenance: "CANONICAL_EVALUATION" });
  if (qualityScore != null) signals.push({ id: "canonical:score", kind: "SCORE", value: String(qualityScore), provenance: "CANONICAL_EVALUATION" });
  add("OPERATING_LEVEL", projection?.operatingLevel?.value, "canonical:operating-level");
  add("WORK_NATURE", projection?.workNature?.value, "canonical:work-nature");
  add("DECISION_AUTHORITY", projection?.decisionAuthority?.value, "canonical:decision-authority");
  add("COMMERCIAL_SCOPE", projection?.commercialScope?.value, "canonical:commercial-scope");
  for (const capability of Array.isArray(projection?.capabilities) ? projection.capabilities : []) {
    if (typeof capability === "string") add("CAPABILITY", safeCapabilityLabel(capability), `canonical:capability:${capability}`, [normalized(capability)]);
    else if (capability && typeof capability === "object") add("CAPABILITY", safeCapabilityLabel(capability.name), `canonical:capability:${capability.name}`, [normalized(capability.canonicalConcept), normalized(capability.name)].filter(Boolean));
  }
  for (const dimension of Array.isArray(projection?.dimensions) ? projection.dimensions : []) {
    const value = typeof dimension === "object" && dimension
      ? dimension.jdEvidence?.value
      : undefined;
    add("DIMENSION", value, `canonical:dimension:${typeof dimension === "object" && dimension ? dimension.key : "unknown"}`);
  }
  if (principalRisk) signals.push({ id: "canonical:principal-risk", kind: "RISK", value: principalRisk, provenance: "CANONICAL_EVALUATION" });
  if (careerTradeoff) signals.push({ id: "canonical:career-tradeoff", kind: "TRADEOFF", value: careerTradeoff, provenance: "CANONICAL_EVALUATION" });
  for (const [index, hinge] of hinges.entries()) {
    signals.push({ id: `canonical:hinge:${index}`, kind: "HINGE", value: hinge.question, provenance: "CANONICAL_EVALUATION" });
  }
  return unique(signals, (signal) => signal.id);
}

function decisionDrivers(
  artifact: EvaluationArtifact,
  signals: readonly CanonicalEditorialSignal[],
): EditorialDecisionDrivers {
  const persistedTrace = decisionTrace(artifact);
  const components = persistedTrace
    ? persistedTrace.components
    : [
        ...(artifact.record?.decisionDrivers ?? []).map((driver: { factor: string }) => ({ dimension: driver.factor, state: "STRENGTH" as const })),
        ...(artifact.record?.decisionRisks ?? []).map((driver: { factor: string }) => ({ dimension: driver.factor, state: "CONSTRAINT" as const })),
      ];
  const signalsFor = (state: "STRENGTH" | "CONSTRAINT" | "UNKNOWN", prefix: string) => components
    .filter((component) => component.state === state)
    .map((component, index) => ({
      id: `canonical:driver:${prefix}:${index}`,
      kind: "DIMENSION" as const,
      value: meaningfulEditorialText(component.dimension) ?? component.dimension,
      provenance: "CANONICAL_EVALUATION" as const,
    }))
    .filter((signal) => Boolean(meaningfulEditorialText(signal.value)));
  const strengths = signalsFor("STRENGTH", "strength");
  const constraints = signalsFor("CONSTRAINT", "constraint");
  const unknowns = signalsFor("UNKNOWN", "unknown");
  const hinges = signals.filter((signal) => signal.kind === "HINGE");

  return {
    strengths,
    constraints,
    unknowns,
    hinges,
    // Hinge questions are useful source-grounded decision guidance, but are
    // not evidence that the historical canonical payload retained a scored
    // strength or constraint. Keep that distinction visible to Phase 3.
    availability: strengths.length || constraints.length || unknowns.length
      ? "PERSISTED_DRIVER_DETAIL"
      : "SCALAR_ONLY",
  };
}

function synthesisInputs(
  work: readonly PublishedRoleWork[],
  precedents: readonly CandidatePrecedent[],
  qualifications: readonly PublishedQualificationRequirement[],
  signals: readonly CanonicalEditorialSignal[],
): EditorialSynthesisInput[] {
  const inputs: EditorialSynthesisInput[] = [
    ...work.map((item) => ({ type: "EMPLOYER_FACT" as const, sourceEvidenceIds: [item.sourceEvidenceId] })),
    ...precedents.map((item) => ({ type: "CANDIDATE_FACT" as const, candidateEvidenceIds: item.evidenceIds })),
  ];
  if (work.length === 0) {
    inputs.push({ type: "EVIDENCE_LIMITATION", reason: "No bounded published responsibility or outcome is available from the exact employer source." });
  }
  if (signals.length > 0 || qualifications.length > 0) {
    inputs.push({
      type: "RADAR_INFERENCE",
      roleEvidenceIds: work.map((item) => item.sourceEvidenceId),
      canonicalSignalIds: signals.map((signal) => signal.id),
    });
  }
  return inputs;
}

function buildUnavailableContract(
  reasonCode: UnavailableReasonCode,
  options?: EditorialIntelligenceContractOptions,
): EditorialIntelligenceContract {
  const roleWork = options?.roleWorkEvidence ?? [];
  const qualifications = options?.presentationQualificationEvidence ?? [];

  const work: PublishedRoleWork[] = unique(
    roleWork
      .filter((atom) => atom.kind === "RESPONSIBILITY" || atom.kind === "OUTCOME")
      .map((atom) => ({
        kind: atom.kind as PublishedRoleWork["kind"],
        statement: normalized(atom.statement),
        sourceEvidenceId: normalized(atom.id),
        capabilityKeys: Array.isArray(atom.capabilityKeys)
          ? atom.capabilityKeys.map(safeCapabilityLabel).filter((key: string) => key !== "Relevant candidate precedent")
          : [],
      }))
      .filter((atom) => Boolean(atom.statement) && Boolean(atom.sourceEvidenceId)),
    (atom) => atom.sourceEvidenceId,
  );

  const contexts: PublishedRoleContext[] = unique(
    roleWork
      .filter((atom) => atom.kind === "ROLE_CONTEXT")
      .map((atom) => ({
        kind: "ROLE_CONTEXT" as const,
        statement: normalized(atom.statement),
        sourceEvidenceId: normalized(atom.id),
        capabilityKeys: Array.isArray(atom.capabilityKeys)
          ? atom.capabilityKeys.map(safeCapabilityLabel).filter((key: string) => key !== "Relevant candidate precedent")
          : [],
      }))
      .filter((atom) => Boolean(atom.statement) && Boolean(atom.sourceEvidenceId)),
    (atom) => atom.sourceEvidenceId,
  );

  const qualificationRequirements: PublishedQualificationRequirement[] = qualifications.map((atom) => {
    const statement = normalized(atom.statement);
    const capability = safeCapabilityLabel(Array.isArray(atom.capabilityKeys) ? atom.capabilityKeys[0] : undefined);
    return {
      capability: capability === "Relevant candidate precedent" ? "Published qualification" : capability,
      statement,
      materiality: "SUPPORTING" as const,
      sourceEvidenceIds: [normalized(atom.id)].filter(Boolean),
    };
  }).filter((q) => Boolean(q.statement));

  const outcomes = legacyPublishedRoleOutcomes(work);

  const canonical: CanonicalEditorialSignal[] = [
    {
      id: "canonical:verdict:unavailable",
      kind: "VERDICT",
      value: reasonCode,
      provenance: "CANONICAL_EVALUATION",
    },
  ];

  const inputs: EditorialSynthesisInput[] = [
    ...work.map((item) => ({ type: "EMPLOYER_FACT" as const, sourceEvidenceIds: [item.sourceEvidenceId] })),
  ];
  if (work.length === 0) {
    inputs.push({ type: "EVIDENCE_LIMITATION", reason: "No bounded published responsibility or outcome is available from the exact employer source." });
  }

  const provenance: EditorialEvidenceRef[] = [
    ...work.map((item) => ({ kind: "EMPLOYER_FACT" as const, text: item.statement, sourceId: item.sourceEvidenceId })),
    ...contexts.map((item) => ({ kind: "EMPLOYER_FACT" as const, text: item.statement, sourceId: item.sourceEvidenceId })),
    ...qualificationRequirements.map((qualification) => ({ kind: "EMPLOYER_FACT" as const, text: qualification.statement, sourceId: qualification.sourceEvidenceIds[0] })),
    ...canonical.map((signal) => ({ kind: "CANONICAL_SIGNAL" as const, text: signal.value, sourceId: signal.id })),
  ];

  return {
    version: "editorial-intelligence-v2",
    verdict: null,
    qualityScore: null,
    careerCase: null,
    principalRisk: null,
    careerTradeoff: null,
    whyNow: null,
    capabilityMatches: [],
    candidateCapabilities: [],
    candidateFitEvidence: [],
    candidatePrecedents: [],
    publishedRoleWork: work,
    roleContext: contexts,
    qualificationRequirements,
    canonicalSignals: canonical,
    decisionDrivers: {
      strengths: [],
      constraints: [],
      unknowns: [],
      hinges: [],
      availability: "SCALAR_ONLY",
    },
    synthesisInputs: inputs,
    publishedRoleOutcomes: outcomes,
    decisionHinges: [],
    positioningAngles: [],
    recommendedAction: null,
    provenance: unique(provenance, (item) => `${item.kind}:${item.text.toLowerCase()}`),
  };
}

function buildEvaluatedContract(
  artifact: EvaluationArtifact,
  candidateProjection: CandidateProjection,
  options?: EditorialIntelligenceContractOptions,
): EditorialIntelligenceContract {
  const opportunity = artifact.opportunity;
  const recommendation = opportunity?.engineRecommendation;
  const stored = artifact as EvaluationArtifact & { decision?: unknown; score?: unknown };
  const verdict = canonicalVerdict(stored.decision ?? recommendation?.engineVerdict);
  const qualityScore = typeof stored.score === "number"
    ? stored.score
    : typeof recommendation?.qualityScore === "number" ? recommendation.qualityScore : null;
  const careerTradeoff = meaningfulEditorialText(recommendation?.relativeDifferentiator)
    ?? meaningfulEditorialText(recommendation?.trajectoryUpside);
  const whyNow = meaningfulEditorialText(opportunity?.whyNow);
  const capabilityMatches = unique(
    textList((opportunity?.recommendationResult as { capabilityFit?: { matchedCapabilities?: unknown } } | undefined)?.capabilityFit?.matchedCapabilities),
    (capability) => capability.toLowerCase(),
  );
  const work = publishedRoleWork(artifact, options);
  const outcomes = legacyPublishedRoleOutcomes(work);
  const contexts = roleContext(artifact, options);
  const qualifications = allQualificationSignals(artifact, options);
  const precedents = candidatePrecedents(artifact, candidateProjection, outcomes);
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
  const qualificationRequirements = publishedQualificationRequirements(qualifications);
  const canonical = canonicalSignals(
    artifact,
    verdict,
    qualityScore,
    principalRisk,
    careerTradeoff,
    hinges,
  );
  const candidateCapabilitySignals = candidateCapabilities(candidateProjection);
  const fitEvidence = candidateFitEvidence(
    artifact,
    candidateCapabilitySignals,
    canonical,
    work,
    qualificationRequirements,
  );
  const drivers = decisionDrivers(artifact, canonical);
  const inputs = synthesisInputs(work, precedents, qualificationRequirements, canonical);
  const provenance: EditorialEvidenceRef[] = [
    ...precedents.map((precedent) => ({ kind: "CANDIDATE_FACT" as const, text: precedent.statement, sourceId: precedent.evidenceIds[0], confidence: precedent.confidence })),
    ...work.map((item) => ({ kind: "EMPLOYER_FACT" as const, text: item.statement, sourceId: item.sourceEvidenceId })),
    ...contexts.map((item) => ({ kind: "EMPLOYER_FACT" as const, text: item.statement, sourceId: item.sourceEvidenceId })),
    ...qualifications.map((qualification) => ({ kind: "EMPLOYER_FACT" as const, text: qualification.statement, sourceId: qualification.sourceEvidenceIds[0] })),
    ...canonical.map((signal) => ({ kind: "CANONICAL_SIGNAL" as const, text: signal.value, sourceId: signal.id })),
    ...[careerCase, principalRisk, careerTradeoff, whyNow, recommendedAction, ...positioningAngles]
      .filter((text): text is string => Boolean(text))
      .map((text) => ({ kind: "RADAR_INFERENCE" as const, text })),
  ];

  return {
    version: "editorial-intelligence-v2",
    verdict,
    qualityScore,
    careerCase,
    principalRisk,
    careerTradeoff,
    whyNow,
    capabilityMatches,
    candidateCapabilities: candidateCapabilitySignals,
    candidateFitEvidence: fitEvidence,
    candidatePrecedents: precedents,
    publishedRoleWork: work,
    roleContext: contexts,
    qualificationRequirements,
    canonicalSignals: canonical,
    decisionDrivers: drivers,
    synthesisInputs: inputs,
    publishedRoleOutcomes: outcomes,
    decisionHinges: hinges,
    positioningAngles,
    recommendedAction,
    provenance: unique(provenance, (item) => `${item.kind}:${item.text.toLowerCase()}`),
  };
}

/** Builds persisted editorial material without participating in canonical evaluation truth. */
export function buildEditorialIntelligenceContract(input: EditorialContractInput): EditorialIntelligenceContract;
export function buildEditorialIntelligenceContract(
  artifact: EvaluationArtifact,
  candidateProjection: CandidateProjection,
  options?: EditorialIntelligenceContractOptions,
): EditorialIntelligenceContract;
export function buildEditorialIntelligenceContract(
  inputOrArtifact: EditorialContractInput | EvaluationArtifact,
  maybeCandidateProjection?: CandidateProjection,
  maybeOptions?: EditorialIntelligenceContractOptions,
): EditorialIntelligenceContract {
  if ("state" in inputOrArtifact && (inputOrArtifact.state === "EVALUATED" || inputOrArtifact.state === "UNAVAILABLE")) {
    if (inputOrArtifact.state === "UNAVAILABLE") {
      return buildUnavailableContract(inputOrArtifact.reasonCode, inputOrArtifact.presentationEvidence);
    }
    return buildEvaluatedContract(inputOrArtifact.artifact, inputOrArtifact.candidateProjection, inputOrArtifact.presentationEvidence);
  }
  return buildEvaluatedContract(inputOrArtifact as EvaluationArtifact, maybeCandidateProjection!, maybeOptions);
}
