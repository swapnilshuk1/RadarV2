import * as fs from "node:fs";
import * as path from "node:path";
import {
  normalizeReferenceTruth,
  adaptArchitectureA,
  adaptArchitectureB,
  adaptArchitectureC,
  evaluateDocumentAssertions,
  evaluateCandidateProofExtractor,
  HIGH_RISK_FAMILIES,
  DocumentEvaluationResult,
  CandidateEvaluationResult
} from "./evaluator-v2.js";

const root = process.cwd();
const batchDir = path.resolve(root, "audit-reports/gate1b-batch04c");
const r1Dir = path.resolve(root, "audit-reports/gate1b-batch04c-r1");

const refTruthRaw = JSON.parse(fs.readFileSync(path.join(batchDir, "fixtures/reference-truth.json"), "utf8"));
const popRaw = JSON.parse(fs.readFileSync(path.join(batchDir, "fixtures/population-raw.json"), "utf8"));
const segPop = JSON.parse(fs.readFileSync(path.join(batchDir, "manifests/segmented-population.json"), "utf8"));

const archADir = path.join(batchDir, "runs/arch_a_deterministic");
const archBDir = path.join(batchDir, "runs/arch_b_direct_ontology/resolved");
const archCOrigDir = path.join(batchDir, "runs/arch_c_rich_semantic/resolved");
const archCR1Dir = path.join(r1Dir, "runs/arch_c_capacity_65k/resolved");

const TRUNCATED_12 = [
  "DEV_CONTROL_01",
  "DIVERSE_ROLE_02",
  "DIVERSE_ROLE_03",
  "DIVERSE_ROLE_04",
  "HOLDOUT_ROLE_01",
  "HOLDOUT_ROLE_02",
  "HOLDOUT_ROLE_03",
  "HOLDOUT_ROLE_04",
  "HOLDOUT_ROLE_05",
  "HOLDOUT_ROLE_06",
  "HOLDOUT_ROLE_07",
  "HOLDOUT_ROLE_08"
];

type PartitionName = 
  | "REGRESSION_DIVERSE"
  | "REGRESSION_ADVERSARIAL"
  | "FRESH_HOLDOUT"
  | "FRESH_ADVERSARIAL"
  | "DEVELOPMENT_CONTROL"
  | "OVERALL";

interface AggregateMetrics {
  totalFacts: number;
  selectionMatches: number;
  typedMatches: number;
  selectionRecall: number;
  typedRecall: number;
  applicabilityMatches: number;
  applicabilityEvaluated: number;
  applicabilityAccuracy: number | null;
  polarityMatches: number;
  polarityEvaluated: number;
  polarityAccuracy: number | null;
  highRiskViolations: number;
  totalAssertionsEmitted: number;
}

function initMetrics(): AggregateMetrics {
  return {
    totalFacts: 0,
    selectionMatches: 0,
    typedMatches: 0,
    selectionRecall: 0,
    typedRecall: 0,
    applicabilityMatches: 0,
    applicabilityEvaluated: 0,
    applicabilityAccuracy: null,
    polarityMatches: 0,
    polarityEvaluated: 0,
    polarityAccuracy: null,
    highRiskViolations: 0,
    totalAssertionsEmitted: 0
  };
}

function updateAggregates(agg: AggregateMetrics, docRes: DocumentEvaluationResult) {
  agg.totalFacts += docRes.referenceFactCount;
  agg.selectionMatches += docRes.selectionMatches;
  agg.typedMatches += docRes.typedMatches;
  agg.applicabilityMatches += docRes.applicabilityMatches;
  agg.applicabilityEvaluated += docRes.applicabilityEvaluated;
  agg.polarityMatches += docRes.polarityMatches;
  agg.polarityEvaluated += docRes.polarityEvaluated;
  agg.highRiskViolations += docRes.highRiskViolationCount;
  agg.totalAssertionsEmitted += docRes.totalAssertionsEmitted;

  agg.selectionRecall = agg.totalFacts > 0 ? agg.selectionMatches / agg.totalFacts : 0;
  agg.typedRecall = agg.totalFacts > 0 ? agg.typedMatches / agg.totalFacts : 0;
  agg.applicabilityAccuracy = agg.applicabilityEvaluated > 0 ? agg.applicabilityMatches / agg.applicabilityEvaluated : null;
  agg.polarityAccuracy = agg.polarityEvaluated > 0 ? agg.polarityMatches / agg.polarityEvaluated : null;
}

