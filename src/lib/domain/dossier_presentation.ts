import type { EditorialCompositionV2 } from "../intelligence/editorial/EditorialPropositionComposer";

export type DossierJsonPrimitive = string | number | boolean | null;
export type DossierJsonValue = DossierJsonPrimitive | DossierJsonObject | readonly DossierJsonValue[];
export type DossierJsonObject = { readonly [key: string]: DossierJsonValue };

/** Canonical presentation artifact for RADAR v2. Decoupled from evaluation JSON. */
export interface CanonicalDossierPresentationV2 {
  readonly schemaVersion: "dossier-v2";
  readonly editorialVersion: "editorial-composition-v2";

  readonly identity: {
    readonly tenantId: string;
    readonly personId: string;
    readonly canonicalJobId: string;
    readonly opportunityVersion: string;
    readonly evaluationContextFingerprint: string;
  };

  readonly evaluation: {
    readonly state: "EVALUATED" | "SPARSE_SPEC" | "NOT_EVALUABLE";
    readonly verdict: "PURSUE" | "CONSIDER" | "PASS" | null;
    readonly score: number | null;
    readonly fingerprint: string | null;
  };

  readonly composition: EditorialCompositionV2;
  readonly generatedAt: string;
}

/** Presentation material persisted with an evaluated artifact, never decision authority. */
export interface CanonicalDossierPresentationV1 {
  readonly schemaVersion: "dossier-v1";
  /** Versioned presentation intelligence; never canonical evaluation authority. */
  readonly editorialVersion: "grounded-editorial-v1";
  readonly editorialIntelligence: DossierJsonObject;
  readonly evaluatedAt?: string;
  readonly generatedAt: string;
  readonly evaluationInputHash: string;
  readonly brief: DossierJsonObject;
  readonly jobProjection: DossierJsonObject;
  readonly executionPackage: DossierJsonObject;
  readonly rawDimensions: readonly DossierJsonValue[];
  readonly focusTopic: string | null;
  readonly whyRoleExists: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Invalid presentation is omitted at serving time; it never invalidates v4.3 truth. */
const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Editorial sources deliberately express unavailable optional facts as null.
 * React renders null safely; accepting it here preserves that neutral state
 * without allowing an object or collection to reach a string-rendering path.
 */
const hasOptionalStrings = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => value[key] === undefined || value[key] === null || typeof value[key] === "string");

const hasRenderSafeObjectArray = (value: unknown, required: readonly string[] = [], optional: readonly string[] = []) =>
  Array.isArray(value) && value.every((item) => isObject(item)
    && required.every((key) => typeof item[key] === "string")
    && hasOptionalStrings(item, optional));

function hasRenderSafeRawDimensions(value: unknown): value is readonly DossierJsonObject[] {
  return Array.isArray(value) && value.every((dimension: unknown) =>
    isObject(dimension)
    && hasOptionalStrings(dimension, ["label"])
    && (dimension.jdEvidence === undefined
      || (isObject(dimension.jdEvidence) && hasOptionalStrings(dimension.jdEvidence, ["confidence"]))),
  );
}

function hasRenderSafeBrief(value: unknown): value is DossierJsonObject {
  if (!isObject(value) || !isObject(value.oneMinuteTLDR) || !isObject(value.strategicUpside) || !Array.isArray(value.proofPoints)) return false;
  if (!isStringArray(value.oneMinuteTLDR.whyPursue) || !isStringArray(value.oneMinuteTLDR.watchFor) || !isStringArray(value.strategicUpside.points)) return false;
  const sections = value.structuredSections;
  if (!isObject(sections) || !["context", "mandate", "synthesis", "evidence", "strategy"].every((key) => isObject(sections[key]) && hasOptionalStrings(sections[key], ["thesis", "transition", "body"]))) return false;
  if (!hasRenderSafeObjectArray(value.proofPoints, [], ["category", "headline", "dimension", "detail"])) return false;
  if (!hasOptionalStrings(value, ["headline", "fitLabel", "evidenceQuality", "executiveOpinion", "whyNotStronger", "frictionPreview", "topUnknownPreview", "whyItWorks", "watchFor"])) return false;
  if (!hasOptionalStrings(value.oneMinuteTLDR, ["bottomLine"])) return false;
  if (value.memory !== undefined && (!isObject(value.memory) || !hasOptionalStrings(value.memory, ["retentionSentence"]))) return false;
  if (value.pursuitStrategy !== undefined && (!isObject(value.pursuitStrategy)
    || typeof value.pursuitStrategy.pursuitMode !== "string"
    || !hasOptionalStrings(value.pursuitStrategy, ["bottomLine", "executiveLabel", "immediateNextAction", "stopCondition"]))) return false;
  if (value.executiveThesis !== undefined && (!isObject(value.executiveThesis)
    || !hasOptionalStrings(value.executiveThesis, ["headline", "primaryReason", "careerValueSignal"]))) return false;
  for (const key of ["explanation", "directives", "verdictGuidance"] as const) {
    if (value[key] !== undefined && (!isObject(value[key]) || !hasOptionalStrings(value[key], ["bottomLine", "careerValueSignal", "primaryReason", "actionNotice", "observation", "positioning"]))) return false;
  }
  return true;
}

