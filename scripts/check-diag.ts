import { getDatabaseAdapter } from "../src/data/database/index";
import { runEngine } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";

async function run() {
  const db = getDatabaseAdapter();
  const row: any = await db.one(
    "SELECT o.*, d.content as raw_text FROM opportunities o LEFT JOIN documents d ON o.id = d.opportunity_id WHERE o.id = ? OR o.id LIKE ?",
    ["j-f1b1ee48cdde", "%f1b1ee48cdde%"]
  );

  console.log("Found Row:", row ? { id: row.id, role: row.canonical_title, company: row.company_name, location: row.location } : "None");

  const evalRow: any = await db.one(
    "SELECT * FROM candidate_evaluations WHERE job_hash = ? OR job_hash LIKE ?",
    ["j-f1b1ee48cdde", "%f1b1ee48cdde%"]
  );

  if (evalRow) {
    console.log("Stored Evaluation Record:");
    console.log("Engine Verdict:", evalRow.engine_verdict);
    console.log("Quality Score:", evalRow.quality_score);
    console.log("User Decision Override:", evalRow.user_decision_override);
    console.log("Effective Decision:", evalRow.effective_decision);
    try {
      const parsed = JSON.parse(evalRow.evaluation_json);
      console.log("Parsed Evaluation JSON:", {
        policyVersion: parsed.policyVersion,
        intrinsicVerdict: parsed.intrinsicVerdict,
        intrinsicQualityScore: parsed.intrinsicQualityScore,
        decisionPolicyResult: parsed.decisionPolicyResult,
        ruleEvaluations: parsed.ruleEvaluations,
        vetoed: parsed.vetoed,
        vetoReason: parsed.vetoReason,
        attentionWindowCapacity: parsed.attentionWindowCapacity
      });
    } catch (e) {
      console.error("Error parsing JSON:", e);
    }
  }

  if (row) {
    const oppObj = {
      jobHash: row.id,
      role: row.canonical_title,
      company: row.company_name,
      location: row.location,
      rawDescription: row.raw_text || ""
    };
    const candBuilder = new CandidateProjectionBuilderImpl();
    const candidate = candBuilder.fromProfile(candidateProfile as any);
    const result = runEngine(candidate, 0, [oppObj as any], "v3_semantic_v1");
    const presented = result.presented[0];
    console.log("\nFresh runEngine calculation:");
    console.log("Recommendation:", presented.recommendation);
    console.log("Score:", presented.overallScore ?? presented.score);
    console.log("DecisionPolicyResult:", JSON.stringify(presented.decisionPolicyResult, null, 2));
    console.log("Policy breakdown rules:", presented.record?.triggeredRuleIds);
  }
}

run().catch(console.error);
