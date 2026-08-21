import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";

async function inspectJobs() {
  const db = getDatabaseAdapter();
  const repos = getRepositories();
  const userId = "ms6i7e3y-4x0chy5fy";

  const targetHashes = ["j-9d2006e16aba", "j-099437e80b44"];

  console.log("==================================================");
  console.log("FORENSIC INVESTIGATION OF TWO TOP SHORTLIST JOBS");
  console.log("==================================================");

  for (const jobHash of targetHashes) {
    console.log(`\n--------------------------------------------------`);
    console.log(`JOB HASH: ${jobHash}`);
    console.log(`--------------------------------------------------`);

    // 1. Opportunity Record
    const opp = await db.one<any>("SELECT * FROM opportunities WHERE id = ?", [jobHash]);
    console.log("OPPORTUNITY RECORD:");
    console.log(JSON.stringify(opp, null, 2));

    // 2. Document / JD Record
    const docs = await db.many<any>("SELECT id, payload_type, created_at, SUBSTR(content, 1, 300) as snippet FROM documents WHERE opportunity_id = ?", [jobHash]);
    console.log("\nDOCUMENTS RECORD:");
    console.log(JSON.stringify(docs, null, 2));

    // 3. Evaluation Record
    const evalRec = await repos.evaluations.getEvaluation(userId, jobHash);
    console.log("\nCANDIDATE EVALUATION RECORD:");
    if (evalRec) {
      console.log({
        personId: evalRec.personId,
        jobHash: evalRec.jobHash,
        engineVerdict: evalRec.engineVerdict,
        engineQualityScore: evalRec.engineQualityScore,
        policyVersion: evalRec.policyVersion,
        evaluationInputHash: evalRec.evaluationInputHash,
        evaluationStatus: evalRec.evaluationStatus,
        createdAt: evalRec.createdAt,
      });

      if (evalRec.evaluationJson) {
        try {
          const parsed = JSON.parse(evalRec.evaluationJson);
          console.log("\nEVALUATION JSON DETAILS:");
          console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
          console.log("Failed to parse evaluationJson");
        }
      }
    } else {
      console.log("NO CANDIDATE EVALUATION FOUND IN DATABASE!");
    }

    // 4. Decision Record
    const userDecisionsDB = await repos.decisions.getUserDecisions(userId);
    console.log("\nUSER DECISION RECORD:");
    console.log(userDecisionsDB[jobHash] ?? "None");
  }
}

inspectJobs().catch(console.error);
