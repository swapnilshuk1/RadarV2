import {
  createProviderCacheIdentity,
  type CandidateProofExtractionProvider,
  type ProviderExtractionResult,
  type RoleIntelligenceExtractionProvider,
} from "./ExtractionProvider";
import { type CandidateProofOutputV1 } from "./CandidateProofExtractorV1";
import { type RoleIntelligenceOutputV1 } from "./RoleIntelligenceExtractorV1";
import { VerifiedExtractionProviderRunner } from "./VerifiedExtractionProviderRunner";
import type { CandidateDocumentSourceRef, OpportunityVersionSourceRef } from "@/lib/domain/source_provenance";

export type ExperimentalExtractionOutcome<T> =
  | { readonly state: "VERIFIED"; readonly result: ProviderExtractionResult<T> }
  | { readonly state: "REJECTED"; readonly rejection: ExperimentalExtractionRejection };

export interface ExperimentalExtractionRejection {
  readonly sourceIdentity: string;
  readonly providerId: string;
  readonly cacheKey: string;
  readonly reason: string;
}

export interface ExperimentalExtractionObserver {
  record(outcome: ExperimentalExtractionOutcome<unknown>): void | Promise<void>;
}

/**
 * Batch 03 observation boundary. Rejections are deliberately returned as
 * experimental outcomes and are never repaired, persisted, or reclassified as
 * canonical source facts.
 */
export class ExperimentalLlmExtractionExecutor {
  constructor(
    private readonly runner: VerifiedExtractionProviderRunner,
    private readonly observer?: ExperimentalExtractionObserver,
  ) {}

  async runRole(
    provider: RoleIntelligenceExtractionProvider,
    input: { source: OpportunityVersionSourceRef; caseId: string; companyName?: string; title?: string },
  ): Promise<ExperimentalExtractionOutcome<RoleIntelligenceOutputV1>> {
    try {
      const outcome: ExperimentalExtractionOutcome<RoleIntelligenceOutputV1> = {
        state: "VERIFIED",
        result: await this.runner.runRole(provider, input),
      };
      await this.observer?.record(outcome);
      return outcome;
    } catch (error) {
      return this.reject(provider, input.source, error);
    }
  }

  async runCandidate(
    provider: CandidateProofExtractionProvider,
    input: { source: CandidateDocumentSourceRef },
  ): Promise<ExperimentalExtractionOutcome<CandidateProofOutputV1>> {
    try {
      const outcome: ExperimentalExtractionOutcome<CandidateProofOutputV1> = {
        state: "VERIFIED",
        result: await this.runner.runCandidate(provider, input),
      };
      await this.observer?.record(outcome);
      return outcome;
    } catch (error) {
      return this.reject(provider, input.source, error);
    }
  }

  private async reject<T>(
    provider: RoleIntelligenceExtractionProvider | CandidateProofExtractionProvider,
    source: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
    error: unknown,
  ): Promise<ExperimentalExtractionOutcome<T>> {
    const cacheIdentity = createProviderCacheIdentity(source, provider.descriptor);
    const outcome: ExperimentalExtractionOutcome<T> = {
      state: "REJECTED",
      rejection: {
        sourceIdentity: cacheIdentity.sourceIdentity,
        providerId: provider.descriptor.providerId,
        cacheKey: cacheIdentity.key,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
    await this.observer?.record(outcome);
    return outcome;
  }
}
