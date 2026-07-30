/**
 * EvaluationCoordinator.ts
 *
 * Central event-driven coordinator for evaluation re-runs.
 * Decouples trigger sources (scraper, document upload, intent edit, ontology upgrade)
 * from the evaluation execution logic.
 */

import { OpportunityService } from "./opportunity-service";

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
    console.log(`[EvaluationCoordinator] Event received: ${payload.event} for user: ${payload.personId || "ALL"}`);

    const personId = payload.personId || "swapnil-shukla";

    switch (payload.event) {
      case "CORPUS_UPDATED":
      case "PROJECTION_UPDATED":
      case "INTENT_UPDATED":
      case "ONTOLOGY_UPGRADED":
        // Re-calculate recommendations for user
        await OpportunityService.listForUser(personId);
        break;

      default:
        console.warn(`[EvaluationCoordinator] Unhandled trigger event: ${payload.event}`);
    }

    return {
      processed: true,
      personId,
      event: payload.event
    };
  }
}
