import { getRepositories } from "../../../data/sqlite/provider";
import { SqliteEvaluationStore } from "../../../data/sqlite/repositories/SqliteEvaluationStore";
import { OpportunityService } from "../opportunity-service";
import { candidateProfile } from "../../../data/candidate-profile";
import { computeIntrinsicFingerprint, classifyFingerprint } from "../fingerprint/EvaluationFingerprint";

export class EvaluationWorker {
  /**
   * Executes a single evaluation job cycle from the database job queue.
   */
  public static async processNextJob(workerId: string = `worker_${process.pid}`): Promise<boolean> {
    const repos = getRepositories();
    const evalStore = repos.evaluations;

    // 1. Claim next pending or expired job
    const job = await evalStore.claimJob(workerId, 5);
    if (!job) {
      return false; // Queue empty
    }

    try {
      // 2. Fetch candidate projection & evaluate opportunity
      const [projection, oppSource, single] = await Promise.all([
        repos.people.getLatestProjection(job.personId),
        repos.opportunities.getOpportunitySource(job.jobHash),
        OpportunityService.evaluateSinglePresented(job.personId, job.jobHash),
      ]);

      if (!single) {
        await evalStore.markJobFailed(job.id, "Opportunity or details unavailable for evaluation");
        return true;
      }

      const { record, narrative } = single;
      const policyVersion = record.recommendationVersion || "v4.3";
      const ontologyVersion = "v2";

      // Compute canonical intrinsic fingerprint
      const canonicalFingerprint = computeIntrinsicFingerprint(
        projection || candidateProfile,
        oppSource || single.opportunity,
        policyVersion,
        ontologyVersion
      );

      // If job.inputHash was enqueued as a canonical fingerprint and is already superseded, mark superseded
      if (
        classifyFingerprint(job.inputHash) === "CANONICAL_V4" &&
        job.inputHash !== canonicalFingerprint
      ) {
        await evalStore.markJobFailed(job.id, "Superseded by newer canonical input hash", true);
        return true;
      }

      const verb0 = (record.trace?.verb0 || record.verb || "CONSIDER") as "PURSUE" | "CONSIDER" | "PASS";
      const engineVerdict = (["PURSUE", "CONSIDER", "PASS"].includes(verb0)
        ? verb0
        : "CONSIDER") as "PURSUE" | "CONSIDER" | "PASS";

      const canonicalPayload = {
        schemaVersion: "v4.2-intrinsic" as const,
        jobHash: job.jobHash,
        personId: job.personId,
        evaluationInputHash: canonicalFingerprint,
        policyVersion,
        ontologyVersion,
        evaluatedAt: new Date().toISOString(),
        intrinsicVerdict: engineVerdict,
        intrinsicQualityScore: record.vetoed ? null : (record.qualityScore !== null && record.qualityScore !== undefined ? Math.round(record.qualityScore) : null),
        parsingConfidence: record.confidences?.parsing ?? (record.confidence ?? 0.8),
        vetoed: Boolean(record.vetoed),
        vetoReason: record.vetoReason || null,
        triggeredRuleIds: record.triggeredRuleIds || [],
        decisionRisks: record.decisionRisks || [],
        decisionDrivers: record.decisionDrivers || [],
        relativeDifferentiator: record.relativeDifferentiator || undefined,
        trajectoryUpside: record.trajectoryUpside || undefined,
        opportunityScoreConfidence: record.opportunityScoreConfidence,
        opportunityScoreSource: record.opportunityScoreSource,
        evaluationStatus: "COMPLETE" as const,
        dimensions: (record.trace?.evidenceMapping || []).map((m: any) => ({
          key: m.key || "mandate",
          label: m.label || m.key || "",
          importance: m.importance || "Core",
          bucket: m.bucket || "Missing",
          value: m.value || "",
          quote: m.quote || "",
        })),
        esi: record.esi || 0,
        diligenceStatus: record.diligenceStatus || "READY",
        baseNarrative: {
          whyNow: narrative.whyNow,
          positioning: narrative.positioning,
          primaryProof: narrative.primaryProof,
          hiringRisk: narrative.hiringRisk,
          alternativePath: narrative.alternativePath,
          recommendationArchetype: narrative.recommendationArchetype,
          recommendationArchetypeTagline: narrative.recommendationArchetypeTagline,
          mandateArchetype: narrative.mandateArchetype,
          primaryDriver: narrative.primaryDriver,
          secondaryDriver: narrative.secondaryDriver,
          primaryRisk: narrative.primaryRisk,
          tailoringEffort: narrative.tailoringEffort,
          capabilityAlignmentText: narrative.capabilityAlignmentText,
          baseRecommendationProse: narrative.recommendation,
          recommendedAction: (narrative as any).recommendedAction || verb0,
        },
        auditTrace: {
          verb0,
          evaluationTimeFinalVerb: record.trace?.finalVerb,
          careerValue: record.trace?.factors?.careerValue ?? 0,
          shortlistingPotential: record.trace?.factors?.shortlistingPotential ?? 0,
          pursuitFriction: record.trace?.factors?.pursuitFriction ?? 1.0,
          rawScore: record.trace?.priority ?? 0,
          evidenceMappingCount: record.trace?.evidenceMapping?.length ?? 0,
        },
      };

      // 4. Save materialized candidate evaluation record with intrinsic verb0
      await evalStore.saveEvaluation({
        personId: job.personId,
        jobHash: job.jobHash,
        policyVersion: canonicalPayload.policyVersion,
        evaluationInputHash: canonicalFingerprint,
        engineVerdict,
        engineQualityScore: canonicalPayload.intrinsicQualityScore || 70.0,
        effectiveDecision: engineVerdict,
        qualityScore: canonicalPayload.intrinsicQualityScore || 70.0,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify(canonicalPayload),
      });

      // 5. Mark job completed in queue
      await evalStore.markJobCompleted(job.id);
      return true;
    } catch (err: any) {
      await evalStore.markJobFailed(job.id, err?.message || String(err));
      return true;
    }
  }

