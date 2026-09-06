export type DossierJsonPrimitive = string | number | boolean | null;
export type DossierJsonValue = DossierJsonPrimitive | DossierJsonObject | readonly DossierJsonValue[];
export type DossierJsonObject = { readonly [key: string]: DossierJsonValue };

/** Presentation material persisted with an evaluated artifact, never decision authority. */
export interface CanonicalDossierPresentationV1 {
  readonly schemaVersion: "dossier-v1";
  /** Historical evaluation time; distinct from dossier materialization time. */
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

const hasOptionalStrings = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => value[key] === undefined || typeof value[key] === "string");

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
