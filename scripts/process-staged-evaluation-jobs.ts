/** Processes a bounded number of staged-v1 jobs only; legacy jobs are invisible here. */
import crypto from "node:crypto";
import { EvaluationWorker } from "../src/lib/intelligence/EvaluationWorker";

const argument = process.argv.find((value) => value.startsWith("--max-jobs="));
const maxJobs = Math.max(1, Number(argument?.slice("--max-jobs=".length) || "1"));
if (!process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()) throw new Error("BEDROCK_AUTH_UNAVAILABLE");

const worker = new EvaluationWorker(`staged-backfill-${crypto.randomUUID().slice(0, 8)}`);
const outcomes = [];
for (let index = 0; index < maxJobs; index += 1) {
  const result = await worker.pollAndProcessNext("staged");
  if (!result) break;
  outcomes.push({ jobId: result.jobId, status: result.status, decision: result.decision, error: result.error });
}
console.log(JSON.stringify({ requested: maxJobs, processed: outcomes.length, outcomes }));
