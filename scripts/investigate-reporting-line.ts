/**
 * Deep Investigation: Reporting Line and Evidence Extraction Issues
 */

import { runEngine, invalidateEngineCache, readOpportunities } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";

function analyzeReportingLineIssues() {
  console.log("=== Deep Investigation: Evidence Extraction Analysis ===\n");

  invalidateEngineCache();
  
  const opportunities = readOpportunities();
  
  // Analyze reportingLine dimensions
  let totalReportingLine = 0;
  let missingBucket = 0;
  let matchedBucket = 0;
  let explicitStatus = 0;
  let inferredStatus = 0;
  let nullValue = 0;
  let emptyValue = 0;
  let hasEvidenceArray = 0;
  let emptyEvidenceArray = 0;

  for (const opp of opportunities) {
    const reportingDim = opp.dimensions?.find((d: any) => d.key === "reportingLine");
    
    if (reportingDim) {
      totalReportingLine++;
      
      if (reportingDim.bucket === "Missing") missingBucket++;
      if (reportingDim.bucket === "Matched") matchedBucket++;
      
      if (reportingDim.jdEvidence?.status === "Explicit") explicitStatus++;
      if (reportingDim.jdEvidence?.status === "Inferred") inferredStatus++;
      
      if (reportingDim.jdEvidence?.value === null) nullValue++;
      if (reportingDim.jdEvidence?.value === "") emptyValue++;
      
      if (reportingDim.jdEvidence?.evidence) {
        hasEvidenceArray++;
        if (reportingDim.jdEvidence.evidence.length === 0) {
          emptyEvidenceArray++;
        }
      }
    }
  }

  console.log("Reporting Line Dimension Analysis:");
  console.log(`  Total opportunities: ${opportunities.length}`);
  console.log(`  Total with reportingLine dimension: ${totalReportingLine}`);
  console.log(`    - Missing bucket: ${missingBucket} (${((missingBucket/totalReportingLine)*100).toFixed(1)}%)`);
  console.log(`    - Matched bucket: ${matchedBucket} (${((matchedBucket/totalReportingLine)*100).toFixed(1)}%)`);
  console.log(`  Status breakdown:`);
  console.log(`    - Explicit: ${explicitStatus}`);
  console.log(`    - Inferred: ${inferredStatus}`);
  console.log(`  Value issues:`);
  console.log(`    - Null value: ${nullValue}`);
  console.log(`    - Empty value: ${emptyValue}`);
  console.log(`  Evidence array:`);
  console.log(`    - Has evidence array: ${hasEvidenceArray}`);
  console.log(`    - Empty evidence array: ${emptyEvidenceArray}`);
  
  // Sample some specific cases
  console.log("\n=== Sample Cases ===");
  
  for (let i = 0; i < Math.min(5, opportunities.length); i++) {
    const opp = opportunities[i];
    const reportingDim = opp.dimensions?.find((d: any) => d.key === "reportingLine");
    
    if (reportingDim) {
      console.log(`\n${opp.jobHash}:`);
      console.log(`  Bucket: ${reportingDim.bucket}`);
      console.log(`  Status: ${reportingDim.jdEvidence?.status}`);
      console.log(`  Value type: ${typeof reportingDim.jdEvidence?.value}`);
      console.log(`  Value: ${JSON.stringify(reportingDim.jdEvidence?.value)?.substring(0, 100)}`);
      console.log(`  Evidence count: ${reportingDim.jdEvidence?.evidence?.length || 0}`);
      if (reportingDim.jdEvidence?.evidence?.length > 0) {
        console.log(`  First evidence quote: ${reportingDim.jdEvidence.evidence[0].quote?.substring(0, 80)}...`);
      }
    }
  }

  // Check all dimensions for patterns
  console.log("\n=== All Dimensions Analysis ===");
  const dimensionStats: Record<string, { count: number; missing: number; explicit: number }> = {};
  
  for (const opp of opportunities) {
    for (const dim of opp.dimensions || []) {
      if (!dimensionStats[dim.key]) {
        dimensionStats[dim.key] = { count: 0, missing: 0, explicit: 0 };
      }
      dimensionStats[dim.key].count++;
      if (dim.bucket === "Missing") dimensionStats[dim.key].missing++;
      if (dim.jdEvidence?.status === "Explicit") dimensionStats[dim.key].explicit++;
    }
  }
  
  console.log("\nDimension coverage:");
  for (const [key, stats] of Object.entries(dimensionStats)) {
    const missingPct = ((stats.missing / stats.count) * 100).toFixed(1);
    const explicitPct = ((stats.explicit / stats.count) * 100).toFixed(1);
    console.log(`  ${key}: ${stats.count} ops, ${stats.missing} missing (${missingPct}%), ${stats.explicit} explicit (${explicitPct}%)`);
  }
}

analyzeReportingLineIssues();
