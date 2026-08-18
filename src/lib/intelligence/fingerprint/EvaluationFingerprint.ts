/**
 * src/lib/intelligence/fingerprint/EvaluationFingerprint.ts
 *
 * RADAR V4 Canonical Intrinsic Evaluation Fingerprinting & Freshness Engine
 *
 * Invariant Contract:
 * Intrinsic Evaluation Truth = H(Candidate Intrinsic State + Opportunity Intrinsic State + PolicyVersion + OntologyVersion)
 *
 * STRICT EXCLUSIONS:
 * - Attention Window & Headspace Saturation
 * - Active Pursuit Counts
 * - User Decisions & Overrides
 * - Serving Time Recommendation Copy
 * - UI Badges, Display Scores, Filters, and Population Ranking
 */

import { createHash } from "node:crypto";
import type { CandidateProjection } from "../../domain/candidate_projection";
import type { JobProjection } from "../../domain/job_projection";
import type { OpportunitySource } from "../../../data/opportunity-fixtures";

export type FingerprintClassification = "CANONICAL_V4" | "LEGACY_NON_CANONICAL";
export type EvaluationFreshnessState = "FRESH" | "STALE" | "LEGACY";

export interface IntrinsicCandidateInput {
  readonly operatingLevel: string;
  readonly candidateSeniorityLevel?: string;
  readonly workNature: string;
  readonly decisionAuthority: string;
  readonly commercialScope: string;
  readonly yearsOfExperience: number;
  readonly coreCapabilities: readonly string[];
  readonly preferredLocations: readonly string[];
  readonly preferredWorkModel: string;
  readonly executiveThemes: readonly string[];
}

export interface IntrinsicOpportunityDimension {
  readonly key: string;
  readonly importance: string;
  readonly bucket: string;
  readonly value: string;
  readonly quote: string;
}

export interface IntrinsicOpportunityInput {
  readonly jobHash: string;
  readonly role: string;
  readonly company: string;
  readonly location: string;
  readonly workModel: string;
  readonly description: string;
  readonly dimensions: readonly IntrinsicOpportunityDimension[];
}

export interface IntrinsicEvaluationInput {
  readonly schema: "radar_intrinsic_input_v1";
  readonly candidate: IntrinsicCandidateInput;
  readonly opportunity: IntrinsicOpportunityInput;
  readonly policyVersion: string;
  readonly ontologyVersion: string;
}

/**
 * Pure Recursive Canonicalizer:
 * Produces a stable, deterministic string representation regardless of JavaScript object key insertion order.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const elements = value.map((elem) => canonicalize(elem));
    return `[${elements.join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();

    const parts = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`);
    return `{${parts.join(",")}}`;
  }

  return JSON.stringify(String(value));
}

/**
 * Computes a deterministic, cryptographically secure SHA-256 fingerprint for canonical serialization.
 * Output format: eval_v4_<64_hex_chars>
 */
export function computeCanonicalFingerprint(input: unknown): string {
  const canonicalString = canonicalize(input);
  const hash = createHash("sha256").update(canonicalString, "utf8").digest("hex");
  return `eval_v4_${hash}`;
}

/**
 * Classifies whether a stored fingerprint is a canonical V4 SHA-256 fingerprint or a legacy 32-bit hash.
 */
export function classifyFingerprint(fingerprint: string | null | undefined): FingerprintClassification {
  if (!fingerprint || typeof fingerprint !== "string") {
    return "LEGACY_NON_CANONICAL";
  }
  // Canonical V4 format: eval_v4_ followed by exactly 64 lowercase/uppercase hex characters
  if (/^eval_v4_[a-fA-F0-9]{64}$/.test(fingerprint)) {
    return "CANONICAL_V4";
  }
  return "LEGACY_NON_CANONICAL";
}

/**
 * Authoritative Intrinsic Input Contract:
 * Extracts ONLY the intrinsic candidate and opportunity state that can alter intrinsic evaluation truth.
 * Contextual serving parameters (headspace, active pursuits, attention window, user decisions, UI state)
 * are strictly and explicitly omitted.
 */
