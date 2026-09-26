/**
 * Explicit control-plane bootstrap for evaluation work.
 *
 * Serving routes deliberately never start this daemon. Deploy this process
 * separately wherever queued evaluation work should be consumed.
 */
import { EvaluationDaemon } from "../src/lib/intelligence/EvaluationDaemon";

const daemon = new EvaluationDaemon(`evaluation-worker-${process.pid}`, 2000);
const stop = () => daemon.stop();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
daemon.start();
