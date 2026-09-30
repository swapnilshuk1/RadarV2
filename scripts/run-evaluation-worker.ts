/**
 * Explicit control-plane bootstrap for evaluation work.
 *
 * Serving routes deliberately never start this daemon. Deploy this process
 * separately wherever queued evaluation work should be consumed.
 */
import { EvaluationDaemon } from "../src/evaluation/daemon";
import { startWorkerHeartbeat } from "../src/lib/health/worker-heartbeat";

const daemon = new EvaluationDaemon(`evaluation-worker-${process.pid}`, 2000);
await startWorkerHeartbeat("evaluation");
const stop = () => daemon.stop();
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
daemon.start();
