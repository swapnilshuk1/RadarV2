/**
 * Presentation Layer Diagnostic
 * 
 * Checks if all variables are properly mapped from RecommendationRecord to Opportunity
 * via the present() function and narrative layer.
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { present } from "../src/lib/intelligence/present";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { readOpportunities } from "../src/lib/intelligence/engine";
import type { RecommendationRecord } from "../src/lib/intelligence/record";
import type { Presented } from "../src/lib/intelligence/present";

interface DiagnosticResult {
  jobHash: string;
  verb: string;
  issues: string[];
  missingMappings: string[];
  nullValues: string[];
  typeMismatches: string[];
}

function diagnosePresentationMapping(presented: Presented, record: RecommendationRecord): DiagnosticResult {
  const issues: string[] = [];
  const missingMappings: string[] = [];
  const nullValues: string[] = [];
  const typeMismatches: string[] = [];

  const opp = presented.opportunity;
  const narrative = presented.narrative;

  // Check required fields from EditorialNarrative
  const requiredNarrativeFields = [
    'recommendation',
    'positioning',
    'headspace',
    'hiringRisk',
  ];

  for (const field of requiredNarrativeFields) {
    if (!(field in narrative)) {
      missingMappings.push(`narrative.${field}`);
    } else if (narrative[field as keyof typeof narrative] === null || narrative[field as keyof typeof narrative] === undefined) {
      nullValues.push(`narrative.${field}`);
    }
  }

  // Check optional narrative fields that should be mapped
  const optionalNarrativeFields = [
    'whyNow',
    'primaryProof',
    'headspaceInvestment',
    'alternativePath',
    'recommendationArchetype',
    'mandateArchetype',
    'primaryDriver',
    'secondaryDriver',
    'primaryRisk',
    'tailoringEffort',
    'capabilityAlignmentText',
    'recommendationArchetypeTagline',
  ];

  for (const field of optionalNarrativeFields) {
    const value = narrative[field as keyof typeof narrative];
    if (value === undefined) {
      issues.push(`Optional narrative field not mapped: ${field}`);
    }
  }

  // Check Narrative extension fields
  const narrativeExtensionFields = [
    'confidenceLine',
    'stabilityLine',
    'headspaceLine',
    'comparativeNote',
    'missingEvidenceLine',
  ];

  for (const field of narrativeExtensionFields) {
    if (!(field in narrative)) {
      missingMappings.push(`narrative.${field}`);
    }
  }

  // Check opportunity fields from RecommendationRecord
  const recordToOpportunityMappings = [
    { record: 'verb', opportunity: 'decision' },
    { record: 'esi', opportunity: 'esi' },
    { record: 'diligenceStatus', opportunity: 'diligenceStatus' },
  ];

  for (const mapping of recordToOpportunityMappings) {
    const recordValue = record[mapping.record as keyof RecommendationRecord];
    const oppValue = opp[mapping.opportunity as keyof typeof opp];
    
    if (recordValue !== undefined && oppValue === undefined) {
      missingMappings.push(`opportunity.${mapping.opportunity} (from record.${mapping.record})`);
    }
  }

  // Check recommendationResult nested fields
  if (opp.recommendationResult) {
    const recommendationResultFields = ['score', 'decision', 'policyId', 'policyVersion', 'explanation', 'capabilities'];
    for (const field of recommendationResultFields) {
      if (!(field in opp.recommendationResult)) {
        missingMappings.push(`opportunity.recommendationResult.${field}`);
      }
    }
  }

  // Check for type mismatches in headspace array
  if (Array.isArray(opp.headspace)) {
    for (let i = 0; i < opp.headspace.length; i++) {
      const item = opp.headspace[i];
      if (!item.action || typeof item.action !== 'string') {
        typeMismatches.push(`opportunity.headspace[${i}].action`);
      }
      if (!item.benefit || typeof item.benefit !== 'string') {
        typeMismatches.push(`opportunity.headspace[${i}].benefit`);
      }
      if (!item.effort || !['Low', 'Medium', 'High'].includes(item.effort)) {
        typeMismatches.push(`opportunity.headspace[${i}].effort`);
      }
    }
  }

  return {
    jobHash: record.jobHash,
    verb: record.verb,
    issues,
    missingMappings,
    nullValues,
    typeMismatches,
  };
}

async function main() {
  console.log("=== Presentation Layer Diagnostic ===\n");

  invalidateEngineCache();

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  const { records } = runEngine(projection, 0);
  const opportunities = readOpportunities();

  console.log(`Total records: ${records.length}`);
  console.log(`Total opportunities: ${opportunities.length}\n`);

  // Sample 10 records for detailed diagnosis
  const sampleSize = 10;
  const sampleRecords = records.slice(0, sampleSize);

  const results: DiagnosticResult[] = [];
  let totalIssues = 0;
  let totalMissing = 0;
  let totalNulls = 0;
  let totalTypeMismatches = 0;

  for (const record of sampleRecords) {
    const source = opportunities.find(o => o.jobHash === record.jobHash);
    if (!source) {
      console.log(`⚠️  Opportunity not found for ${record.jobHash}`);
      continue;
    }

    const presented = present(source, record, projection);
    const diagnosis = diagnosePresentationMapping(presented, record);
    results.push(diagnosis);

    totalIssues += diagnosis.issues.length;
    totalMissing += diagnosis.missingMappings.length;
    totalNulls += diagnosis.nullValues.length;
    totalTypeMismatches += diagnosis.typeMismatches.length;
  }

  // Print results
  console.log("=== Diagnosis Results ===\n");

  for (const result of results) {
    const hasProblems = result.issues.length > 0 || result.missingMappings.length > 0 || 
                       result.nullValues.length > 0 || result.typeMismatches.length > 0;
    
    if (hasProblems) {
      console.log(`\n${result.jobHash} (${result.verb}):`);
      
      if (result.missingMappings.length > 0) {
        console.log(`  ❌ Missing mappings: ${result.missingMappings.length}`);
        for (const m of result.missingMappings) {
          console.log(`     - ${m}`);
        }
      }
      
      if (result.nullValues.length > 0) {
        console.log(`  ⚠️  Null values: ${result.nullValues.length}`);
        for (const n of result.nullValues) {
          console.log(`     - ${n}`);
        }
      }
      
      if (result.typeMismatches.length > 0) {
        console.log(`  🔴 Type mismatches: ${result.typeMismatches.length}`);
        for (const t of result.typeMismatches) {
          console.log(`     - ${t}`);
        }
      }
      
      if (result.issues.length > 0) {
        console.log(`  ℹ️  Optional issues: ${result.issues.length}`);
        for (const i of result.issues.slice(0, 3)) {
          console.log(`     - ${i}`);
        }
        if (result.issues.length > 3) {
          console.log(`     ... and ${result.issues.length - 3} more`);
        }
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Records checked: ${results.length}`);
  console.log(`Total missing mappings: ${totalMissing}`);
  console.log(`Total null values: ${totalNulls}`);
  console.log(`Total type mismatches: ${totalTypeMismatches}`);
  console.log(`Total optional issues: ${totalIssues}`);

  if (totalMissing === 0 && totalNulls === 0 && totalTypeMismatches === 0) {
    console.log("\n✅ All critical presentation mappings are correct!");
  } else {
    console.log("\n⚠️  Some presentation mappings need attention.");
  }

  // Check specific P3-related fields
  console.log("\n=== P3-Specific Field Checks ===");
  const p3Fields = [
    'decisionSummary.shortlistingPotential',
    'decisionSummary.careerValue',
    'decisionSummary.pursuitFriction',
    'trace.shortlistingPotentialCalculation',
  ];

  let p3Issues = 0;
  for (const record of records.slice(0, 5)) {
    if (!record.decisionSummary?.shortlistingPotential) {
      p3Issues++;
      console.log(`  ❌ ${record.jobHash}: shortlistingPotential not in decisionSummary`);
    }
    if (!(record.trace as any)?.shortlistingPotentialCalculation) {
      console.log(`  ⚠️  ${record.jobHash}: shortlistingPotentialCalculation not in trace (may be P2-C legacy)`);
    }
  }

  if (p3Issues === 0) {
    console.log("✅ P3 SP fields are properly mapped");
  }
}

main().catch(console.error);
