import type { DecisionVerb } from "@/opportunity/contracts";

/** A cockpit is reopened only for a canonical candidate PURSUE decision. */
export function canReopenPursuit(userDecision: DecisionVerb | "NONE" | null | undefined): boolean {
  return userDecision === "PURSUE";
}
