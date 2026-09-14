import type {
  CandidateProofExtractionProvider,
  ProviderExtractionResult,
  RoleIntelligenceExtractionProvider,
} from "./ExtractionProvider";
import type { CandidateProofOutputV1 } from "./CandidateProofExtractorV1";
import type { RoleIntelligenceOutputV1 } from "./RoleIntelligenceExtractorV1";
import { MechanicalExtractionVerifier } from "./MechanicalExtractionVerifier";
import type {
  CandidateDocumentSourceRef,
  OpportunityVersionSourceRef,
} from "@/lib/domain/source_provenance";
import { SourceSnapshotResolver } from "@/lib/provenance/SourceSnapshotResolver";

/**
 * The only Batch 02 execution seam. It resolves immutable source text before a
 * provider runs, then validates the returned output against that same snapshot.
 * It is intentionally not wired into production extraction in this batch.
 */
export class VerifiedExtractionProviderRunner {
  constructor(
    private readonly sourceResolver: SourceSnapshotResolver,
    private readonly verifier = new MechanicalExtractionVerifier(),
  ) {}

  async runRole(
    provider: RoleIntelligenceExtractionProvider,
    input: {
      source: OpportunityVersionSourceRef;
      caseId: string;
      companyName?: string;
      title?: string;
    },
  ): Promise<ProviderExtractionResult<RoleIntelligenceOutputV1>> {
    const snapshot = await this.sourceResolver.resolve(input.source);
    const sourceText = this.requireText(snapshot.text);
    const result = await provider.extract({ ...input, sourceText });
    this.assertReturnedSource(input.source, result.source);
    if (result.output.caseId !== input.caseId) {
      throw new Error("Extraction provider returned a role output for a different requested case ID.");
    }
    if (input.companyName !== undefined && result.output.companyName !== input.companyName) {
      throw new Error("Extraction provider returned a role output for a different requested company context.");
    }
    if (input.title !== undefined && result.output.title !== input.title) {
      throw new Error("Extraction provider returned a role output for a different requested title context.");
    }
    this.verifier.verifyRole(input.source, snapshot, result.output);
    return result;
  }

  async runCandidate(
    provider: CandidateProofExtractionProvider,
    input: { source: CandidateDocumentSourceRef },
  ): Promise<ProviderExtractionResult<CandidateProofOutputV1>> {
    const snapshot = await this.sourceResolver.resolve(input.source);
    const sourceText = this.requireText(snapshot.text);
    const result = await provider.extract({ ...input, sourceText });
    this.assertReturnedSource(input.source, result.source);
    this.verifier.verifyCandidate(input.source, snapshot, result.output);
    return result;
  }

  private requireText(text: string | null): string {
    if (text === null) {
      throw new Error("Extraction providers require an exact text source snapshot.");
    }
    return text;
  }

  private assertReturnedSource(
    expected: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
    returned: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
  ): void {
    if (JSON.stringify(expected) !== JSON.stringify(returned)) {
      throw new Error("Extraction provider returned output for a different immutable source identity.");
    }
  }
}
