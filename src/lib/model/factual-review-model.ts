import type { ReasoningModel } from "@/dossier/contracts";
import { createGeminiFactualReviewModel } from "./gemini-factual-review-model";

/** Provider adapters implement the same structured ReasoningModel contract.
 * No silent fallback: model/config identity also binds durable checkpoints. */
export function createFactualReviewModel(): ReasoningModel {
  const provider = process.env.RADAR_FACTUAL_REVIEW_PROVIDER ?? "gemini";
  if (provider !== "gemini") throw new Error(`Unsupported factual review provider: ${provider}`);
  return createGeminiFactualReviewModel();
}
