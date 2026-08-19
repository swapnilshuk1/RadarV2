import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../../src/data/candidate-profile";
import { runEngine, invalidateEngineCache, injectFixtureRecords, clearFixtureRecords } from "../../src/lib/intelligence/engine";
import { present } from "../../src/lib/intelligence/present";
import { evaluateContractA, evaluateContractC, evaluateContractE, type InvariantFailure } from "./invariants";
import { runAdversarialMutations } from "./mutations";

const ROOT = path.resolve(process.cwd(), "radar-certification");
const CORPUS_DIR = path.join(ROOT, "corpus");
const ORACLE_DIR = path.join(ROOT, "oracle");
const BASELINE_PATH = path.join(ROOT, "baseline", "latest.json");

console.log("============================================================");
console.log("                RADAR v2 CERTIFICATION HARNESS              ");
console.log("============================================================\n");

// 1. Calculate Corpus Hash Lock
const corpusFiles = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith(".json")).sort();
const hasher = crypto.createHash("sha256");

corpusFiles.forEach(f => {
  const content = fs.readFileSync(path.join(CORPUS_DIR, f), "utf-8");
  hasher.update(content);
});
const corpusHash = hasher.digest("hex");

console.log(`Corpus                : ${corpusFiles.length} JDs`);
console.log(`Corpus SHA-256        : ${corpusHash.slice(0, 16)}...`);

// 2. Load Corpus & Oracle Pairs
const corpusItems: any[] = [];
const oracleItems: any[] = [];

corpusFiles.forEach(f => {
  const cPath = path.join(CORPUS_DIR, f);
  const oPath = path.join(ORACLE_DIR, f.replace(".json", ".expected.json"));
  
  const cItem = JSON.parse(fs.readFileSync(cPath, "utf-8"));
  let oItem: any = {};
  if (fs.existsSync(oPath)) {
    oItem = JSON.parse(fs.readFileSync(oPath, "utf-8"));
  }

  corpusItems.push(cItem);
  oracleItems.push(oItem);
});

// 3. Inject Fixtures and Run Engine
const oppSources = corpusItems.map(c => ({
  jobHash: c.id,
  role: c.title,
  company: c.company,
  location: c.location,
  scrapedFrom: c.source,
  rawText: c.description,
  provenance: "fixture",
  dimensions: []
}));

clearFixtureRecords();
injectFixtureRecords(oppSources as any);

const candidateBuilder = new CandidateProjectionBuilderImpl();
const candProj = candidateBuilder.fromProfile(candidateProfile as any);

const { records, presented } = runEngine(candProj, 0);

// 4. Contract Invariant Evaluations
const contractAFailures: InvariantFailure[] = [];
const contractCFailures: InvariantFailure[] = [];
const contractEFailures: InvariantFailure[] = [];

records.forEach(record => {
  const p = presented.find(x => x.opportunity.jobHash === record.jobHash);
  contractAFailures.push(...evaluateContractA(record, p));
  contractCFailures.push(...evaluateContractC(record));
  if (p) {
    contractEFailures.push(...evaluateContractE(p));
  }
});

// 5. First Divergence & Confusion Matrix Calculations
export type FirstDivergence = "EVIDENCE" | "DOMAIN" | "ALTITUDE" | "MANDATE_TYPE" | "MANDATE_SCOPE" | "POLICY" | "NONE";

const divergenceCounts: Record<FirstDivergence, number> = {
  EVIDENCE: 0,
  DOMAIN: 0,
  ALTITUDE: 0,
  MANDATE_TYPE: 0,
  MANDATE_SCOPE: 0,
  POLICY: 0,
  NONE: 0
};

// 4x4 Confusion Matrix (RADAR vs Oracle)
type DecisionClass = "PURSUE" | "CONSIDER" | "PASS" | "SPARSE";
const confusionMatrix: Record<DecisionClass, Record<DecisionClass, number>> = {
  PURSUE: { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE: 0 },
  CONSIDER: { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE: 0 },
  PASS: { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE: 0 },
  SPARSE: { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE: 0 }
};

let agreedCount = 0;
let evaluatedCount = 0;
let sparseCount = 0;
let nonEvaluableCount = 0;

records.forEach(r => {
  const o = oracleItems.find(x => x.id === r.jobHash) || {};
  
  if (r.verb === "SPARSE_SPEC") sparseCount++;
  else if (r.verb === "NOT_EVALUABLE") nonEvaluableCount++;
  else evaluatedCount++;

  // Determine First Divergence
  if (r.verb === "SPARSE_SPEC" || o.evidenceClass === "SPARSE_SPEC") {
    divergenceCounts.EVIDENCE++;
  } else if (r.verb === o.expectedDecision) {
    divergenceCounts.NONE++;
    agreedCount++;
  } else if (r.vetoed) {
    divergenceCounts.DOMAIN++;
  } else {
    divergenceCounts.POLICY++;
  }

  // Map to Confusion Matrix
  const radarClass: DecisionClass = r.verb === "SPARSE_SPEC" ? "SPARSE" : (r.verb as any) || "PASS";
  const oracleClass: DecisionClass = !o.expectedDecision ? "SPARSE" : (o.expectedDecision as any) || "PASS";

  if (confusionMatrix[radarClass] && confusionMatrix[radarClass][oracleClass] !== undefined) {
    confusionMatrix[radarClass][oracleClass]++;
  }
});

// 6. Adversarial Mutations Evaluation
const mutationResults = runAdversarialMutations();
const mutationsPassed = mutationResults.filter(m => m.passed).length;

