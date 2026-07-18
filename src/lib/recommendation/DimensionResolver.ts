import type { CandidateProfile } from "../../domain/entities";
import type { JobSlice, DimensionValue } from "./DeterministicScorer";

export interface ResolvedEvidence {
  value: string | number | boolean | null;
  source: "explicit" | "derived" | "regex" | "llm" | "imported" | "none";
  attribute: string;
  confidence?: number;
  evidenceSnippet?: string;
  resolvedBy?: string;
}

export type ResolverStrategy = (
  job: JobSlice,
  profile: CandidateProfile,
  dimensionKey: string
) => ResolvedEvidence;

export class DimensionResolver {
  private registry = new Map<string, ResolverStrategy>();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register a custom resolver strategy for a policy dimension.
   */
  public register(dimensionKey: string, strategy: ResolverStrategy): void {
    this.registry.set(dimensionKey, strategy);
  }

  /**
   * Resolve evidence for a given dimension key from the job slice and candidate profile.
   */
  public resolve(
    dimensionKey: string,
    job: JobSlice,
    profile: CandidateProfile
  ): ResolvedEvidence {
    const strategy = this.registry.get(dimensionKey);
    if (strategy) {
      return strategy(job, profile, dimensionKey);
    }
    return this.defaultStrategy(job, profile, dimensionKey);
  }

  private registerDefaults(): void {
    // 1. Map leadershipLevel to requiredLevel or derived from reportingLine if missing
    this.registry.set("leadershipLevel", (job, profile, key) => {
      const explicit = job.dimensions["leadershipLevel"];
      if (explicit && explicit.value !== undefined && explicit.value !== null) {
        return this.mapDimensionValue(explicit, "leadershipLevel", "DefaultResolver");
      }

      const required = job.dimensions["requiredLevel"];
      if (required && required.value !== undefined && required.value !== null) {
        return this.mapDimensionValue(required, "requiredLevel", "AliasRegistry");
      }

      const reporting = job.dimensions["reportingLine"];
      if (reporting && reporting.value !== undefined && reporting.value !== null) {
        const repVal = String(reporting.value).toUpperCase();
        if (["CEO", "BOARD", "EXECUTIVE_COMMITTEE"].includes(repVal)) {
          return {
            value: "Director",
            source: "derived",
            attribute: "reportingLine",
            confidence: 0.80,
            evidenceSnippet: reporting.evidence,
            resolvedBy: "ReportingLineToLeadershipResolver",
          };
        }
      }

      return this.missingEvidenceResult(key);
    });

    // 2. Map transformation derived from mandate if missing
    this.registry.set("transformation", (job, profile, key) => {
      const explicit = job.dimensions["transformation"];
      if (explicit && explicit.value !== undefined && explicit.value !== null) {
        return this.mapDimensionValue(explicit, "transformation", "DefaultResolver");
      }

      const mandate = job.dimensions["mandate"];
      if (mandate && mandate.value !== undefined && mandate.value !== null) {
        const valStr = String(mandate.value).toLowerCase();
        if (valStr.match(/transform|turnaround|pivot|restruct|align/)) {
          return {
            value: "transformation mandate derived from mandate",
            source: "derived",
            attribute: "mandate",
            confidence: 0.75,
            evidenceSnippet: mandate.evidence,
            resolvedBy: "TransformationKeywordResolver",
          };
        }
      }

      return this.missingEvidenceResult(key);
    });
  }

  private defaultStrategy(
    job: JobSlice,
    profile: CandidateProfile,
    dimensionKey: string
  ): ResolvedEvidence {
    const dim = job.dimensions[dimensionKey];
    if (dim && dim.value !== undefined && dim.value !== null) {
      return this.mapDimensionValue(dim, dimensionKey, "DefaultResolver");
    }
    return this.missingEvidenceResult(dimensionKey);
  }

  private mapDimensionValue(dim: DimensionValue, attribute: string, resolvedBy: string): ResolvedEvidence {
    // Determine exact provenance types
    let source: ResolvedEvidence["source"] = "explicit";
    if (dim.confidence !== undefined && dim.confidence < 1.0) {
      source = "llm";
    }

    return {
      value: dim.value,
      source,
      attribute,
      confidence: dim.confidence,
      evidenceSnippet: dim.evidence,
      resolvedBy,
    };
  }

  private missingEvidenceResult(attribute: string): ResolvedEvidence {
    return {
      value: null,
      source: "none",
      attribute,
      resolvedBy: "None",
    };
  }
}
