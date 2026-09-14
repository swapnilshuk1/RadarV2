import * as fs from "node:fs";
import * as path from "node:path";
import {
  normalizeReferenceTruthR2,
  adaptArchitectureAR2,
  adaptArchitectureBR2,
  adaptArchitectureCR2,
  applyHybridStructuralAdmission,
  evaluateDocumentR2,
  DocumentR2EvaluationResult,
  HIGH_RISK_FAMILIES
} from "./evaluator-r2.js";

const root = process.cwd();
const batchDir = path.resolve(root, "audit-reports/gate1b-batch04c");
const r1Dir = path.resolve(root, "audit-reports/gate1b-batch04c-r1");
const r2Dir = path.resolve(root, "audit-reports/gate1b-batch04c-r2");

if (!fs.existsSync(r2Dir)) {
  fs.mkdirSync(r2Dir, { recursive: true });
}

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

interface AggregateMetricsR2 {
  totalFacts: number;
  selectionMatches: number;
  typedMatches: number;
  selectionRecall: number;
  typedRecall: number;
  observedFalseAffirmatives: number;
  emittedOnNegatedReferenceWithoutPolarity: number;
  subjectApplicabilityErrors: number;
  unconditionalFromConditional: number;
  recoveredHighRiskFacts: number;
  missedHighRiskFacts: number;
  couldNotRepresentPolarityHighRiskFacts: number;
  totalAssertionsEmitted: number;
  retainedAtomsCount?: number;
  rejectedAtomsCount?: number;
}

function aggregateResultsR2(results: DocumentR2EvaluationResult[]): AggregateMetricsR2 {
  let totalFacts = 0;
  let selectionMatches = 0;
  let typedMatches = 0;
  let observedFalseAffirmatives = 0;
  let emittedOnNegatedReferenceWithoutPolarity = 0;
  let subjectApplicabilityErrors = 0;
  let unconditionalFromConditional = 0;
  let recoveredHighRiskFacts = 0;
  let missedHighRiskFacts = 0;
  let couldNotRepresentPolarityHighRiskFacts = 0;
  let totalAssertionsEmitted = 0;
  let retainedAtomsCount = 0;
  let rejectedAtomsCount = 0;

  for (const r of results) {
    totalFacts += r.totalReferenceFacts;
    selectionMatches += r.selectionMatches;
    typedMatches += r.typedMatches;
    observedFalseAffirmatives += r.highRiskBreakdown.observedFalseAffirmatives;
    emittedOnNegatedReferenceWithoutPolarity += r.highRiskBreakdown.emittedOnNegatedReferenceWithoutPolarity;
    subjectApplicabilityErrors += r.highRiskBreakdown.subjectApplicabilityErrors;
    unconditionalFromConditional += r.highRiskBreakdown.unconditionalFromConditional;
    recoveredHighRiskFacts += r.highRiskBreakdown.recoveredHighRiskFacts;
    missedHighRiskFacts += r.highRiskBreakdown.missedHighRiskFacts;
    couldNotRepresentPolarityHighRiskFacts += r.highRiskBreakdown.couldNotRepresentPolarityHighRiskFacts;
    totalAssertionsEmitted += r.totalAssertionsEmitted;
    if (r.retainedAtomsCount !== undefined) retainedAtomsCount += r.retainedAtomsCount;
    if (r.rejectedAtomsCount !== undefined) rejectedAtomsCount += r.rejectedAtomsCount;
  }

  return {
    totalFacts,
    selectionMatches,
    typedMatches,
    selectionRecall: totalFacts > 0 ? selectionMatches / totalFacts : 0,
    typedRecall: totalFacts > 0 ? typedMatches / totalFacts : 0,
    observedFalseAffirmatives,
    emittedOnNegatedReferenceWithoutPolarity,
    subjectApplicabilityErrors,
    unconditionalFromConditional,
    recoveredHighRiskFacts,
    missedHighRiskFacts,
    couldNotRepresentPolarityHighRiskFacts,
    totalAssertionsEmitted,
    retainedAtomsCount: retainedAtomsCount > 0 ? retainedAtomsCount : undefined,
    rejectedAtomsCount: rejectedAtomsCount > 0 ? rejectedAtomsCount : undefined
  };
}