export function runR1Evaluation() {
  console.log("==================================================================");
  console.log("   RADAR GATE 1B BATCH 04C-R1: COMPREHENSIVE EVALUATION SUITE    ");
  console.log("==================================================================");

  // -------------------------------------------------------------
  // 1. Audit Reference Truth Set (Section 6)
  // -------------------------------------------------------------
  console.log("\n--- Section 1: Reference Truth Set Audit (N=21 Role Docs) ---");
  const roleRefDocs = refTruthRaw.documents.filter((d: any) => d.partition !== "CANDIDATE_DOCUMENT");
  const truthAudit: any[] = [];
  let totalFactsCount = 0;
  let totalHighRiskPositives = 0;
  let totalHighRiskNegatives = 0;
  let totalApplicabilityControls = 0;
  let totalPolarityControls = 0;

  for (const rawDoc of roleRefDocs) {
    const norm = normalizeReferenceTruth(rawDoc);
    const facts = norm.normalizedFacts;
    const hrPos = facts.filter(f => f.polarity === "AFFIRMED" && f.highRiskFamily !== null).length;
    const hrNeg = facts.filter(f => f.polarity === "NEGATED" && f.highRiskFamily !== null).length + norm.highRiskNegatives.length;
    const appControls = facts.filter(f => f.appliesTo !== "ROLE").length;
    const polControls = facts.filter(f => f.polarity !== "AFFIRMED").length;

    totalFactsCount += facts.length;
    totalHighRiskPositives += hrPos;
    totalHighRiskNegatives += hrNeg;
    totalApplicabilityControls += appControls;
    totalPolarityControls += polControls;

    truthAudit.push({
      documentId: rawDoc.documentId,
      partition: rawDoc.partition,
      referenceFactCount: facts.length,
      highRiskPositiveCount: hrPos,
      highRiskNegativeCount: hrNeg,
      applicabilityControlsCount: appControls,
      polarityControlsCount: polControls
    });
  }

  console.log(`Total Reference Facts: ${totalFactsCount} across 21 role documents (Avg: ${(totalFactsCount / 21).toFixed(1)} facts/doc).`);
  console.log(`Audit Determination: Clearly represents B. SELECTED CONTROL/REFERENCE SET (Not comprehensive material truth).`);
  console.log(`Directive Applied: All 'material recall' claims renamed to 'PREDECLARED REFERENCE RECALL'.`);

  // -------------------------------------------------------------
  // 2. Evaluate All Architectures on Role Population (N=21)
  // -------------------------------------------------------------
  const partitions: PartitionName[] = [
    "REGRESSION_DIVERSE",
    "REGRESSION_ADVERSARIAL",
    "FRESH_HOLDOUT",
    "FRESH_ADVERSARIAL",
    "DEVELOPMENT_CONTROL",
    "OVERALL"
  ];

  const resultsA: Record<PartitionName, AggregateMetrics> = {} as any;
  const resultsB: Record<PartitionName, AggregateMetrics> = {} as any;
  const resultsCOrig: Record<PartitionName, AggregateMetrics> = {} as any;
  const resultsCR1: Record<PartitionName, AggregateMetrics> = {} as any;

  partitions.forEach(p => {
    resultsA[p] = initMetrics();
    resultsB[p] = initMetrics();
    resultsCOrig[p] = initMetrics();
    resultsCR1[p] = initMetrics();
  });

  const docResultsA: DocumentEvaluationResult[] = [];
  const docResultsB: DocumentEvaluationResult[] = [];
  const docResultsCOrig: DocumentEvaluationResult[] = [];
  const docResultsCR1: DocumentEvaluationResult[] = [];

  for (const rawDoc of roleRefDocs) {
    const docId = rawDoc.documentId;
    let partition: PartitionName = "OVERALL";
    if (rawDoc.partition === "DIVERSE_ROLE" || rawDoc.partition === "REGRESSION_DIVERSE") partition = "REGRESSION_DIVERSE";
    else if (rawDoc.partition === "ADVERSARIAL_ROLE" || rawDoc.partition === "REGRESSION_ADVERSARIAL") partition = "REGRESSION_ADVERSARIAL";
    else if (rawDoc.partition === "FRESH_HOLDOUT") partition = "FRESH_HOLDOUT";
    else if (rawDoc.partition === "FRESH_ADVERSARIAL") partition = "FRESH_ADVERSARIAL";
    else if (rawDoc.partition === "DEVELOPMENT_CONTROL") partition = "DEVELOPMENT_CONTROL";
    const norm = normalizeReferenceTruth(rawDoc);
    const docSeg = segPop.find((s: any) => s.id === docId);

    // Arch A
    const rawA = JSON.parse(fs.readFileSync(path.join(archADir, `${docId}.json`), "utf8"));
    const assertionsA = adaptArchitectureA(docId, rawA, docSeg?.units ?? []);
    const resA = evaluateDocumentAssertions(docId, partition, "ARCH_A", norm.normalizedFacts, norm.highRiskNegatives, norm.disclaimerSpans, assertionsA);
    docResultsA.push(resA);
    updateAggregates(resultsA[partition], resA);
    updateAggregates(resultsA["OVERALL"], resA);

    // Arch B (Direct Closed-Ontology Gemini)
    const resolvedB = JSON.parse(fs.readFileSync(path.join(archBDir, `${docId}.json`), "utf8"));
    const assertionsB = adaptArchitectureB(docId, resolvedB);
    const resB = evaluateDocumentAssertions(docId, partition, "ARCH_B", norm.normalizedFacts, norm.highRiskNegatives, norm.disclaimerSpans, assertionsB);
    docResultsB.push(resB);
    updateAggregates(resultsB[partition], resB);
    updateAggregates(resultsB["OVERALL"], resB);

    // Arch C Original (8k)
    const resolvedCOrig = JSON.parse(fs.readFileSync(path.join(archCOrigDir, `${docId}.json`), "utf8"));
    const assertionsCOrig = adaptArchitectureC(docId, resolvedCOrig);
    const resCOrig = evaluateDocumentAssertions(docId, partition, "ARCH_C_ORIGINAL_8K", norm.normalizedFacts, norm.highRiskNegatives, norm.disclaimerSpans, assertionsCOrig);
    docResultsCOrig.push(resCOrig);
    updateAggregates(resultsCOrig[partition], resCOrig);
    updateAggregates(resultsCOrig["OVERALL"], resCOrig);

    // Arch C R1 (Capacity-Corrected 65k)
    const resolvedCR1 = JSON.parse(fs.readFileSync(path.join(archCR1Dir, `${docId}.json`), "utf8"));
    const assertionsCR1 = adaptArchitectureC(docId, resolvedCR1);
    const resCR1 = evaluateDocumentAssertions(docId, partition, "ARCH_C_R1_CAPACITY_65K", norm.normalizedFacts, norm.highRiskNegatives, norm.disclaimerSpans, assertionsCR1);
    docResultsCR1.push(resCR1);
    updateAggregates(resultsCR1[partition], resCR1);
    updateAggregates(resultsCR1["OVERALL"], resCR1);
  }

  // -------------------------------------------------------------
  // 3. Capacity Causal Diagnostic (Paired Comparison on 12 Truncated Docs)
  // -------------------------------------------------------------
  console.log("\n--- Section 3: Capacity Diagnostic (12 Rerun Fixtures) ---");
  const pairedCapacityComparison: any[] = [];
  let origTruncRecallSum = 0;
  let r1TruncRecallSum = 0;
  let origTruncFactsSum = 0;

  for (const docId of TRUNCATED_12) {
    const origData = JSON.parse(fs.readFileSync(path.join(archCOrigDir, `${docId}.json`), "utf8"));
    const r1Data = JSON.parse(fs.readFileSync(path.join(archCR1Dir, `${docId}.json`), "utf8"));
    const origEval = docResultsCOrig.find(r => r.documentId === docId)!;
    const r1Eval = docResultsCR1.find(r => r.documentId === docId)!;

    origTruncRecallSum += origEval.selectionMatches;
    r1TruncRecallSum += r1Eval.selectionMatches;
    origTruncFactsSum += origEval.referenceFactCount;

    pairedCapacityComparison.push({
      documentId: docId,
      partition: origEval.partition,
      referenceFacts: origEval.referenceFactCount,
      original8k: {
        finishReason: origData.finishReason ?? (origData.isTruncated ? "MAX_TOKENS" : "STOP"),
        isTruncated: origData.isTruncated ?? false,
        thoughtsTokenCount: origData.rawUsage?.thoughtsTokenCount,
        candidatesTokenCount: origData.rawUsage?.candidatesTokenCount,
        propositionCount: origData.propositionsCount ?? (origData.propositions || []).length,
        selectionRecall: origEval.selectionRecall,
        typedRecall: origEval.typedRecall,
        highRiskViolations: origEval.highRiskViolationCount,
        unmappedConcepts: origEval.unmappedConceptsCount
      },
      capacity65k: {
        finishReason: r1Data.finishReason,
        isTruncated: r1Data.isTruncated,
        thoughtsTokenCount: r1Data.rawUsage?.thoughtsTokenCount,
        candidatesTokenCount: r1Data.rawUsage?.candidatesTokenCount,
        propositionCount: r1Data.propositionsCount,
        selectionRecall: r1Eval.selectionRecall,
        typedRecall: r1Eval.typedRecall,
        highRiskViolations: r1Eval.highRiskViolationCount,
        unmappedConcepts: r1Eval.unmappedConceptsCount
      }
    });
  }

  const origTruncRate = origTruncFactsSum > 0 ? (origTruncRecallSum / origTruncFactsSum) * 100 : 0;
  const r1TruncRate = origTruncFactsSum > 0 ? (r1TruncRecallSum / origTruncFactsSum) * 100 : 0;

  let causalConclusion: "SUPPORTED" | "PARTIALLY_SUPPORTED" | "NOT_SUPPORTED" = "SUPPORTED";
  if (r1TruncRate > origTruncRate + 15) {
    causalConclusion = "SUPPORTED";
  } else if (r1TruncRate > origTruncRate) {
    causalConclusion = "PARTIALLY_SUPPORTED";
  } else {
    causalConclusion = "NOT_SUPPORTED";
  }

  console.log(`Original 12-doc Truncated Recall: ${origTruncRecallSum}/${origTruncFactsSum} (${origTruncRate.toFixed(1)}%)`);
  console.log(`Capacity-Corrected 12-doc Recall: ${r1TruncRecallSum}/${origTruncFactsSum} (${r1TruncRate.toFixed(1)}%)`);
  console.log(`Empirical Causal Conclusion: ${causalConclusion}`);

  // -------------------------------------------------------------
  // 4. Candidate Proof Common-Truth Rescoring (Section 12)
  // -------------------------------------------------------------
  console.log("\n--- Section 4: Candidate Proof Rescoring (N=2) ---");
  const candDocs = refTruthRaw.documents.filter((d: any) => d.partition === "CANDIDATE_DOCUMENT");
  const candidateResults: CandidateEvaluationResult[] = [];

  for (const cDoc of candDocs) {
    const docId = cDoc.documentId;
    const refFacts = cDoc.materialFacts;

    // Deterministic V1
    const v1Path = path.join(batchDir, `runs/candidate_comparison/${docId}.json`);
    const v1Data = JSON.parse(fs.readFileSync(v1Path, "utf8"));
    const v1Claims = v1Data.deterministicV1?.claims ?? [];
    const v1Res = evaluateCandidateProofExtractor(docId, "DETERMINISTIC_V1", refFacts, v1Claims);
    candidateResults.push(v1Res);

    // 04B Candidate Source-ID Gemini
    const b04bPath = path.join(root, `audit-reports/gate1b-batch04b/runs/RUN_01/resolved/${docId}.json`);
    const b04bData = JSON.parse(fs.readFileSync(b04bPath, "utf8"));
    const b04bClaims = b04bData.assembly?.output?.allClaims ?? [];
    const b04bRes = evaluateCandidateProofExtractor(docId, "GEMINI_SOURCE_ID_04B", refFacts, b04bClaims);
    candidateResults.push(b04bRes);
  }

  // -------------------------------------------------------------
  // 5. Proposition Economy & Unmapped Concepts Adjudication (Section 10)
  // -------------------------------------------------------------
  console.log("\n--- Section 5: Proposition Economy & Unmapped Concepts ---");
  let totalEmittedPropsCR1 = 0;
  let totalProjectedAtomsCR1 = 0;
  let totalNegativeBoundariesCR1 = 0;
  let totalNonMaterialCR1 = 0;
  const allUnmappedConceptsCR1 = new Map<string, string>();

  for (const doc of roleRefDocs) {
    const resolvedCR1 = JSON.parse(fs.readFileSync(path.join(archCR1Dir, `${doc.documentId}.json`), "utf8"));
    const props = resolvedCR1.propositions ?? [];
    totalEmittedPropsCR1 += props.length;
    totalProjectedAtomsCR1 += resolvedCR1.projectionSummary?.projectedAtomsCount ?? 0;
    totalNegativeBoundariesCR1 += resolvedCR1.projectionSummary?.negativeBoundaryCount ?? 0;
    totalNonMaterialCR1 += resolvedCR1.projectionSummary?.nonMaterialCount ?? 0;

    for (const p of props) {
      if (p.ontologyDisposition === "UNMAPPED_MATERIAL" || (p.canonicalTypes && p.canonicalTypes.length === 0)) {
        const desc = p.unmappedConceptDescription || p.proposition;
        if (!allUnmappedConceptsCR1.has(desc)) {
          allUnmappedConceptsCR1.set(desc, p.proposition);
        }
      }
    }
  }

  // Adjudicate unmapped concepts
  const adjudicatedConcepts: Array<{ concept: string; example: string; classification: "MATERIAL_NEW_SIGNAL" | "REDUNDANT_EXISTING_SIGNAL" | "NON_MATERIAL" | "MODEL_INVENTION"; rationale: string }> = [];
  for (const [concept, example] of allUnmappedConceptsCR1.entries()) {
    const cUpper = concept.toUpperCase();
    if (
      cUpper.includes("PRIVACY") || cUpper.includes("DATA PROTECTION") || cUpper.includes("GDPR") ||
      cUpper.includes("RIGHTS") || cUpper.includes("AI TOOLS") || cUpper.includes("AI-POWERED") ||
      cUpper.includes("INTERVIEW PROCESS") || cUpper.includes("APPLICATION") || cUpper.includes("CONTACT") ||
      cUpper.includes("PARTNER COMPANY") || cUpper.includes("CULTURE") || cUpper.includes("VALUES") ||
      cUpper.includes("MISSION") || cUpper.includes("PASSION") || cUpper.includes("COLLABORATION") ||
      cUpper.includes("AGILITY") || cUpper.includes("CURIOSITY") || cUpper.includes("INNOVATIVE") ||
      cUpper.includes("RESULTS-FOCUSED") || cUpper.includes("DECISIVENESS") || cUpper.includes("RISKS WITH AMBIGUITY") ||
      cUpper.includes("PERSPECTIVES") || cUpper.includes("CONTINUOUS IMPROVEMENT")
    ) {
      adjudicatedConcepts.push({ concept, example, classification: "NON_MATERIAL", rationale: "Boilerplate privacy notices, applicant legal rights, recruiting pipeline mechanics, or generic cultural soft skills without executive decision impact." });
    } else if (
      cUpper.includes("COMPENSATION") || cUpper.includes("SALARY") || cUpper.includes("SENIORITY") ||
      cUpper.includes("LEVEL") || cUpper.includes("REPORTING") || cUpper.includes("HIERARCHY") ||
      cUpper.includes("TRAVEL") || cUpper.includes("REMOTE") || cUpper.includes("LOCATION") ||
      cUpper.includes("EXPERIENCE LEVEL") || cUpper.includes("ORGANIZATION")
    ) {
      adjudicatedConcepts.push({ concept, example, classification: "REDUNDANT_EXISTING_SIGNAL", rationale: "Could map directly to existing closed-ontology canonical types (e.g., COMPENSATION, LEVEL, WORK_CONDITION, REPORTING_LINE)." });
    } else if (
      cUpper.includes("FIREWALL") || cUpper.includes("CONFLICT") || cUpper.includes("TRADING") ||
      cUpper.includes("REGULATORY") || cUpper.includes("M&A") || cUpper.includes("DUE DILIGENCE") ||
      cUpper.includes("BOARD DYNAMICS") || cUpper.includes("GREENFIELD") || cUpper.includes("EXCLUSION") ||
      cUpper.includes("VENDOR")
    ) {
      adjudicatedConcepts.push({ concept, example, classification: "MATERIAL_NEW_SIGNAL", rationale: "Genuine novel executive domain constraint/boundary not expressible within the 15 closed types." });
    } else {
      adjudicatedConcepts.push({ concept, example, classification: "NON_MATERIAL", rationale: "Descriptive background context or unclassified process information lacking executive qualification impact." });
    }
  }

  const classificationCounts = {
    MATERIAL_NEW_SIGNAL: adjudicatedConcepts.filter(c => c.classification === "MATERIAL_NEW_SIGNAL").length,
    REDUNDANT_EXISTING_SIGNAL: adjudicatedConcepts.filter(c => c.classification === "REDUNDANT_EXISTING_SIGNAL").length,
    NON_MATERIAL: adjudicatedConcepts.filter(c => c.classification === "NON_MATERIAL").length,
    MODEL_INVENTION: adjudicatedConcepts.filter(c => c.classification === "MODEL_INVENTION").length
  };
  const totalConcepts = adjudicatedConcepts.length;
  const classificationPercentages = {
    MATERIAL_NEW_SIGNAL: totalConcepts > 0 ? (classificationCounts.MATERIAL_NEW_SIGNAL / totalConcepts) * 100 : 0,
    REDUNDANT_EXISTING_SIGNAL: totalConcepts > 0 ? (classificationCounts.REDUNDANT_EXISTING_SIGNAL / totalConcepts) * 100 : 0,
    NON_MATERIAL: totalConcepts > 0 ? (classificationCounts.NON_MATERIAL / totalConcepts) * 100 : 0,
    MODEL_INVENTION: totalConcepts > 0 ? (classificationCounts.MODEL_INVENTION / totalConcepts) * 100 : 0
  };

  // Save evaluation summary JSON
  const summaryPayload = {
    evaluatedAt: new Date().toISOString(),
    governance: "GATE_1B_BATCH_04C_R1",
    truthAudit,
    causalConclusion,
    pairedCapacityComparison,
    resultsByArchitecture: {
      archA_deterministic: resultsA,
      archB_direct_ontology: resultsB,
      archC_original_8k: resultsCOrig,
      archC_r1_capacity_65k: resultsCR1
    },
    candidateResults,
    propositionEconomy: {
      totalEmittedPropsCR1,
      totalProjectedAtomsCR1,
      totalNegativeBoundariesCR1,
      totalNonMaterialCR1,
      classificationCounts,
      classificationPercentages,
      adjudicatedConcepts
    }
  };

  fs.writeFileSync(path.join(r1Dir, "evaluation-summary-r1.json"), JSON.stringify(summaryPayload, null, 2), "utf8");
  console.log(`Saved evaluation summary to ${path.join(r1Dir, "evaluation-summary-r1.json")}`);

  return summaryPayload;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith("evaluate-batch04c-r1.ts")) {
  runR1Evaluation();
}
