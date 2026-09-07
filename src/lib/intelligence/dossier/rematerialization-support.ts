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