export function buildIntrinsicEvaluationInput(
  candidate: CandidateProjection | Record<string, any>,
  opportunity: JobProjection | OpportunitySource | Record<string, any>,
  policyVersion: string = "v4.3",
  ontologyVersion: string = "v2"
): IntrinsicEvaluationInput {
  const cand = candidate as Record<string, any>;
  const opp = opportunity as Record<string, any>;

  // 1. Extract Candidate Intrinsic Properties
  const operatingLevel =
    typeof cand.operatingLevel === "object" && cand.operatingLevel?.value
      ? String(cand.operatingLevel.value)
      : String(cand.operatingLevel || "UNKNOWN");

  const candidateSeniorityLevel =
    typeof cand.candidateSeniorityLevel === "object" && cand.candidateSeniorityLevel?.value
      ? String(cand.candidateSeniorityLevel.value)
      : cand.candidateSeniorityLevel
        ? String(cand.candidateSeniorityLevel)
        : undefined;

  const workNature =
    typeof cand.workNature === "object" && cand.workNature?.value
      ? String(cand.workNature.value)
      : String(cand.workNature || "UNKNOWN");

  const decisionAuthority =
    typeof cand.decisionAuthority === "object" && cand.decisionAuthority?.value
      ? String(cand.decisionAuthority.value)
      : String(cand.decisionAuthority || "UNKNOWN");

  const commercialScope =
    typeof cand.commercialScope === "object" && cand.commercialScope?.value
      ? String(cand.commercialScope.value)
      : String(cand.commercialScope || "UNKNOWN");

  const yearsOfExperience =
    typeof cand.yearsOfExperience === "number" && Number.isFinite(cand.yearsOfExperience)
      ? cand.yearsOfExperience
      : 0;

  const coreCapabilities = Array.isArray(cand.coreCapabilities)
    ? [...cand.coreCapabilities].map((s) => String(s).trim()).filter(Boolean).sort()
    : [];

  const preferredLocations = Array.isArray(cand.preferredLocations)
    ? [...cand.preferredLocations].map((s) => String(s).trim()).filter(Boolean).sort()
    : [];

  const preferredWorkModel = String(cand.preferredWorkModel || "ANY");

  const executiveThemes = Array.isArray(cand.executiveThemes)
    ? [...cand.executiveThemes].map((s) => String(s).trim()).filter(Boolean).sort()
    : [];

  const candidateInput: IntrinsicCandidateInput = {
    operatingLevel,
    candidateSeniorityLevel,
    workNature,
    decisionAuthority,
    commercialScope,
    yearsOfExperience,
    coreCapabilities,
    preferredLocations,
    preferredWorkModel,
    executiveThemes,
  };

  // 2. Extract Opportunity Intrinsic Properties
  const jobHash = String(opp.jobHash || opp.id || "");
  const role = String(opp.role || opp.title || opp.canonical_title || "").trim();
  const company = String(opp.company || opp.companyName || "").trim();
  const location = String(opp.location || "").trim();
  const workModel = String(opp.workModel || opp.preferredWorkModel || "UNKNOWN").trim();
  const description = String(
    opp.rawDescription ||
      opp.description ||
      opp.rawText ||
      opp.normalizedText ||
      ""
  ).trim();

  // Extract structured dimensions participating in evaluation
  const rawDims: any[] = Array.isArray(opp.dimensions) ? opp.dimensions : [];
  const dimensions: IntrinsicOpportunityDimension[] = rawDims
    .map((d) => ({
      key: String(d.key || "mandate").trim(),
      importance: String(d.importance || "Core").trim(),
      bucket: String(d.bucket || "Missing").trim(),
      value: String(d.value || d.jdEvidence?.value || "").trim(),
      quote: String(d.quote || d.jdEvidence?.evidence?.[0]?.quote || "").trim(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value));

  const opportunityInput: IntrinsicOpportunityInput = {
    jobHash,
    role,
    company,
    location,
    workModel,
    description,
    dimensions,
  };

  return {
    schema: "radar_intrinsic_input_v1",
    candidate: candidateInput,
    opportunity: opportunityInput,
    policyVersion: String(policyVersion),
    ontologyVersion: String(ontologyVersion),
  };
}

/**
 * Computes the canonical intrinsic evaluation fingerprint for candidate and opportunity inputs.
 */
export function computeIntrinsicFingerprint(
  candidate: CandidateProjection | Record<string, any>,
  opportunity: JobProjection | OpportunitySource | Record<string, any>,
  policyVersion: string = "v4.3",
  ontologyVersion: string = "v2"
): string {
  const intrinsicInput = buildIntrinsicEvaluationInput(candidate, opportunity, policyVersion, ontologyVersion);
  return computeCanonicalFingerprint(intrinsicInput);
}

/**
 * Authoritative Evaluation Freshness Comparator:
 * Distinguishes between FRESH, STALE, and LEGACY evaluations without conflating contextual changes.
 */
export function isEvaluationFresh(
  storedEvaluation:
    | {
        evaluationInputHash?: string;
        evaluation_input_hash?: string;
        schemaVersion?: string;
      }
    | null
    | undefined,
  currentIntrinsicFingerprint: string
): EvaluationFreshnessState {
  if (!storedEvaluation) {
    return "STALE";
  }

  const storedHash =
    storedEvaluation.evaluationInputHash ||
    storedEvaluation.evaluation_input_hash ||
    (storedEvaluation as any).input_hash ||
    (storedEvaluation as any).evaluationFingerprint;

  if (!storedHash || classifyFingerprint(storedHash) === "LEGACY_NON_CANONICAL") {
    return "LEGACY";
  }

  if (storedHash === currentIntrinsicFingerprint) {
    return "FRESH";
  }

  return "STALE";
}