function hasRenderSafeExecutionPackage(value: unknown): value is DossierJsonObject {
  if (!isObject(value) || !isStringArray(value.recommendationConditions) || !Array.isArray(value.screeningQuestions) || !Array.isArray(value.resumeGaps)) return false;
  if (!hasRenderSafeObjectArray(value.screeningQuestions, ["question", "whyItMatters"])) return false;
  if (!hasRenderSafeObjectArray(value.resumeGaps, [], ["category", "suggestionType", "currentNarrative", "suggestedRevision", "coachingGuidance"]) || !value.resumeGaps.every((gap) => isObject(gap) && (gap.candidateEvidenceQuotes === undefined || isStringArray(gap.candidateEvidenceQuotes)))) return false;
  return isObject(value.linkedInStrategy)
    && hasOptionalStrings(value.linkedInStrategy, ["recommendedHeadline", "executiveAboutFraming"])
    && typeof value.linkedInStrategy.recommendedHeadline === "string"
    && typeof value.linkedInStrategy.executiveAboutFraming === "string"
    && isObject(value.interviewPrep)
    && typeof value.interviewPrep.openingHook === "string"
    && typeof value.interviewPrep.keyThemeToEmphasize === "string"
    && typeof value.interviewPrep.panelQuestion === "string";
}

/** Render-safe presentation validation. Core v4.3 truth remains valid without it. */
export function isCanonicalDossierPresentationV1(value: unknown): value is CanonicalDossierPresentationV1 {
  if (!isObject(value)) return false;
  return value.schemaVersion === "dossier-v1"
    && value.editorialVersion === "grounded-editorial-v1"
    && isObject(value.editorialIntelligence)
    && typeof value.generatedAt === "string" && !Number.isNaN(Date.parse(value.generatedAt))
    && typeof value.evaluationInputHash === "string" && value.evaluationInputHash.trim().length > 0
    && (value.evaluatedAt === undefined || (typeof value.evaluatedAt === "string" && !Number.isNaN(Date.parse(value.evaluatedAt))))
    && hasRenderSafeBrief(value.brief)
    && isObject(value.jobProjection)
    && (value.jobProjection.executiveMission === undefined || (isObject(value.jobProjection.executiveMission)
      && (value.jobProjection.executiveMission.successConditions === undefined || isStringArray(value.jobProjection.executiveMission.successConditions))))
    && hasRenderSafeExecutionPackage(value.executionPackage)
    && hasRenderSafeRawDimensions(value.rawDimensions)
    && (value.focusTopic === null || typeof value.focusTopic === "string")
    && (value.whyRoleExists === null || typeof value.whyRoleExists === "string");
}

/** Makes the storage boundary explicit: the artifact contains JSON values only. */
export function asDossierJsonObject(value: unknown): DossierJsonObject {
  const serialized = JSON.stringify(value);
  if (!serialized) throw new Error("Dossier artifact is not JSON serializable");
  const parsed: unknown = JSON.parse(serialized);
  if (!isObject(parsed)) throw new Error("Dossier artifact must be a JSON object");
  return parsed as DossierJsonObject;
}

export function asDossierJsonArray(value: unknown): readonly DossierJsonValue[] {
  const serialized = JSON.stringify(value);
  if (!serialized) throw new Error("Dossier dimensions are not JSON serializable");
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed)) throw new Error("Dossier dimensions must be a JSON array");
  return parsed as readonly DossierJsonValue[];
}

