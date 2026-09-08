import { isMeaningfulEvidenceQuote } from "@/domain/evidence";
import type { CandidateProjection } from "@/lib/domain/candidate_projection";
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

function normalized(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function meaningfulEditorialText(value: unknown): string | null {
  const text = normalized(value);
  if (!text) return null;
  return GENERIC_EDITORIAL_TEXT.some((generic) => text.toLowerCase().includes(generic))
    ? null
    : text;
}

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
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

function canonicalVerdict(value: unknown): EditorialIntelligenceContract["verdict"] {
  return value === "PURSUE" || value === "CONSIDER" || value === "PASS" ? value : null;
}

function candidatePrecedents(projection: CandidateProjection): CandidatePrecedent[] {
  const precedents: CandidatePrecedent[] = [];
  for (const capability of projection.inferredCapabilities ?? []) {
    if (capability.confidence < 0.7) continue;
    for (const evidence of capability.supportingEvidence ?? []) {
      const statement = substantiveCandidateEvidence(evidence.quote);
      if (!statement) continue;
      precedents.push({
        capability: normalized(capability.name) || "Relevant candidate precedent",
        statement,
        evidenceIds: unique(
          [...capability.evidenceIds, evidence.id].filter(Boolean),
          (id) => id,
        ),
        confidence: capability.confidence,
      });
    }
  }
  return unique(precedents, (precedent) => precedent.statement.toLowerCase());
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
      if (!isMeaningfulEvidenceQuote(statement)) continue;
      outcomes.push({ statement, dimensionKey: String(dimension.key) });
    }
  }
  return unique(outcomes, (outcome) => outcome.statement.toLowerCase()).slice(0, 5);
}

function decisionHinges(
  artifact: EvaluationArtifact,
  outcomes: readonly PublishedRoleOutcome[],
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
  if (principalRisk) {
    add("Principal risk", `What evidence would resolve this risk: ${principalRisk}?`, "RADAR recorded this as the material decision risk.");
  } else if (careerTradeoff) {
    add("Career tradeoff", `How does the role resolve this tradeoff: ${careerTradeoff}?`, "RADAR recorded this as the career tradeoff.");
  }
  return unique(hinges, (hinge) => hinge.topic).slice(0, 3);
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
  const careerCase = meaningfulEditorialText(opportunity?.primaryDriver)
    ?? meaningfulEditorialText(recommendation?.relativeDifferentiator);
  const principalRisk = meaningfulEditorialText(opportunity?.primaryRisk)
    ?? meaningfulEditorialText(opportunity?.hiringRisk);
  const careerTradeoff = meaningfulEditorialText(recommendation?.relativeDifferentiator)
    ?? meaningfulEditorialText(recommendation?.trajectoryUpside);
  const whyNow = meaningfulEditorialText(opportunity?.whyNow);
  const capabilityMatches = unique(
    textList((opportunity?.recommendationResult as { capabilityFit?: { matchedCapabilities?: unknown } } | undefined)?.capabilityFit?.matchedCapabilities),
    (capability) => capability.toLowerCase(),
  );
  const precedents = candidatePrecedents(candidateProjection);
  const outcomes = publishedRoleOutcomes(artifact);
  const positioningAngles = unique(textList(opportunity?.positioning), (angle) => angle.toLowerCase());
  const recommendedAction = meaningfulEditorialText(opportunity?.recommendedAction);
  const hinges = decisionHinges(artifact, outcomes, principalRisk, careerTradeoff);
  const provenance: EditorialEvidenceRef[] = [
    ...precedents.map((precedent) => ({ kind: "CANDIDATE_FACT" as const, text: precedent.statement, sourceId: precedent.evidenceIds[0], confidence: precedent.confidence })),
    ...outcomes.map((outcome) => ({ kind: "EMPLOYER_FACT" as const, text: outcome.statement })),
    ...[careerCase, principalRisk, careerTradeoff, whyNow, recommendedAction]
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
