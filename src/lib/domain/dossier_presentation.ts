export type DossierJsonPrimitive = string | number | boolean | null;
export type DossierJsonValue = DossierJsonPrimitive | DossierJsonObject | readonly DossierJsonValue[];
export type DossierJsonObject = { readonly [key: string]: DossierJsonValue };

/** Presentation material persisted with an evaluated artifact, never decision authority. */
export interface CanonicalDossierPresentationV1 {
  readonly schemaVersion: "dossier-v1";
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
export function isCanonicalDossierPresentationV1(value: unknown): value is CanonicalDossierPresentationV1 {
  if (!isObject(value)) return false;
  return value.schemaVersion === "dossier-v1"
    && typeof value.generatedAt === "string" && !Number.isNaN(Date.parse(value.generatedAt))
    && typeof value.evaluationInputHash === "string" && value.evaluationInputHash.trim().length > 0
    && isObject(value.brief)
    && isObject(value.jobProjection)
    && isObject(value.executionPackage)
    && Array.isArray(value.rawDimensions)
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
