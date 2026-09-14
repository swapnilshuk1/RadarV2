import crypto from "crypto";
import type {
  CandidateProofOutputV1,
} from "./CandidateProofExtractorV1";
import type {
  RoleIntelligenceOutputV1,
} from "./RoleIntelligenceExtractorV1";
import type {
  CandidateDocumentSourceRef,
  OpportunityVersionSourceRef,
} from "@/lib/domain/source_provenance";

/**
 * Batch 02 provider contract. Providers propose source-grounded extraction
 * output; they do not own source resolution, persistence, or production
 * authority. Those responsibilities remain outside this experimental seam.
 */
export interface ExtractionProviderDescriptor {
  readonly family: "DETERMINISTIC" | "LLM";
  readonly providerId: string;
  readonly schemaVersion: "role-intelligence/v1" | "candidate-proof/v1";
  readonly configurationFingerprint: string;
}

export interface ProviderCacheIdentity {
  readonly key: string;
  readonly sourceIdentity: string;
  readonly providerId: string;
  readonly schemaVersion: string;
  readonly configurationFingerprint: string;
}

export interface RoleExtractionProviderInput {
  readonly source: OpportunityVersionSourceRef;
  readonly sourceText: string;
  readonly caseId: string;
  readonly companyName?: string;
  readonly title?: string;
}

export interface CandidateExtractionProviderInput {
  readonly source: CandidateDocumentSourceRef;
  readonly sourceText: string;
}

export interface ProviderExtractionResult<T> {
  readonly provider: ExtractionProviderDescriptor;
  readonly cacheIdentity: ProviderCacheIdentity;
  readonly source: CandidateDocumentSourceRef | OpportunityVersionSourceRef;
  readonly output: T;
}

export interface RoleIntelligenceExtractionProvider {
  readonly descriptor: ExtractionProviderDescriptor & {
    readonly schemaVersion: "role-intelligence/v1";
  };
  extract(
    input: RoleExtractionProviderInput,
  ): Promise<ProviderExtractionResult<RoleIntelligenceOutputV1>>;
}

export interface CandidateProofExtractionProvider {
  readonly descriptor: ExtractionProviderDescriptor & {
    readonly schemaVersion: "candidate-proof/v1";
  };
  extract(
    input: CandidateExtractionProviderInput,
  ): Promise<ProviderExtractionResult<CandidateProofOutputV1>>;
}

/**
 * Batch 03 will supply implementations of these contracts. Declaring them in
 * Batch 02 deliberately grants no model, transport, cache, or serving
 * authority to an LLM provider.
 */
export interface LlmRoleIntelligenceExtractionProvider
  extends RoleIntelligenceExtractionProvider {
  readonly descriptor: ExtractionProviderDescriptor & {
    readonly family: "LLM";
    readonly schemaVersion: "role-intelligence/v1";
  };
}

export interface LlmCandidateProofExtractionProvider
  extends CandidateProofExtractionProvider {
  readonly descriptor: ExtractionProviderDescriptor & {
    readonly family: "LLM";
    readonly schemaVersion: "candidate-proof/v1";
  };
}

function stableSourceIdentity(
  source: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
): string {
  if (source.kind === "CANDIDATE_DOCUMENT_TEXT") {
    return [
      source.kind,
      source.personId,
      source.documentId,
      source.documentHash,
      source.textHash,
    ].join(":");
  }

  return [
    source.kind,
    source.canonicalJobId,
    source.opportunityVersion,
    source.contentHash,
    source.sourcePayloadKey ?? "DATABASE_TEXT",
    source.sourcePayloadSha256 ?? "NO_BLOB",
  ].join(":");
}

/**
 * Cache identity intentionally contains no mutable "latest" source pointer.
 * A provider result can only be reused for the exact immutable source and
 * extraction configuration that produced it.
 */
export function createProviderCacheIdentity(
  source: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
  descriptor: ExtractionProviderDescriptor,
): ProviderCacheIdentity {
  const sourceIdentity = stableSourceIdentity(source);
  const material = [
    sourceIdentity,
    descriptor.providerId,
    descriptor.schemaVersion,
    descriptor.configurationFingerprint,
  ].join("\n");
  return {
    key: crypto.createHash("sha256").update(material).digest("hex"),
    sourceIdentity,
    providerId: descriptor.providerId,
    schemaVersion: descriptor.schemaVersion,
    configurationFingerprint: descriptor.configurationFingerprint,
  };
}
