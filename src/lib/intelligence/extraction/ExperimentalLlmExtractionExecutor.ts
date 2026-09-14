import {
  createProviderCacheIdentity,
  type CandidateProofExtractionProvider,
  type ProviderExtractionResult,
  type RoleIntelligenceExtractionProvider,
} from "./ExtractionProvider";
import { type CandidateProofOutputV1 } from "./CandidateProofExtractorV1";
import { type RoleIntelligenceOutputV1 } from "./RoleIntelligenceExtractorV1";
import type { LlmExecutionTelemetry } from "./LlmExperimentalExtractionProvider";
import type { SemanticProposalRejection } from "./ExperimentalSemanticProposal";
import { VerifiedExtractionProviderRunner } from "./VerifiedExtractionProviderRunner";
import type { CandidateDocumentSourceRef, OpportunityVersionSourceRef } from "@/lib/domain/source_provenance";

export type ExperimentalExtractionOutcome<T> =
  | {
      readonly state: "VERIFIED";
      readonly result: ProviderExtractionResult<T>;
      readonly telemetry?: LlmExecutionTelemetry;
      /** Experiment-only causality retained for Batch 04 comparison analysis. */
      readonly proposalRejections?: readonly SemanticProposalRejection[];
    }
  | { readonly state: "REJECTED"; readonly rejection: ExperimentalExtractionRejection };

export interface ExperimentalExtractionRejection {
  readonly sourceIdentity: string;
  readonly providerId: string;
  readonly cacheKey: string;
  readonly reason: string;
}

export interface ExperimentalExtractionObserver {
  record(outcome: ExperimentalExtractionOutcome<unknown>): void | Promise<void>;
  recordFailure?(error: unknown, outcome: ExperimentalExtractionOutcome<unknown>): void | Promise<void>;
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
      const telemetry = experimentalTelemetry(outcome.result);
      if (telemetry) Object.assign(outcome, { telemetry });
      const proposalRejections = experimentalProposalRejections(outcome.result);
      if (proposalRejections) Object.assign(outcome, { proposalRejections });
      await this.notify(outcome);
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
      const telemetry = experimentalTelemetry(outcome.result);
      if (telemetry) Object.assign(outcome, { telemetry });
      const proposalRejections = experimentalProposalRejections(outcome.result);
      if (proposalRejections) Object.assign(outcome, { proposalRejections });
      await this.notify(outcome);
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
    await this.notify(outcome);
    return outcome;
  }

  /** Observation is best effort; it must not rewrite a finalized extraction outcome. */
  private async notify(outcome: ExperimentalExtractionOutcome<unknown>): Promise<void> {
    if (!this.observer) return;
    try {
      await this.observer.record(outcome);
    } catch (error) {
      try {
        await this.observer.recordFailure?.(error, outcome);
      } catch {
        // Deliberately isolated: telemetry failure cannot affect experiment truth.
      }
    }
  }
}

function experimentalTelemetry(value: ProviderExtractionResult<unknown>): LlmExecutionTelemetry | undefined {
  const candidate = value as ProviderExtractionResult<unknown> & { experimentalTelemetry?: LlmExecutionTelemetry };
  return candidate.experimentalTelemetry;
}

function experimentalProposalRejections(
  value: ProviderExtractionResult<unknown>,
): readonly SemanticProposalRejection[] | undefined {
  const candidate = value as ProviderExtractionResult<unknown> & {
    experimentalTelemetry?: LlmExecutionTelemetry;
    proposalRejections?: readonly SemanticProposalRejection[];
  };
  return candidate.experimentalTelemetry === undefined ? undefined : candidate.proposalRejections;
}
