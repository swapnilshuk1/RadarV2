import { isDeepStrictEqual } from "node:util";
import type { CanonicalDossierPresentationV1 } from "@/lib/domain/dossier_presentation";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

export type DossierRefreshSelector =
  | { readonly kind: "canonical-job-id"; readonly canonicalJobId: string }
  | { readonly kind: "all" }
  | null;

export interface DossierRematerializationOptions {
  readonly apply: boolean;
  readonly refreshStale: boolean;
  readonly selector: DossierRefreshSelector;
}

export interface HistoricalOpportunityVersion {
  readonly canonicalJobId: string;
  readonly rawContent: string;
  readonly jobTitle: string;
  readonly companyName: string | null;
  readonly location: string | null;
}

export type DossierRematerializationClassification =
  | "CURRENT"
  | "STALE"
  | "MISSING_OR_INVALID_RECONSTRUCTABLE"
  | "CANONICAL_MISMATCH"
  | "UNSAFE";

export interface DossierCasRow {
  readonly id: string;
  readonly canonicalJobId: string;
  readonly opportunityVersion: string;
  readonly evaluationFingerprint: string;
  readonly decision: string | null;
  readonly qualityScore: number | null;
  readonly evaluationJson: string;
}

export interface DossierCasScope {
  readonly tenantId: string;
  readonly personId: string;
}

export interface DossierCasAdapter {
  execute(sql: string, params?: readonly unknown[]): Promise<{ rowsAffected: number }>;
}

export interface CanonicalEvaluationScalars {
  readonly decision: string | null;
  readonly score: number | null;
  readonly evaluationInputHash: string;
}

/** Explicitly parse the operator contract; stale writes are never broad by default. */
export function parseDossierRematerializationOptions(args: readonly string[]): DossierRematerializationOptions {
  const apply = args.includes("--apply");
  const refreshStale = args.includes("--refresh-stale");
  const jobIdArgs = args.filter((arg) => arg.startsWith("--canonical-job-id="));
  const all = args.includes("--all");
  if (jobIdArgs.length > 1 || (all && jobIdArgs.length > 0)) {
    throw new Error("Use exactly one stale refresh selector: --canonical-job-id=<id> or --all.");
  }
  const canonicalJobId = jobIdArgs[0]?.slice("--canonical-job-id=".length).trim();
  if (jobIdArgs.length > 0 && !canonicalJobId) {
    throw new Error("--canonical-job-id requires a non-empty canonical job id.");
  }
  const selector: DossierRefreshSelector = canonicalJobId
    ? { kind: "canonical-job-id", canonicalJobId }
    : all ? { kind: "all" }
    : null;
  if (refreshStale && apply && !selector) {
    throw new Error("--refresh-stale --apply requires --canonical-job-id=<id> or --all.");
  }
  return { apply, refreshStale, selector };
}

/** Matches EvaluationWorker: legacy extracted text is a source, not a parse failure. */
export function reconstructHistoricalOpportunitySource(version: HistoricalOpportunityVersion): OpportunitySource {
  try {
    const parsed = JSON.parse(version.rawContent) as OpportunitySource;
    parsed.jobHash ||= version.canonicalJobId;
    return parsed;
  } catch {
    return {
      jobHash: version.canonicalJobId,
      role: version.jobTitle,
      company: version.companyName ?? undefined,
      location: version.location ?? undefined,
      rawDescription: version.rawContent,
    } as OpportunitySource;
  }
}

/** generatedAt is materialization time; every other dossier-v1 field is semantic. */
export function presentationsAreSemanticallyEqual(
  persisted: CanonicalDossierPresentationV1,
  fresh: CanonicalDossierPresentationV1,
): boolean {
  return isDeepStrictEqual(
    { ...persisted, generatedAt: "__materialization_time_ignored__" },
    { ...fresh, generatedAt: "__materialization_time_ignored__" },
  );
}

export function selectsCanonicalJob(selector: DossierRefreshSelector, canonicalJobId: string): boolean {
  return selector?.kind === "all" || (selector?.kind === "canonical-job-id" && selector.canonicalJobId === canonicalJobId);
}

export function isRefreshEligible(classification: DossierRematerializationClassification): boolean {
  return classification === "STALE" || classification === "MISSING_OR_INVALID_RECONSTRUCTABLE";
}

/** No presentation write is permitted unless persisted and rebuilt scalar truth agree exactly. */
export function hasCanonicalReconstructionParity(
  persistedEvaluationInputHash: string,
  row: Pick<DossierCasRow, "decision" | "qualityScore" | "evaluationFingerprint">,
  reconstructed: CanonicalEvaluationScalars,
): boolean {
  return persistedEvaluationInputHash === row.evaluationFingerprint
    && reconstructed.decision === row.decision
    && reconstructed.score === row.qualityScore
    && reconstructed.evaluationInputHash === row.evaluationFingerprint;
}

/** A refresh apply selector scopes every write-capable presentation state. */
export function isSelectedForRematerialization(
  options: DossierRematerializationOptions,
  canonicalJobId: string,
): boolean {
  return !options.apply || !options.refreshStale || selectsCanonicalJob(options.selector, canonicalJobId);
}

export function shouldWriteDossierPresentation(
  options: DossierRematerializationOptions,
  classification: DossierRematerializationClassification,
  canonicalJobId: string,
): boolean {
  return options.apply
    && isRefreshEligible(classification)
    && isSelectedForRematerialization(options, canonicalJobId);
}

/** CAS writes presentation only; all canonical scalar truth remains a predicate. */
export async function writeDossierPresentationWithCas(
  db: DossierCasAdapter,
  scope: DossierCasScope,
  row: DossierCasRow,
  dossierPresentation: unknown,
): Promise<{ updated: number; casMiss: number }> {
  const persisted = JSON.parse(row.evaluationJson) as Record<string, unknown>;
  const write = await db.execute(
    `UPDATE materialized_evaluations SET evaluation_json = ?
     WHERE id = ? AND tenant_id = ? AND person_id = ? AND evaluation_fingerprint = ?
       AND decision IS ? AND quality_score IS ? AND evaluation_state = 'EVALUATED' AND evaluation_json = ?`,
    [JSON.stringify({ ...persisted, dossierPresentation }), row.id, scope.tenantId, scope.personId,
      row.evaluationFingerprint, row.decision, row.qualityScore, row.evaluationJson],
  );
  return write.rowsAffected === 1 ? { updated: 1, casMiss: 0 } : { updated: 0, casMiss: 1 };
}

export async function attemptDossierPresentationWrite(
  options: DossierRematerializationOptions,
  classification: DossierRematerializationClassification,
  db: DossierCasAdapter,
  scope: DossierCasScope,
  row: DossierCasRow,
  dossierPresentation: unknown,
): Promise<{ eligible: boolean; updated: number; casMiss: number }> {
  if (!shouldWriteDossierPresentation(options, classification, row.canonicalJobId)) {
    return { eligible: false, updated: 0, casMiss: 0 };
  }
  return { eligible: true, ...(await writeDossierPresentationWithCas(db, scope, row, dossierPresentation)) };
}