// 7. Determinism Test Replay (10 consecutive runs)
let determinismPassed = true;
const firstRunHashes = records.map(r => `${r.jobHash}:${r.verb}:${r.rawScore}:${r.priority}`).join("|");

for (let replay = 0; replay < 10; replay++) {
  invalidateEngineCache();
  const replayRes = runEngine(candProj, 0);
  const replayHashes = replayRes.records.map(r => `${r.jobHash}:${r.verb}:${r.rawScore}:${r.priority}`).join("|");
  if (replayHashes !== firstRunHashes) {
    determinismPassed = false;
    break;
  }
}

// 8. Print Unified Certification Report
console.log("\n============================================================");
console.log("                     CERTIFICATION REPORT                   ");
console.log("============================================================");

console.log("\nINTELLIGENCE CONTRACTS");
console.log(`  Evaluated JDs          : ${evaluatedCount}`);
console.log(`  Sparse Spec JDs        : ${sparseCount}`);
console.log(`  Non-Evaluable JDs      : ${nonEvaluableCount}`);
console.log(`  Final Decision Agreement: ${((agreedCount / Math.max(1, evaluatedCount)) * 100).toFixed(1)}%`);

console.log("\nFIRST DIVERGENCE DIAGNOSTIC");
console.log(`  Evidence               : ${divergenceCounts.EVIDENCE}`);
console.log(`  Domain                 : ${divergenceCounts.DOMAIN}`);
console.log(`  Altitude               : ${divergenceCounts.ALTITUDE}`);
console.log(`  Mandate Type           : ${divergenceCounts.MANDATE_TYPE}`);
console.log(`  Mandate Scope          : ${divergenceCounts.MANDATE_SCOPE}`);
console.log(`  Policy                 : ${divergenceCounts.POLICY}`);
console.log(`  None (Full Agreement)  : ${divergenceCounts.NONE}`);

console.log("\n4x4 DECISION CONFUSION MATRIX (RADAR \\ Oracle)");
console.log("           PURSUE  CONSIDER  PASS  SPARSE");
console.log(`  PURSUE     ${String(confusionMatrix.PURSUE.PURSUE).padStart(4)}     ${String(confusionMatrix.PURSUE.CONSIDER).padStart(4)}   ${String(confusionMatrix.PURSUE.PASS).padStart(4)}    ${String(confusionMatrix.PURSUE.SPARSE).padStart(4)}`);
console.log(`  CONSIDER   ${String(confusionMatrix.CONSIDER.PURSUE).padStart(4)}     ${String(confusionMatrix.CONSIDER.CONSIDER).padStart(4)}   ${String(confusionMatrix.CONSIDER.PASS).padStart(4)}    ${String(confusionMatrix.CONSIDER.SPARSE).padStart(4)}`);
console.log(`  PASS       ${String(confusionMatrix.PASS.PURSUE).padStart(4)}     ${String(confusionMatrix.PASS.CONSIDER).padStart(4)}   ${String(confusionMatrix.PASS.PASS).padStart(4)}    ${String(confusionMatrix.PASS.SPARSE).padStart(4)}`);
console.log(`  SPARSE     ${String(confusionMatrix.SPARSE.PURSUE).padStart(4)}     ${String(confusionMatrix.SPARSE.CONSIDER).padStart(4)}   ${String(confusionMatrix.SPARSE.PASS).padStart(4)}    ${String(confusionMatrix.SPARSE.SPARSE).padStart(4)}`);

console.log("\nINVARIANTS & HARNESS CHECKS");
console.log(`  Contract A (Evidence)  : ${contractAFailures.length === 0 ? "✅ PASS" : `❌ FAIL (${contractAFailures.length})`}`);
console.log(`  Contract C (Policy)    : ${contractCFailures.length === 0 ? "✅ PASS" : `❌ FAIL (${contractCFailures.length})`}`);
console.log(`  Contract E (UI View)   : ${contractEFailures.length === 0 ? "✅ PASS" : `❌ FAIL (${contractEFailures.length})`}`);
console.log(`  Adversarial Mutations  : ${mutationsPassed}/12 ${mutationsPassed === 12 ? "✅ PASS" : "❌ FAIL"}`);
console.log(`  Determinism Replay     : ${determinismPassed ? "10/10 ✅ PASS" : "❌ FAIL"}`);

const allPassed = 
  contractAFailures.length === 0 && 
  contractCFailures.length === 0 && 
  contractEFailures.length === 0 && 
  mutationsPassed === 12 && 
  determinismPassed;

console.log("\n============================================================");
console.log(`FINAL CERTIFICATION STATUS: ${allPassed ? "✅ CERTIFIED (PASS)" : "❌ FAILED"}`);
console.log("============================================================\n");

// Update baseline ledger
const baselineReport = {
  certifiedAt: new Date().toISOString(),
  corpusHash,
  evaluatedCount,
  sparseCount,
  agreedCount,
  agreedPercentage: ((agreedCount / Math.max(1, evaluatedCount)) * 100).toFixed(1),
  divergenceCounts,
  contractAFailures: contractAFailures.length,
  contractCFailures: contractCFailures.length,
  contractEFailures: contractEFailures.length,
  mutationsPassed,
  determinismPassed,
  status: allPassed ? "PASS" : "FAIL"
};

fs.writeFileSync(BASELINE_PATH, JSON.stringify(baselineReport, null, 2), "utf-8");

clearFixtureRecords();

if (!allPassed) {
  process.exit(1);
}
