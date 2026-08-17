import { runEngine } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { composeExecutiveBrief } from "../src/lib/intelligence/editorial/OpportunityBriefComposer";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import { rawOpportunities } from "../src/data/opportunity-fixtures";
import { present } from "../src/lib/intelligence/present";

console.log("============================================================");
console.log("   STEP 2 — OLD CERTIFICATION VS LIVE PATH DIVERGENCE AUDIT  ");
console.log("============================================================\n");

const builder = new CandidateProjectionBuilderImpl();
const candidateProjection = builder.fromProfile(candidateProfile);
const { presented, records } = runEngine(candidateProjection, 0);

let identicalCount = 0;
let verdictDivergenceCount = 0;
let CVPWarningDivergenceCount = 0;
let totalAudited = 0;

console.log("=== PART 1: RUNNING ENGINE OUTPUT (10 RECORDS) ===");
for (const record of records) {
  totalAudited++;
  const presentedItem = presented.find(p => p.record.jobHash === record.jobHash);
  if (!presentedItem) continue;

  const source = {
    jobHash: record.jobHash,
    role: presentedItem.opportunity.role || "Unknown",
    company: presentedItem.opportunity.company || "Unknown",
    location: presentedItem.opportunity.location || "Unknown",
    postedRelative: presentedItem.opportunity.postedRelative || "Posted recently",
    scrapedFrom: presentedItem.opportunity.scrapedFrom || "LinkedIn",
    primaryConcern: presentedItem.opportunity.primaryConcern,
    dimensions: presentedItem.opportunity.dimensions || []
  };

  const oldBrief = composeExecutiveBrief(record, source as any);
  const liveBrief = BriefCompositionEngine.compose(presentedItem.opportunity, { bypassHistory: true });

  const policyVerdict = record.verb;
  const oldVerdict = oldBrief.recommendation;
  const liveVerdict = liveBrief.memory.decision;

  console.log(`[${source.company} - ${source.role}]`);
  console.log(`  Policy Engine Verb  : "${policyVerdict}"`);
  console.log(`  Old Brief Verdict   : "${oldVerdict}"`);
  console.log(`  Live Brief Verdict  : "${liveVerdict}"`);

  const verdictMatch = oldVerdict === liveVerdict;
  if (!verdictMatch) {
    verdictDivergenceCount++;
  } else {
    identicalCount++;
  }
}

console.log("\n=== PART 2: RAW FIXTURES OUTPUT ===");
for (const rawOpp of rawOpportunities) {
  totalAudited++;
  const mockRecord: any = {
    jobHash: rawOpp.jobHash,
    verb: rawOpp.decision || "CONSIDER",
    qualityScore: 75,
    triggeredRuleIds: [],
    decisionRisks: [],
    decisionDrivers: [],
    headspace: { downgraded: false, reason: "" },
    comparison: { higherThan: [], lowerThan: [] },
    explanation: { missingEvidence: [] }
  };

  const presentedObj = present(rawOpp as any, mockRecord);
  const opp = presentedObj.opportunity;

  const oldBrief = composeExecutiveBrief(mockRecord, rawOpp as any);
  const liveBrief = BriefCompositionEngine.compose(opp, { bypassHistory: true });

  const policyVerdict = mockRecord.verb;
  const oldVerdict = oldBrief.recommendation;
  const liveVerdict = liveBrief.memory.decision;

  console.log(`[${opp.company} - ${opp.role}]`);
  console.log(`  Policy Engine Verb  : "${policyVerdict}"`);
  console.log(`  Old Brief Verdict   : "${oldVerdict}"`);
  console.log(`  Live Brief Verdict  : "${liveVerdict}"`);

  const verdictMatch = oldVerdict === liveVerdict;
  if (!verdictMatch) {
    verdictDivergenceCount++;
  } else {
    identicalCount++;
  }
}

console.log("============================================================");
console.log(`  Total Corpus Audited        : ${totalAudited}`);
console.log(`  Identical Verdict Alignment : ${identicalCount} (${Math.round((identicalCount / totalAudited) * 100)}%)`);
console.log(`  Verdict Divergences         : ${verdictDivergenceCount}`);
console.log(`  CVP Warning Divergences     : ${CVPWarningDivergenceCount}`);
console.log("============================================================\n");
