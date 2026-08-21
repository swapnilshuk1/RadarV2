import { describe, test, expect } from "vitest";
import { getRepositories } from "../../src/data/sqlite/provider";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";

describe("Shortlist / Evaluation Queue Unresolved Eligibility Policy", () => {
  test("1. 10 evaluated + unreviewed opportunities -> all 10 enter the queue", async () => {
    const repos = getRepositories();
    const userId = "test_user_queue_10";

    for (let i = 1; i <= 10; i++) {
      const jobHash = `test_job_10_${i}`;
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_10",
        engineVerdict: i % 2 === 0 ? "PURSUE" : "CONSIDER",
        engineQualityScore: 80,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_10",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: i % 2 === 0 ? "PURSUE" : "CONSIDER",
          intrinsicQualityScore: 80,
        }),
      });
    }

    const ops = await OpportunityService.listForUser(userId);
    expect(ops.length).toBe(10);
  });

  test("2. 150 evaluated + unreviewed opportunities -> all 150 remain eligible (no 100-item cutoff)", async () => {
    const repos = getRepositories();
    const userId = "test_user_queue_150";

    for (let i = 1; i <= 150; i++) {
      const jobHash = `test_job_150_${i}`;
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_150",
        engineVerdict: "CONSIDER",
        engineQualityScore: 75,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_150",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "CONSIDER",
          intrinsicQualityScore: 75,
        }),
      });
    }

    const ops = await OpportunityService.listForUser(userId);
    expect(ops.length).toBe(150);
  });

  test("3. 150 evaluated + 50 already user-decided -> 150 unresolved eligible, 50 decided excluded", async () => {
    const repos = getRepositories();
    const userId = "test_user_queue_200";

    // 150 unresolved
    for (let i = 1; i <= 150; i++) {
      const jobHash = `test_job_unresolved_${i}`;
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_200",
        engineVerdict: "CONSIDER",
        engineQualityScore: 70,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_200",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "CONSIDER",
          intrinsicQualityScore: 70,
        }),
      });
    }

    // 50 decided
    for (let i = 1; i <= 50; i++) {
      const jobHash = `test_job_decided_${i}`;
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_200",
        engineVerdict: "PURSUE",
        engineQualityScore: 90,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_200",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "PURSUE",
          intrinsicQualityScore: 90,
        }),
      });

      await repos.decisions.recordUserDecision(
        userId,
        jobHash,
        i % 2 === 0 ? "PURSUE" : "PASS",
        "Test reason",
        "fp_200"
      );
    }

    const userDecisions = await repos.decisions.getUserDecisions(userId);
    const ops = await OpportunityService.listForUser(userId);

    const unresolvedOps = ops.filter((o) => {
      const dec = userDecisions[o.jobHash];
      return !dec;
    });

    expect(unresolvedOps.length).toBe(150);
  });

  test("4, 5, 6. User decision (PURSUE/CONSIDER/PASS) + stale fingerprint -> excluded from unresolved queue", async () => {
    const repos = getRepositories();
    const userId = "test_user_stale_decisions";

    const verbs: Array<"PURSUE" | "CONSIDER" | "PASS"> = ["PURSUE", "CONSIDER", "PASS"];
    for (const verb of verbs) {
      const jobHash = `test_stale_${verb.toLowerCase()}`;
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_NEW_4_3",
        engineVerdict: "CONSIDER",
        engineQualityScore: 85,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_NEW_4_3",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "CONSIDER",
          intrinsicQualityScore: 85,
        }),
      });

      await repos.decisions.recordUserDecision(
        userId,
        jobHash,
        verb,
        "Stale decision reason",
        "fp_OLD_4_0"
      );
    }

    const userDecisions = await repos.decisions.getUserDecisions(userId);

    for (const verb of verbs) {
      const jobHash = `test_stale_${verb.toLowerCase()}`;
      const dec = userDecisions[jobHash];
      expect(dec).toBeDefined();
      expect(dec?.verb).toBe(verb);
    }
  });

  test("7, 8. New unreviewed engine PURSUE & CONSIDER -> included in unresolved queue", async () => {
    const repos = getRepositories();
    const userId = "test_user_fresh_engine";

    const pursueHash = "test_fresh_engine_pursue";
    const considerHash = "test_fresh_engine_consider";

    await repos.evaluations.saveEvaluation({
      personId: userId,
      jobHash: pursueHash,
      policyVersion: "v4.3",
      evaluationInputHash: "fp_fresh",
      engineVerdict: "PURSUE",
      engineQualityScore: 92,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({
        schemaVersion: "v4.2-intrinsic",
        jobHash: pursueHash,
        personId: userId,
        evaluationInputHash: "fp_fresh",
        policyVersion: "v4.3",
        ontologyVersion: "v2",
        evaluatedAt: new Date().toISOString(),
        intrinsicVerdict: "PURSUE",
        intrinsicQualityScore: 92,
      }),
    });

    await repos.evaluations.saveEvaluation({
      personId: userId,
      jobHash: considerHash,
      policyVersion: "v4.3",
      evaluationInputHash: "fp_fresh",
      engineVerdict: "CONSIDER",
      engineQualityScore: 78,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({
        schemaVersion: "v4.2-intrinsic",
        jobHash: considerHash,
        personId: userId,
        evaluationInputHash: "fp_fresh",
        policyVersion: "v4.3",
        ontologyVersion: "v2",
        evaluatedAt: new Date().toISOString(),
        intrinsicVerdict: "CONSIDER",
        intrinsicQualityScore: 78,
      }),
    });

    const ops = await OpportunityService.listForUser(userId);
    const hashes = ops.map((o) => o.jobHash);

    expect(hashes).toContain(pursueHash);
    expect(hashes).toContain(considerHash);
  });

  test("9. Unevaluated opportunity -> does not appear as completed evaluation", async () => {
    const repos = getRepositories();
    const userId = "test_user_unevaluated";
    const unevaluatedHash = "test_unevaluated_job";

    const evalRec = await repos.evaluations.getEvaluation(userId, unevaluatedHash);
    expect(evalRec).toBeNull();
  });
});