async function runR2Evaluation() {
  console.log("=== EXECUTING GATE 1B BATCH 04C-R2 EVALUATION ===");

  const roleDocs = popRaw.filter((d: any) => d.partition !== "CANDIDATE_DOCUMENT");
  console.log(`Evaluating ${roleDocs.length} role documents across 5 architectural configurations...`);

  const resultsA: DocumentR2EvaluationResult[] = [];
  const resultsB: DocumentR2EvaluationResult[] = [];
  const resultsCOrig: DocumentR2EvaluationResult[] = [];
  const resultsCR1: DocumentR2EvaluationResult[] = [];
  const resultsD: DocumentR2EvaluationResult[] = [];

  const archDAdmissions: Record<string, any> = {};

  for (const doc of roleDocs) {
    const docId = doc.id;
    const refDoc = refTruthRaw.documents.find((d: any) => d.documentId === docId);
    if (!refDoc) {
      console.warn(`No reference truth for ${docId}, skipping.`);
      continue;
    }

    const refFacts = normalizeReferenceTruthR2(refDoc);
    const highRiskNegatives = refDoc.highRiskNegatives ?? [];
    const disclaimerSpans = refDoc.disclaimerSpans ?? [];

    const docSeg = (Array.isArray(segPop) ? segPop : segPop.documents).find((d: any) => (d.id === docId || d.documentId === docId));
    const validUnitIds = new Set<string>((docSeg?.units ?? []).map((u: any) => u.spanId));

    // 1. Architecture A (Deterministic V1)
    const fileA = path.join(archADir, `${docId}.json`);
    if (fs.existsSync(fileA)) {
      const jsonA = JSON.parse(fs.readFileSync(fileA, "utf8"));
      const assertionsA = adaptArchitectureAR2(docId, jsonA.v1Output ?? jsonA, docSeg?.units ?? []);
      resultsA.push(evaluateDocumentR2(docId, doc.partition, "ARCH_A", refFacts, highRiskNegatives, disclaimerSpans, assertionsA));
    }

    // 2. Architecture B (Direct Source-ID LLM) - Corrected Adapter
    const fileB = path.join(archBDir, `${docId}.json`);
    if (fs.existsSync(fileB)) {
      const jsonB = JSON.parse(fs.readFileSync(fileB, "utf8"));
      const assertionsB = adaptArchitectureBR2(docId, jsonB);
      resultsB.push(evaluateDocumentR2(docId, doc.partition, "ARCH_B", refFacts, highRiskNegatives, disclaimerSpans, assertionsB));
    }

    // 3. Architecture C (Rich Proposition LLM - 8k Capacity)
    const fileCOrig = path.join(archCOrigDir, `${docId}.json`);
    if (fs.existsSync(fileCOrig)) {
      const jsonC = JSON.parse(fs.readFileSync(fileCOrig, "utf8"));
      const assertionsC = adaptArchitectureCR2(docId, jsonC);
      resultsCOrig.push(evaluateDocumentR2(docId, doc.partition, "ARCH_C_8K", refFacts, highRiskNegatives, disclaimerSpans, assertionsC));
    }

    // 4. Architecture C (Rich Proposition LLM - 65k Capacity)
    const fileCR1 = path.join(archCR1Dir, `${docId}.json`);
    let rawProps65k: any[] = [];
    if (fs.existsSync(fileCR1)) {
      const jsonCR1 = JSON.parse(fs.readFileSync(fileCR1, "utf8"));
      rawProps65k = jsonCR1.propositions ?? [];
      const assertionsCR1 = adaptArchitectureCR2(docId, jsonCR1);
      resultsCR1.push(evaluateDocumentR2(docId, doc.partition, "ARCH_C_65K", refFacts, highRiskNegatives, disclaimerSpans, assertionsCR1));
    }

    // 5. Architecture D (Hybrid Feasibility Engine: Structural Admission on C 65k Propositions)
    if (rawProps65k.length > 0) {
      const hybridRes = applyHybridStructuralAdmission(docId, rawProps65k, validUnitIds);
      archDAdmissions[docId] = {
        totalPropositionsInput: rawProps65k.length,
        retainedAtomsCount: hybridRes.retainedAtomsCount,
        rejectedPropositionsCount: hybridRes.rejectedPropositionsCount,
        rejectionReasons: hybridRes.rejectionReasons
      };
      resultsD.push(evaluateDocumentR2(
        docId,
        doc.partition,
        "ARCH_D_HYBRID",
        refFacts,
        highRiskNegatives,
        disclaimerSpans,
        hybridRes.admittedAssertions,
        hybridRes.retainedAtomsCount,
        hybridRes.rejectedPropositionsCount
      ));
    }
  }

  // Calculate Aggregates for All 21 Documents and Truncated-12 Subset
  const summary = {
    evaluatedAt: new Date().toISOString(),
    evaluationStandard: "GATE_1B_BATCH_04C_R2_AUTHORITATIVE",
    ontologyCheck: {
      canonicalTypesCount: 25,
      r1ClaimOf15Types: "REPORT_TYPO",
      verifiedCanonicalTypesEnum: [
        "ROLE_PURPOSE", "RESPONSIBILITY", "OUTCOME", "SUCCESS_METRIC",
        "HARD_REQUIREMENT", "PREFERRED_REQUIREMENT", "REPORTING_LINE",
        "FOUNDER_CEO_PROXIMITY", "BOARD_EXPOSURE", "PNL_OWNERSHIP",
        "REVENUE_ACCOUNTABILITY", "PROFITABILITY_ACCOUNTABILITY", "BUDGET_SCOPE",
        "DECISION_AUTHORITY", "PEOPLE_LEADERSHIP", "PEOPLE_SCALE",
        "GREENFIELD_BUILD", "TRANSFORMATION", "GEOGRAPHIC_SCOPE",
        "REGULATORY_SCOPE", "PRODUCT_SCOPE", "CUSTOMER_SCOPE",
        "CHANNEL_SCOPE", "COMPANY_CONTEXT", "WORK_CONDITION"
      ]
    },
    aggregatesAll21: {
      archA_deterministic_v1: aggregateResultsR2(resultsA),
      archB_direct_source_id_corrected: aggregateResultsR2(resultsB),
      archC_rich_proposition_8k: aggregateResultsR2(resultsCOrig),
      archC_rich_proposition_65k: aggregateResultsR2(resultsCR1),
      archD_hybrid_feasibility: aggregateResultsR2(resultsD)
    },
    aggregatesTruncated12: {
      archA_deterministic_v1: aggregateResultsR2(resultsA.filter(r => TRUNCATED_12.includes(r.documentId))),
      archB_direct_source_id_corrected: aggregateResultsR2(resultsB.filter(r => TRUNCATED_12.includes(r.documentId))),
      archC_rich_proposition_8k: aggregateResultsR2(resultsCOrig.filter(r => TRUNCATED_12.includes(r.documentId))),
      archC_rich_proposition_65k: aggregateResultsR2(resultsCR1.filter(r => TRUNCATED_12.includes(r.documentId))),
      archD_hybrid_feasibility: aggregateResultsR2(resultsD.filter(r => TRUNCATED_12.includes(r.documentId)))
    },
    hybridAdmissionSummary: {
      totalInputPropositions: Object.values(archDAdmissions).reduce((sum: number, a: any) => sum + a.totalPropositionsInput, 0),
      totalRetainedAtoms: Object.values(archDAdmissions).reduce((sum: number, a: any) => sum + a.retainedAtomsCount, 0),
      totalRejectedPropositions: Object.values(archDAdmissions).reduce((sum: number, a: any) => sum + a.rejectedPropositionsCount, 0),
      perDocumentAdmissions: archDAdmissions
    },
    candidateEvaluationN2: {
      governanceStatus: "EVALUATED_AGAINST_SELECTED_REFERENCES_ONLY",
      retractedPrecisionClaims: [
        "Candidate Proof Precision = 7/39 (RETRACTED)",
        "Candidate Proof Precision = 2/18 (RETRACTED)"
      ],
      candidateState: [
        "DETERMINISTIC_BASELINE_CURRENTLY_LEADS",
        "CANDIDATE_LLM_DIRECT_REJECTED",
        "FINAL_CANDIDATE_ARCHITECTURE_OPEN"
      ],
      findingsSummary: "On N=2, frozen CandidateProofExtractorV1 materially outperforms the 04B direct source-ID candidate contract on selected reference recall, metric retention, and employer binding. Final candidate architecture remains open pending rich candidate semantic contract evaluation."
    }
  };

  fs.writeFileSync(
    path.join(r2Dir, "evaluation-summary-r2.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  console.log("=== R2 EVALUATION COMPLETE ===");
  console.log("Summary saved to audit-reports/gate1b-batch04c-r2/evaluation-summary-r2.json");
  console.log(JSON.stringify(summary.aggregatesAll21, null, 2));
}

runR2Evaluation().catch(err => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
