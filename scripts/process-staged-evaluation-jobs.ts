/** Processes a bounded number of staged jobs; optional waiting drains delayed retries. */
import crypto from "node:crypto";
import { EvaluationWorker } from "../src/lib/intelligence/EvaluationWorker";
import { loadBedrockCredentials } from '../src/lib/model/bedrock-credentials';
import { getDatabaseAdapter } from '../src/data/database';

const argument = process.argv.find((value) => value.startsWith("--max-jobs="));
const maxJobs = Number(argument?.slice("--max-jobs=".length) || "1");
if(!Number.isSafeInteger(maxJobs)||maxJobs<1)throw new Error('MAX_JOBS_INVALID');
const contextFingerprint = process.argv.find(value=>value.startsWith('--context='))?.slice('--context='.length);
const watch=process.argv.includes('--watch');
if(watch&&!contextFingerprint)throw new Error('WATCH_REQUIRES_EXPLICIT_CONTEXT');
loadBedrockCredentials();

const worker = new EvaluationWorker(`staged-backfill-${crypto.randomUUID().slice(0, 8)}`);
const outcomes = [];
for (let index = 0; index < maxJobs; index += 1) {
  const result = await worker.pollAndProcessNext("staged", contextFingerprint);
  if (!result) {
    if(!watch)break;
    const remaining=await getDatabaseAdapter().one<{n:number}>(`SELECT COUNT(*) AS n FROM evaluation_jobs WHERE evaluation_context_fingerprint=? AND status IN ('staged_pending','staged_processing')`,[contextFingerprint]);
    if(!remaining?.n)break;
    await new Promise(resolve=>setTimeout(resolve,15_000));
    index-=1;continue;
  }
  outcomes.push({ jobId: result.jobId, status: result.status, decision: result.decision, error: result.error });
  console.log(JSON.stringify({completed:index+1,...outcomes[outcomes.length-1]}));
}
console.log(JSON.stringify({ requested: maxJobs, processed: outcomes.length, outcomes }));
if(outcomes.some(outcome=>outcome.status==='dead_letter'))process.exitCode=1;
