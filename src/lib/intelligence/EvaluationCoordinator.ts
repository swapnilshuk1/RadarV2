/**
 * EvaluationCoordinator.ts
 *
 * Central event-driven coordinator for evaluation re-runs.
 * Decouples trigger sources (scraper, document upload, intent edit, ontology upgrade)
 * from the evaluation execution logic.
 */

import { invalidateEngineCache } from "./engine";
import { invalidateCandidateDossierCache } from "./cip";

export type EvaluationTriggerEvent =
  | "CORPUS_UPDATED"
  | "PROJECTION_UPDATED"
  | "INTENT_UPDATED"
  | "ONTOLOGY_UPGRADED";

export interface EvaluationTriggerPayload {
  event: EvaluationTriggerEvent;
  personId?: string;
  metadata?: Record<string, any>;
}

export class EvaluationCoordinator {
  /**
   * Central entry point to notify the system that a domain state change has occurred.
   * Determines what evaluation actions are required and delegates execution.
   */
  public static async notify(payload: EvaluationTriggerPayload): Promise<{
    processed: boolean;
    personId?: string;
    event: EvaluationTriggerEvent;
  }> {
    const personId = payload.personId;

    switch (payload.event) {
      case "CORPUS_UPDATED":
      case "PROJECTION_UPDATED":
      case "INTENT_UPDATED":
      case "ONTOLOGY_UPGRADED":
        // Invalidate in-memory caches to guarantee fresh evaluation
        invalidateEngineCache();
        invalidateCandidateDossierCache();

        // Cache invalidation is intentionally not reevaluation. The write
        // path that changed an input must create a context/job/materialization
        // lineage explicitly before this notifier is called.
        break;

      default:
        console.warn(`[EvaluationCoordinator] Unhandled trigger event: ${payload.event}`);
    }

    return {
      processed: false,
      personId,
      event: payload.event
    };
  }
}