const VALID_PROPOSITION_KINDS = new Set([
  "EMPLOYER_FACT",
  "CANDIDATE_FACT",
  "CANONICAL_EVALUATION",
  "RADAR_INFERENCE",
  "EVIDENCE_LIMITATION",
]);

function isValidProposition(item: unknown): boolean {
  if (!isObject(item)) return false;
  if (typeof item.id !== "string" || item.id.trim().length === 0) return false;
  if (typeof item.kind !== "string" || !VALID_PROPOSITION_KINDS.has(item.kind)) return false;
  if (typeof item.text !== "string" || item.text.trim().length === 0) return false;
  if (typeof item.semanticKey !== "string" || item.semanticKey.trim().length === 0) return false;
  if (typeof item.priority !== "number") return false;
  if (!isStringArray(item.roleEvidenceIds)) return false;
  if (!isStringArray(item.candidateEvidenceIds)) return false;
  if (!isStringArray(item.canonicalSignalIds)) return false;
  return true;
}

function isValidSection(section: unknown): boolean {
  if (!isObject(section)) return false;
  if (section.headline !== null && typeof section.headline !== "string") return false;
  if (!Array.isArray(section.propositions) || !section.propositions.every(isValidProposition)) return false;
  return true;
}

/**
 * Authoritative runtime validator for CanonicalDossierPresentationV2.
 * Enforces exact evaluation linkage invariants:
 * - state === EVALUATED: verdict, score, and fingerprint MUST be present and non-null.
 * - state !== EVALUATED: verdict, score, and fingerprint MUST be null.
 * - every proposition must carry valid kind, non-empty identifiers, and string arrays for evidence IDs.
 */
export function isCanonicalDossierPresentationV2(value: unknown): value is CanonicalDossierPresentationV2 {
  if (!isObject(value)) return false;
  if (value.schemaVersion !== "dossier-v2") return false;
  if (value.editorialVersion !== "editorial-composition-v2") return false;

  // Identity validation
  if (!isObject(value.identity)) return false;
  const { tenantId, personId, canonicalJobId, opportunityVersion, evaluationContextFingerprint } = value.identity;
  if (
    typeof tenantId !== "string" || tenantId.trim().length === 0 ||
    typeof personId !== "string" || personId.trim().length === 0 ||
    typeof canonicalJobId !== "string" || canonicalJobId.trim().length === 0 ||
    typeof opportunityVersion !== "string" || opportunityVersion.trim().length === 0 ||
    typeof evaluationContextFingerprint !== "string" || evaluationContextFingerprint.trim().length === 0
  ) {
    return false;
  }

  // Evaluation validation
  if (!isObject(value.evaluation)) return false;
  const ev = value.evaluation;
  if (ev.state !== "EVALUATED" && ev.state !== "SPARSE_SPEC" && ev.state !== "NOT_EVALUABLE") return false;

  if (ev.state === "EVALUATED") {
    if (ev.verdict !== "PURSUE" && ev.verdict !== "CONSIDER" && ev.verdict !== "PASS") return false;
    if (typeof ev.score !== "number" || Number.isNaN(ev.score)) return false;
    if (typeof ev.fingerprint !== "string" || ev.fingerprint.trim().length === 0) return false;
  } else {
    if (ev.verdict !== null) return false;
    if (ev.score !== null) return false;
    if (ev.fingerprint !== null) return false;
  }

  // Composition validation
  if (!isObject(value.composition)) return false;
  const comp = value.composition;
  if (comp.version !== "editorial-composition-v2") return false;
  if (typeof comp.compositionMode !== "string") return false;
  if (!Array.isArray(comp.propositions) || !comp.propositions.every(isValidProposition)) return false;
  if (!isObject(comp.sections)) return false;
  const sections = comp.sections;
  const requiredSections = ["hero", "whyAttention", "mandate", "candidatePositioning", "bottomLine", "howToWin", "verify"] as const;
  for (const s of requiredSections) {
    if (!isValidSection(sections[s])) return false;
  }

  // GeneratedAt validation
  if (typeof value.generatedAt !== "string" || Number.isNaN(Date.parse(value.generatedAt))) return false;

  return true;
}
