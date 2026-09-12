import {
  createProviderCacheIdentity,
  type CandidateExtractionProviderInput,
  type CandidateProofExtractionProvider,
  type ProviderExtractionResult,
  type RoleExtractionProviderInput,
  type RoleIntelligenceExtractionProvider,
} from "./ExtractionProvider";
import {
  CandidateProofExtractorV1,
  type CandidateProofOutputV1,
} from "./CandidateProofExtractorV1";
import {
  RoleIntelligenceExtractorV1,
  type RoleIntelligenceOutputV1,
} from "./RoleIntelligenceExtractorV1";

const ROLE_DESCRIPTOR = {
  family: "DETERMINISTIC" as const,
  providerId: "adbfc37-role-intelligence-v1",
  schemaVersion: "role-intelligence/v1" as const,
  configurationFingerprint: "RoleIntelligenceExtractorV1",
};

const CANDIDATE_DESCRIPTOR = {
  family: "DETERMINISTIC" as const,
  providerId: "adbfc37-candidate-proof-v1",
  schemaVersion: "candidate-proof/v1" as const,
  configurationFingerprint: "CandidateProofExtractorV1",
};

/**
 * Adapter only: this calls the frozen V1 extractor without transforming its
 * output. Production has not been rewired to call this adapter in Batch 02.
 */
export class DeterministicRoleIntelligenceProvider
  implements RoleIntelligenceExtractionProvider {
  public readonly descriptor = ROLE_DESCRIPTOR;

  constructor(private readonly extractor = new RoleIntelligenceExtractorV1()) {}

  async extract(
    input: RoleExtractionProviderInput,
  ): Promise<ProviderExtractionResult<RoleIntelligenceOutputV1>> {
    return {
      provider: this.descriptor,
      cacheIdentity: createProviderCacheIdentity(input.source, this.descriptor),
      source: input.source,
      output: this.extractor.extract({
        caseId: input.caseId,
        canonicalJobId: input.source.canonicalJobId,
        rawText: input.sourceText,
        companyName: input.companyName,
        title: input.title,
      }),
    };
  }
}

/** See DeterministicRoleIntelligenceProvider. */
export class DeterministicCandidateProofProvider
  implements CandidateProofExtractionProvider {
  public readonly descriptor = CANDIDATE_DESCRIPTOR;

  constructor(private readonly extractor = new CandidateProofExtractorV1()) {}

  async extract(
    input: CandidateExtractionProviderInput,
  ): Promise<ProviderExtractionResult<CandidateProofOutputV1>> {
    return {
      provider: this.descriptor,
      cacheIdentity: createProviderCacheIdentity(input.source, this.descriptor),
      source: input.source,
      output: this.extractor.extract({
        sourceDocumentId: input.source.documentId,
        rawText: input.sourceText,
      }),
    };
  }
}
