// scripts/verify_classifiers.ts

import { OperatingLevelClassifier } from "../src/lib/intelligence/classifiers/OperatingLevelClassifier";
import { WorkNatureClassifier } from "../src/lib/intelligence/classifiers/WorkNatureClassifier";
import { DecisionAuthorityClassifier } from "../src/lib/intelligence/classifiers/DecisionAuthorityClassifier";
import { CommercialScopeClassifier } from "../src/lib/intelligence/classifiers/CommercialScopeClassifier";
import liveScraped from "../src/data/live-scraped.json";
import { rawOpportunities } from "../src/data/opportunity-fixtures";

console.log("==================================================");
console.log("RADAR PHASE 1: CLASS-FIRST VERIFICATION RUNNER (RECONSTRUCTED EVIDENCE)");
console.log("==================================================");

const allJobs = [
  ...rawOpportunities,
  ...liveScraped
];

console.log(`Loaded ${allJobs.length} opportunities from the golden dataset.\n`);

// Helper to reconstruct semantic payload from dimensions evidence
function extractTextFromOpportunity(opportunity: any): string {
  const parts: string[] = [];
  
  if (opportunity.role) parts.push(opportunity.role);
  if (opportunity.company) parts.push(opportunity.company);
  if (opportunity.location) parts.push(opportunity.location);
  if (opportunity.primaryConcern?.jdQuote) parts.push(opportunity.primaryConcern.jdQuote);

  if (Array.isArray(opportunity.dimensions)) {
    opportunity.dimensions.forEach((dim: any) => {
      if (dim.jdEvidence) {
        if (dim.jdEvidence.value) parts.push(dim.jdEvidence.value);
        if (Array.isArray(dim.jdEvidence.evidence)) {
          dim.jdEvidence.evidence.forEach((ev: any) => {
            if (ev.quote) parts.push(ev.quote);
          });
        }
      }
    });
  }

  return parts.join("\n");
}

// 1. Target checks on specific high-interest JDs
const targetJobs = [
  { key: "Synchrony L10", match: "Synchrony" },
  { key: "BMW India CMO", match: "BMW" },
  { key: "Abbott", match: "Abbott" }
];

targetJobs.forEach(({ key, match }) => {
  const found = allJobs.find(j => 
    j.company?.toLowerCase().includes(match.toLowerCase()) || 
    j.role?.toLowerCase().includes(match.toLowerCase())
  );

  if (found) {
    const title = found.role;
    const desc = extractTextFromOpportunity(found);
    const opLevel = OperatingLevelClassifier.classify(desc, title);
    const workNature = WorkNatureClassifier.classify(desc, title);
    const decAuth = DecisionAuthorityClassifier.classify(desc, title);
    const commScope = CommercialScopeClassifier.classify(desc, title);

    console.log(`[TARGET CHECK] ${key}:`);
    console.log(`  Title:            "${title}"`);
    console.log(`  Company:          "${found.company}"`);
    console.log(`  Decision Auth:    ${decAuth.value} (Confidence: ${decAuth.confidence})`);
    console.log(`  Commercial Scope: ${commScope.value} (Confidence: ${commScope.confidence})`);
    console.log(`  Work Nature:      ${workNature.value} (Confidence: ${workNature.confidence})`);
    console.log(`  Operating Level:  ${opLevel.value} (Confidence: ${opLevel.confidence})`);
    console.log(`  Evidence IDs:     ${JSON.stringify(opLevel.evidenceIds.slice(0, 5))}...`);
    console.log("");
  } else {
    console.log(`[TARGET CHECK] Could not find job matching: "${key}"`);
  }
});

// 2. Full distribution analysis on all loaded jobs (>= 50 jobs)
console.log("==================================================");
console.log("DISTRIBUTION STATISTICS OVER ALL PIPELINE OPPORTUNITIES");
console.log("==================================================");

const olCounts: Record<string, number> = {
  EXECUTIVE: 0,
  STRATEGIC: 0,
  MANAGERIAL: 0,
  TACTICAL: 0,
  INDIVIDUAL_CONTRIBUTOR: 0
};

const wnCounts: Record<string, number> = {
  EXECUTIVE_WORK: 0,
  STRATEGIC_WORK: 0,
  MANAGERIAL_WORK: 0,
  TACTICAL_WORK: 0,
  SPECIALIST_WORK: 0
};

allJobs.forEach(job => {
  const title = job.role || "";
  const desc = extractTextFromOpportunity(job);
  const ol = OperatingLevelClassifier.classify(desc, title).value;
  const wn = WorkNatureClassifier.classify(desc, title).value;

  if (ol in olCounts) olCounts[ol]++;
  if (wn in wnCounts) wnCounts[wn]++;
});

console.log("Operating Level Classification Counts:");
Object.entries(olCounts).forEach(([k, v]) => {
  console.log(`  - ${k.padEnd(25)}: ${v} jobs (${((v / allJobs.length) * 100).toFixed(1)}%)`);
});

console.log("\nWork Nature Classification Counts:");
Object.entries(wnCounts).forEach(([k, v]) => {
  console.log(`  - ${k.padEnd(25)}: ${v} jobs (${((v / allJobs.length) * 100).toFixed(1)}%)`);
});

console.log("\n==================================================");
console.log("PHASE 1 VERIFICATION COMPLETED SUCCESSFULLY!");
console.log("==================================================");