  /**
   * Runs the worker loop until all pending jobs in queue are processed.
   */
  public static async processAllPending(workerId: string = `worker_${process.pid}`): Promise<number> {
    let count = 0;
    while (await this.processNextJob(workerId)) {
      count++;
    }
    return count;
  }

  private static isDaemonRunning = false;
  private static daemonAbortController: AbortController | null = null;

  /**
   * Starts a persistent background worker daemon that continuously polls and drains
   * the evaluation_jobs queue with idle backoff and graceful termination.
   */
  public static startDaemon(
    pollIntervalMs: number = 2000,
    workerId: string = `worker_daemon_${process.pid}`
  ): { stop: () => void; isRunning: () => boolean } {
    if (this.isDaemonRunning) {
      return {
        stop: () => this.stopDaemon(),
        isRunning: () => this.isDaemonRunning,
      };
    }

    this.isDaemonRunning = true;
    this.daemonAbortController = new AbortController();
    const signal = this.daemonAbortController.signal;

    (async () => {
      while (!signal.aborted) {
        try {
          const hadWork = await this.processNextJob(workerId);
          if (!hadWork) {
            // Queue empty: wait for poll interval before checking again
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }
        } catch (err: any) {
          console.error("⚠️ [EvaluationDaemon] Unhandled loop error:", err?.message || err);
          await new Promise((resolve) => setTimeout(resolve, Math.max(pollIntervalMs * 2, 5000)));
        }
      }
      this.isDaemonRunning = false;
    })();

    return {
      stop: () => this.stopDaemon(),
      isRunning: () => this.isDaemonRunning,
    };
  }

  /**
   * Gracefully terminates the running evaluation worker daemon.
   */
  public static stopDaemon(): void {
    if (this.daemonAbortController) {
      this.daemonAbortController.abort();
      this.daemonAbortController = null;
    }
    this.isDaemonRunning = false;
  }
}
