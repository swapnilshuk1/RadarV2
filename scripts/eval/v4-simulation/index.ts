/**
 * scripts/eval/v4-simulation/index.ts
 *
 * Main CLI entrypoint for RADAR V4 Phase 8 End-to-End Engine Simulation & Verbatim Quality Audit.
 * Executes the complete simulation across 120+ real scraped JDs and persists all durable artifacts.
 */

import * as fs from "fs";
import * as path from "path";
import { sampleCorpus } from "./corpus-sampler";
import { runPipelineOnJD } from "./runner";
import { auditVerbatims } from "./verbatim-auditor";
import { scanContradictions } from "./contradiction-scanner";
import { mineGenericLanguage } from "./generic-language-miner";
import { testMutationSensitivity } from "./mutation-tester";
import {
  buildInterplayMatrix,
  computeCategoryAggregates,
  computeSeniorityAggregates,
} from "./interplay-matrix";
import { compileHumanReviewPacket } from "./human-review-compiler";
import { generateMarkdownReport } from "./report-generator";
import type { SimulationManifest, CertificationStatus, SimulationRecord } from "./types";

async function main() {
  console.log("========================================================================");
  console.log("  RADAR V4 — END-TO-END ENGINE SIMULATION & VERBATIM QUALITY AUDIT");
  console.log("========================================================================\n");

  const startTime = Date.now();
  const runId = `sim_v4_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const baseOutDir = path.resolve(process.cwd(), ".scraper-artifacts", "v4-engine-simulation");
  const runDir = path.join(baseOutDir, runId);
  const latestDir = path.join(baseOutDir, "latest");

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(latestDir, { recursive: true });

  // 1. Stratified Sampling from .scraper-artifacts/extractions/
  console.log("[1/8] Sampling Stratified Corpus of 120+ Real Scraped JDs...");
  const sampledJDs = sampleCorpus(125);
  console.log(`✓ Sampled ${sampledJDs.length} real JDs across 16 categories.\n`);

  // 2. Production Pipeline Execution
  console.log("[2/8] Executing Full Production V4 Pipeline on each JD...");
  const records: SimulationRecord[] = [];
  for (let i = 0; i < sampledJDs.length; i++) {
    const s = sampledJDs[i];
    const rec = runPipelineOnJD(s);

    // 3. Verbatim Quality & Evidence Lineage Audit
    const auditRes = auditVerbatims(rec);
    rec.verbatimAudits = auditRes.audits;
    rec.objectiveScores = auditRes.objectiveScores;

    // 4. Contradiction & Policy Authority Invariant Scanning
    rec.contradictions = scanContradictions(rec);

    if (rec.failures.length > 0 || rec.contradictions.some((c) => c.severity === "CRITICAL")) {
      rec.assessmentVerdict = "FAIL";
    } else if (rec.contradictions.length > 0 || rec.objectiveScores.totalObjectiveScore < 24) {
      rec.assessmentVerdict = "REVIEW";
    } else {
      rec.assessmentVerdict = "PASS";
    }

    records.push(rec);
    if ((i + 1) % 25 === 0 || i === sampledJDs.length - 1) {
      console.log(`  Processed ${i + 1}/${sampledJDs.length} JDs...`);
    }
  }
  console.log(`✓ Pipeline & Verbatim Audit completed for ${records.length} JDs.\n`);

  // 5. Generic Language Mining
  console.log("[5/8] Mining Corpus-Wide Generic Language & Repeated Clichés...");
  const genericPhrases = mineGenericLanguage(records);
  console.log(`✓ Identified ${genericPhrases.length} recurring phrase patterns.\n`);

  // 6. Mutation Sensitivity Suite (20 JDs x 4 Mutations)
  console.log("[6/8] Executing Mutation Sensitivity Suite (20 JDs x 4 Mutations = 80 Runs)...");
  const mutationResults = testMutationSensitivity(sampledJDs);
  const totalMutations = mutationResults.reduce((acc, r) => acc + r.variants.length, 0);
  const causalMutations = mutationResults.reduce(
    (acc, r) => acc + r.variants.filter((v) => v.engineRespondedCausally).length,
    0
  );
  const mutationCausalityRate = Math.round((causalMutations / (totalMutations || 1)) * 1000) / 10;
  console.log(`✓ Mutation Sensitivity complete: ${causalMutations}/${totalMutations} variants causally responsive (${mutationCausalityRate}%).\n`);

  // 7. Interplay Matrix, Category & Seniority Summaries
  console.log("[7/8] Aggregating Interplay Matrix, Summaries & Human Review Packets...");
  const interplayRows = buildInterplayMatrix(records);
  const categoryAggs = computeCategoryAggregates(records);
  const seniorityAggs = computeSeniorityAggregates(records);
  const humanReviewPacket = compileHumanReviewPacket(records);

  // Global Summary Metrics
  const totalAudits = records.reduce((acc, r) => acc + r.verbatimAudits.length, 0);
  const groundedAudits = records.reduce(
    (acc, r) =>
      acc +
      r.verbatimAudits.filter((a) => a.classification === "FACTUAL" || a.classification === "EVIDENCE-GROUNDED INFERENCE")
        .length,
    0
  );
  const unsupportedAudits = records.reduce(
    (acc, r) => acc + r.verbatimAudits.filter((a) => a.classification === "UNSUPPORTED").length,
    0
  );
  const directContradictions = records.reduce((acc, r) => acc + r.contradictions.length, 0);

  const policyAlignedCount = records.filter(
    (r) => r.briefModel?.memory?.decision === r.policyResult.verdict
  ).length;
  const policyEditorialAlignmentRate = Math.round((policyAlignedCount / (records.length || 1)) * 1000) / 10;
  const unsupportedClaimRate = Math.round((unsupportedAudits / (totalAudits || 1)) * 1000) / 10;
  const evidenceTraceabilityRate = Math.round((groundedAudits / (totalAudits || 1)) * 1000) / 10;

  const genericCount = records.reduce(
    (acc, r) => acc + r.verbatimAudits.filter((a) => a.classification === "GENERIC / LOW-VALUE").length,
    0
  );
  const genericPhraseRate = Math.round((genericCount / (totalAudits || 1)) * 1000) / 10;

  const avgObjectiveQuality =
    Math.round(
      (records.reduce((acc, r) => acc + r.objectiveScores.totalObjectiveScore, 0) / (records.length || 1)) * 10
    ) / 10;

  const totalFailures = records.reduce((acc, r) => acc + r.failures.length, 0);

  // Determine Certification Status
  let certificationStatus: CertificationStatus = "🟢 CERTIFIED";
  if (totalFailures > 0 || policyEditorialAlignmentRate < 95 || directContradictions > 10) {
    certificationStatus = "🔴 FAIL";
  } else if (evidenceTraceabilityRate < 70 || mutationCausalityRate < 70) {
    certificationStatus = "🟠 REQUIRES REMEDIATION";
  } else if (genericPhraseRate > 15 || unsupportedClaimRate > 5 || directContradictions > 0) {
    certificationStatus = "🟡 CERTIFIED WITH DEBT";
  }

  const manifest: SimulationManifest = {
    runId,
    timestamp: new Date().toISOString(),
    engineVersion: "4.0.0",
    ontologyVersion: "2.1.0",
    candidateProfileFingerprint: "p_swapnil_exec_commercial_v2",
    totalJDs: records.length,
    categoriesRepresented: categoryAggs.length,
    seniorityTiersRepresented: seniorityAggs.length,
    certificationStatus,
    summaryMetrics: {
      policyEditorialAlignmentRate,
      unsupportedClaimRate,
      directContradictionCount: directContradictions,
      evidenceTraceabilityRate,
      genericPhraseRate,
      mutationCausalityRate,
      averageObjectiveQualityScore: avgObjectiveQuality,
      totalFailuresCount: totalFailures,
    },
  };

  // 8. Write All Durable Artifacts
  console.log("[8/8] Writing Durable Simulation Artifacts to .scraper-artifacts/v4-engine-simulation/ ...");

  const filesToWrite = [
    { name: "manifest.json", data: manifest },
    { name: "corpus.json", data: sampledJDs },
    {
      name: "engine-results.json",
      data: records.map((r) => ({
        jobHash: r.jobHash,
        role: r.role,
        company: r.company,
        isolatedAssessments: r.isolatedAssessments,
        shortlistingPotential: r.shortlistingPotential,
        failures: r.failures,
      })),
    },
    {
      name: "ontology-results.json",
      data: records.map((r) => ({
        jobHash: r.jobHash,
        role: r.role,
        company: r.company,
        dimensions: r.extractedDimensions,
      })),
    },
    {
      name: "policy-results.json",
      data: records.map((r) => ({
        jobHash: r.jobHash,
        role: r.role,
        company: r.company,
        policyResult: r.policyResult,
      })),
    },
    {
      name: "editorial-results.json",
      data: records.map((r) => ({
        jobHash: r.jobHash,
        role: r.role,
        company: r.company,
        briefModel: r.briefModel,
      })),
    },
    {
      name: "verbatim-audit.json",
      data: records.map((r) => ({
        jobHash: r.jobHash,
        role: r.role,
        company: r.company,
        audits: r.verbatimAudits,
        scores: r.objectiveScores,
      })),
    },
    {
      name: "contradictions.json",
      data: records.filter((r) => r.contradictions.length > 0).map((r) => ({
        jobHash: r.jobHash,
        role: r.role,
        company: r.company,
        contradictions: r.contradictions,
      })),
    },
    { name: "category-summary.json", data: categoryAggs },
    { name: "seniority-summary.json", data: seniorityAggs },
    {
      name: "quality-summary.json",
      data: {
        totalRecords: records.length,
        avgObjectiveScore: avgObjectiveQuality,
        distribution: {
          passCount: records.filter((r) => r.assessmentVerdict === "PASS").length,
          reviewCount: records.filter((r) => r.assessmentVerdict === "REVIEW").length,
          failCount: records.filter((r) => r.assessmentVerdict === "FAIL").length,
        },
        genericPhrasesTop15: genericPhrases.slice(0, 15),
      },
    },
    { name: "mutation-results.json", data: mutationResults },
    { name: "human-review-packet.json", data: humanReviewPacket },
  ];

  for (const file of filesToWrite) {
    const jsonStr = JSON.stringify(file.data, null, 2);
    fs.writeFileSync(path.join(runDir, file.name), jsonStr, "utf-8");
    fs.writeFileSync(path.join(latestDir, file.name), jsonStr, "utf-8");
  }

  // Generate Markdown Report
  const markdownReport = generateMarkdownReport(
    manifest,
    records,
    interplayRows,
    categoryAggs,
    seniorityAggs,
    genericPhrases,
    mutationResults
  );

  fs.writeFileSync(path.join(runDir, "final-report.md"), markdownReport, "utf-8");
  fs.writeFileSync(path.join(latestDir, "final-report.md"), markdownReport, "utf-8");

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n========================================================================");
  console.log(`  SIMULATION COMPLETED IN ${elapsedSec}s — STATUS: ${certificationStatus}`);
  console.log("========================================================================");
  console.log(`• Total JDs Evaluated:            ${records.length}`);
  console.log(`• Policy/Editorial Alignment:     ${policyEditorialAlignmentRate}%`);
  console.log(`• Evidence Traceability Rate:     ${evidenceTraceabilityRate}%`);
  console.log(`• Direct Contradictions:          ${directContradictions}`);
  console.log(`• Mutation Causality Rate:        ${mutationCausalityRate}%`);
  console.log(`• Average Objective Quality:      ${avgObjectiveQuality} / 35`);
  console.log(`• Report written to:              .scraper-artifacts/v4-engine-simulation/${runId}/final-report.md`);
  console.log("========================================================================\n");
}

main().catch((err) => {
  console.error("FATAL ERROR running simulation:", err);
  process.exit(1);
});
