/**
 * Explicit control-plane bootstrap for evaluation work.
 *
 * Serving routes deliberately never start this daemon. Deploy this process
 * separately wherever queued evaluation work should be consumed.
 */
import { EvaluationDaemon } from "../src/lib/intelligence/EvaluationDaemon";

EvaluationDaemon.startGlobalDaemon(2000);
console.log("[EvaluationWorker] Started explicit evaluation worker bootstrap.");
