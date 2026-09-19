import { getDatabaseAdapter } from "../src/data/database";
import { loadBedrockCredentials } from "../src/lib/model/bedrock-credentials";
import { createBedrockGlmResearchModel } from "../src/lib/model/bedrock-glm-research-model";
import { createFactualReviewModel } from "../src/lib/model/factual-review-model";
import { DossierReviewWorker } from "../src/lib/intelligence/staged/DossierReviewWorker";

const db = getDatabaseAdapter();
if (!await db.one("SELECT name FROM sqlite_master WHERE type='table' AND name='dossier_review_jobs'")) throw new Error('Apply migration 052 before starting the review worker');
loadBedrockCredentials();
const worker = new DossierReviewWorker(db, createBedrockGlmResearchModel, createFactualReviewModel);
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
do {
  try {
    const result = await worker.pollOnce();
    if (result) console.log(JSON.stringify(result));
    if (process.argv.includes("--once")) break;
    const health = await db.one<{ pending: number; attention: number; oldest: number | null }>(
      `SELECT SUM(CASE WHEN status IN ('pending','retry','processing') THEN 1 ELSE 0 END) pending,SUM(CASE WHEN status='needs_attention' THEN 1 ELSE 0 END) attention,MIN(CASE WHEN status IN ('pending','retry','processing') THEN created_at END) oldest FROM dossier_review_jobs`,
    );
    if ((health?.attention ?? 0) > 0 || (health?.oldest && Date.now() - health.oldest > 3600_000))
      console.warn(JSON.stringify({ reviewQueue: health }));
  } catch (error) {
    console.error(
      "[DossierReviewWorker] Poll failed; check database/schema and worker configuration.",
    );
    if (process.argv.includes("--once")) {
      process.exitCode = 1;
      break;
    }
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5000));
} while (!stopping);
