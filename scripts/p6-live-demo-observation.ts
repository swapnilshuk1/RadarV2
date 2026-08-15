import fs from "fs";
import path from "path";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";

async function observeGoldenCases() {
  console.log("==========================================================================");
  console.log("      P6 — LIVE EXECUTIVE DEMO OBSERVATION & PRODUCT LEARNING HARNESS      ");
  console.log("==========================================================================");

  const goldenPath = path.join(process.cwd(), "src", "data", "golden_demo_dataset.json");
  let goldenCases: any[] = [];
  if (fs.existsSync(goldenPath)) {
    goldenCases = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));
  }

  const allOpps = await OpportunityService.listForUser("swapnil-shukla");

  console.log(`\nEvaluating ${goldenCases.length} Golden Demo Dataset Cases against 10 Executive Observation Questions:\n`);

  for (const gc of goldenCases) {
    const opp = allOpps.find(o => o.jobHash === gc.jobHash || o.role === gc.roleTitle) || allOpps[0];
    const brief = BriefCompositionEngine.compose(opp, { bypassHistory: true });

    console.log(`--------------------------------------------------------------------------`);
    console.log(`[CASE ${gc.id}]: ${gc.category}`);
    console.log(`  Role: ${gc.roleTitle} @ ${gc.companyName}`);
    console.log(`  Archetype: ${gc.archetype}`);
    console.log(`  A. First Viewport: Verb = [${gc.decisionVerb}] | RADAR Score = [${gc.qualityScore != null ? gc.qualityScore + '/100' : 'N/A'}]`);
    console.log(`  B/C. Coexistence / TL;DR: "${brief.oneMinuteTLDR.bottomLine}"`);
    console.log(`  D. "Why Me" Alignment: "${brief.strategicAdvantage?.headline || 'Strong alignment'}"`);
    console.log(`  E. Principal Risk: "${brief.principalRisk?.headline || 'Verification required'}"`);
    console.log(`  F. Evidence Density: ${brief.supportingEvidence?.capabilityMatches?.length || 0} capabilities verified`);
    console.log(`  G. Immediate Action Notice: "${brief.verdictGuidance.actionNotice}"`);
    console.log(`  J. Compensation Display: "${brief.verdictGuidance.compBandDisplay || 'Not Disclosed / Executive Verification Required'}"`);
    console.log(`--------------------------------------------------------------------------\n`);
  }

  console.log("==========================================================================");
  console.log("                      OBSERVATION HARNESS COMPLETE                        ");
  console.log("==========================================================================");
}

observeGoldenCases().catch(console.error);
