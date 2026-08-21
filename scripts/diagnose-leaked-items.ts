import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function diagnoseFailure() {
  const repos = getRepositories();
  const userId = "ms6i7e3y-4x0chy5fy";

  const userDecisionsDB = await repos.decisions.getUserDecisions(userId);
  const listForUserResult = await OpportunityService.listForUser(userId);

  const shortlistRemaining = listForUserResult.filter((o) => {
    const clientRec = userDecisionsDB[o.jobHash];
    const userVerb = clientRec?.verb || o.userDecision?.userAction;
    if (userVerb === "PURSUE") return false;

    const currentFingerprint = o.engineRecommendation?.evaluationFingerprint || (o as any).recommendationResult?.policyVersion;
    if (clientRec && clientRec.reviewedFingerprint && clientRec.reviewedFingerprint === currentFingerprint) return false;

    if (o.reviewWorkflowState === "UNREVIEWED") {
      if (clientRec && !clientRec.reviewedFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_STALE") {
      if (clientRec && clientRec.reviewedFingerprint === currentFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_UNKNOWN") {
      if (clientRec && clientRec.reviewedFingerprint === currentFingerprint) return false;
      const action = o.userDecision?.userAction || o.engineRecommendation?.engineVerdict;
      return action === "PURSUE" || action === "CONSIDER";
    }

    return false;
  });

  const leakedItems: any[] = [];
  for (const o of shortlistRemaining) {
    const dec = userDecisionsDB[o.jobHash];
    if (dec) {
      leakedItems.push({
        jobHash: o.jobHash,
        verb: dec.verb,
        reviewedFingerprint: dec.reviewedFingerprint,
        currentFingerprint: o.engineRecommendation?.evaluationFingerprint,
        reviewWorkflowState: o.reviewWorkflowState,
        userDecisionInOpp: o.userDecision,
      });
    }
  }

  console.log(`Leaked Items Count: ${leakedItems.length}`);
  console.log(`Leaked Items Breakdown:`, leakedItems.slice(0, 10));
}

diagnoseFailure().catch(console.error);
