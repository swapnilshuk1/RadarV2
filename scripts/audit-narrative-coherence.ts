/**
 * P3-C: Narrative Coherence Audit
 *
 * Examines executive-facing output to ensure signals form ONE coherent story:
 * - Strategic Advantage
 * - Principal Risk
 * - Career Value
 * - Shortlisting Potential
 * - Pursuit Friction
 * - Recommended Action
 *
 * Checks for contradictions and presentation defects.
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { present } from "../src/lib/intelligence/present";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { readOpportunities } from "../src/lib/intelligence/engine";
import type { RecommendationRecord } from "../src/lib/intelligence/record";

interface CoherenceIssue {
  jobHash: string;
  type: "contradiction" | "incoherence" | "defect";
  severity: "high" | "medium" | "low";
  description: string;
  signals: {
    cv: number;
    sp: number;
    friction: number;
    verb: string;
  };
  narrative?: string;
}

interface NarrativeAudit {
  totalRecords: number;
  issues: CoherenceIssue[];
  contradictions: {
    highCvLowValue: number;
    lowCvHighValue: number;
    highSpLowLikelihood: number;
    lowSpHighLikelihood: number;
  };
  defects: {
    jsonLeakage: number;
    malformedStrings: number;
    truncationArtifacts: number;
    brokenSentences: number;
  };
}

function auditNarrativeCoherence(records: RecommendationRecord[]): NarrativeAudit {
  const audit: NarrativeAudit = {
    totalRecords: records.length,
    issues: [],
    contradictions: {
      highCvLowValue: 0,
      lowCvHighValue: 0,
      highSpLowLikelihood: 0,
      lowSpHighLikelihood: 0
    },
    defects: {
      jsonLeakage: 0,
      malformedStrings: 0,
      truncationArtifacts: 0,
      brokenSentences: 0
    }
  };

  for (const r of records) {
    const cv = r.decisionSummary?.careerValue ?? 0;
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    const friction = r.decisionSummary?.pursuitFriction ?? 0;
    const verb = r.verb;

    // 1. Check for CV/Decision contradictions
    if (cv >= 80 && verb === "PASS" && !r.vetoed) {
      audit.contradictions.highCvLowValue++;
      audit.issues.push({
        jobHash: r.jobHash,
        type: "contradiction",
        severity: "medium",
        description: `High CV (${cv}) but PASS without veto - may indicate value not recognized`,
        signals: { cv, sp, friction, verb }
      });
    }

    if (cv < 40 && verb === "PURSUE") {
      audit.contradictions.lowCvHighValue++;
      audit.issues.push({
        jobHash: r.jobHash,
        type: "contradiction",
        severity: "high",
        description: `Low CV (${cv}) but PURSUE - signals contradict`,
        signals: { cv, sp, friction, verb }
      });
    }

    // 2. Check for SP/Decision contradictions
    if (sp >= 80 && verb === "PASS" && !r.vetoed) {
      // This may be legitimate - other factors override
      // Only flag if score is also reasonable
      if ((r.rawScore ?? 0) >= 60) {
        audit.contradictions.highSpLowLikelihood++;
        audit.issues.push({
          jobHash: r.jobHash,
          type: "contradiction",
          severity: "medium",
          description: `High SP (${sp}) + reasonable score (${r.rawScore}) but PASS without veto`,
          signals: { cv, sp, friction, verb }
        });
      }
    }

    if (sp < 30 && verb === "PURSUE") {
      audit.contradictions.lowSpHighLikelihood++;
      audit.issues.push({
        jobHash: r.jobHash,
        type: "contradiction",
        severity: "high",
        description: `Low SP (${sp}) but PURSUE - shortlisting unlikely`,
        signals: { cv, sp, friction, verb }
      });
    }

    // 3. Check for narrative defects in trace
    const pipelineStr = JSON.stringify(r.trace?.pipeline || []);
    if (pipelineStr.includes("{") && pipelineStr.includes("}")) {
      // Check for raw object injection
      if (pipelineStr.includes('"reason":{')) {
        audit.defects.jsonLeakage++;
        audit.issues.push({
          jobHash: r.jobHash,
          type: "defect",
          severity: "medium",
          description: "Potential JSON object leakage in pipeline reason",
          signals: { cv, sp, friction, verb }
        });
      }
    }

    // 4. Check recommendation consistency
    if (r.explanation?.reason) {
      const reason = r.explanation.reason;
      if (reason.includes("undefined") || reason.includes("null") || reason.includes("[object")) {
        audit.defects.malformedStrings++;
        audit.issues.push({
          jobHash: r.jobHash,
          type: "defect",
          severity: "high",
          description: "Malformed string in explanation reason",
          signals: { cv, sp, friction, verb },
          narrative: reason
        });
      }
    }
  }

  return audit;
}

function printCoherenceReport(audit: NarrativeAudit) {
  console.log("\n" + "=".repeat(80));
  console.log("P3-C: NARRATIVE COHERENCE AUDIT");
  console.log("=".repeat(80));

  console.log(`\n📊 Total Records Audited: ${audit.totalRecords}`);

  // Contradictions Summary
  console.log("\n" + "-".repeat(80));
  console.log("SIGNAL CONTRADICTIONS");
  console.log("-".repeat(80));

  const totalContradictions =
    audit.contradictions.highCvLowValue +
    audit.contradictions.lowCvHighValue +
    audit.contradictions.highSpLowLikelihood +
    audit.contradictions.lowSpHighLikelihood;

  console.log(`\nHigh CV + PASS (no veto): ${audit.contradictions.highCvLowValue}`);
  console.log(`Low CV + PURSUE: ${audit.contradictions.lowCvHighValue}`);
  console.log(`High SP + PASS (reasonable score): ${audit.contradictions.highSpLowLikelihood}`);
  console.log(`Low SP + PURSUE: ${audit.contradictions.lowSpHighLikelihood}`);
  console.log(`\nTotal Contradictions: ${totalContradictions}`);

  if (totalContradictions === 0) {
    console.log("\n✅ No signal contradictions detected");
  } else if (totalContradictions < 20) {
    console.log("\n⚠️ Minor contradictions - may be edge cases");
  } else {
    console.log("\n❌ Significant contradictions - requires investigation");
  }

  // Defects Summary
  console.log("\n" + "-".repeat(80));
  console.log("PRESENTATION DEFECTS");
  console.log("-".repeat(80));

  const totalDefects =
    audit.defects.jsonLeakage +
    audit.defects.malformedStrings +
    audit.defects.truncationArtifacts +
    audit.defects.brokenSentences;

  console.log(`\nJSON Leakage: ${audit.defects.jsonLeakage}`);
  console.log(`Malformed Strings: ${audit.defects.malformedStrings}`);
  console.log(`Truncation Artifacts: ${audit.defects.truncationArtifacts}`);
  console.log(`Broken Sentences: ${audit.defects.brokenSentences}`);
  console.log(`\nTotal Defects: ${totalDefects}`);

  if (totalDefects === 0) {
    console.log("\n✅ No presentation defects detected");
  } else {
    console.log("\n⚠️ Presentation defects found");
  }

  // High Severity Issues
  const highSeverityIssues = audit.issues.filter(i => i.severity === "high");
  if (highSeverityIssues.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("HIGH SEVERITY ISSUES");
    console.log("-".repeat(80));
    highSeverityIssues.slice(0, 10).forEach(issue => {
      console.log(`\n  ${issue.jobHash}:`);
      console.log(`    Type: ${issue.type}`);
      console.log(`    Description: ${issue.description}`);
      if (issue.narrative) {
        console.log(`    Narrative: ${issue.narrative.substring(0, 100)}...`);
      }
    });
  }

  // Overall Assessment
  console.log("\n" + "=".repeat(80));
  console.log("OVERALL ASSESSMENT");
  console.log("=".repeat(80));

  const totalIssues = audit.issues.length;
  const issueRate = (totalIssues / audit.totalRecords) * 100;

  console.log(`\nTotal Issues: ${totalIssues} (${issueRate.toFixed(2)}% of records)`);

  if (totalIssues === 0) {
    console.log("\n✅ EXCELLENT: No coherence issues or defects detected");
  } else if (issueRate < 1) {
    console.log("\n✅ GOOD: Minimal issues (< 1% of records)");
  } else if (issueRate < 5) {
    console.log("\n⚠️ FAIR: Some issues detected but manageable");
  } else {
    console.log("\n❌ POOR: Significant issues requiring attention");
  }

  console.log("\n" + "=".repeat(80));
  console.log("END OF P3-C AUDIT");
  console.log("=".repeat(80));
}

async function main() {
  console.log("P3-C: Running Narrative Coherence Audit...");

  invalidateEngineCache();

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  const { records } = runEngine(projection, 0);

  const audit = auditNarrativeCoherence(records);
  printCoherenceReport(audit);
}

main().catch(console.error);
