import fs from "fs";
import path from "path";
import { commercialExtractorInstance } from "./scraper/extract/dimensions/commercialAccountability";
import { mandateExtractorInstance } from "./scraper/extract/dimensions/mandate";
import { reportingLineExtractorInstance } from "./scraper/extract/dimensions/reportingLine";
import { technologyExtractorInstance } from "./scraper/extract/dimensions/technologyStack";
import type { DimensionExtractor, RawExtraction, NormalizedFact } from "../src/lib/recommendation/DimensionExtractor";

interface GoldCase {
  testCategory: string;
  text: string;
  expectedCanonical?: string;
  expectedPrimary?: string;
  expectedProducts?: string[];
  expectedCategories?: string[];
}

function runAcceptanceTestsFor(
  name: string,
  extractor: DimensionExtractor<any>,
  goldFile: string,
  noneVal: string
): boolean {
  const goldPath = path.resolve(process.cwd(), "tests", "fixtures", goldFile);
  if (!fs.existsSync(goldPath)) {
    console.error(`Gold cases file not found: ${goldPath}`);
    return false;
  }

  const cases = JSON.parse(fs.readFileSync(goldPath, "utf8")) as GoldCase[];
  console.log(`\nRunning acceptance tests for [${name}] over ${cases.length} cases...`);

  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;
  let ambiguousMatchesCount = 0;

  const latencies: number[] = [];
  const categoryDetails: Record<string, { total: number; passed: number }> = {};

  for (const c of cases) {
    if (!categoryDetails[c.testCategory]) {
      categoryDetails[c.testCategory] = { total: 0, passed: 0 };
    }
    categoryDetails[c.testCategory].total++;

    const start = performance.now();
    const raw = extractor.extract({ title: "", snippet: "", detailText: c.text });
    const norm = raw ? extractor.normalize(raw) : null;
    const end = performance.now();
    latencies.push(end - start);

    if (raw && raw.ambiguity) {
      ambiguousMatchesCount++;
    }

    let passed = false;

    // Custom check for Technology Stack
    if (name === "Technology Stack") {
      const actualProducts = norm ? (norm.canonicalValue.products as string[]).sort() : [];
      const expectedProducts = c.expectedProducts ? c.expectedProducts.sort() : [];
      
      const isExpectedNone = expectedProducts.length === 0;
      const isActualNone = actualProducts.length === 0;

      if (!isExpectedNone) {
        // Match lists
        const match = actualProducts.length === expectedProducts.length && 
                      actualProducts.every((p, i) => p === expectedProducts[i]);
        if (match) {
          truePositives++;
          passed = true;
        } else {
          falseNegatives++;
        }
      } else {
        if (isActualNone) {
          trueNegatives++;
          passed = true;
        } else {
          falsePositives++;
        }
      }
    } else {
      const actualCanonical = norm ? String(norm.canonicalValue) : noneVal;
      const targetExpected = c.expectedPrimary ?? c.expectedCanonical;
      const isExpectedNone = targetExpected === "NONE" || !targetExpected;
      const isActualNone = actualCanonical === noneVal;

      if (!isExpectedNone) {
        if (actualCanonical === targetExpected) {
          truePositives++;
          passed = true;
        } else {
          falseNegatives++;
        }
      } else {
        if (isActualNone) {
          trueNegatives++;
          passed = true;
        } else {
          falsePositives++;
        }
      }
    }

    if (passed) {
      categoryDetails[c.testCategory].passed++;
    } else {
      console.log(`  ❌ FAIL [${c.testCategory}]: Text: "${c.text.substring(0, 60)}..."`);
      if (name === "Technology Stack") {
        console.log(`     Expected: [${c.expectedProducts?.join(", ")}] | Actual: [${norm ? norm.canonicalValue.products.join(", ") : ""}]`);
      } else {
        console.log(`     Expected: ${c.expectedPrimary ?? c.expectedCanonical} | Actual: ${norm ? norm.canonicalValue : noneVal}`);
      }
    }
  }

  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 1.0;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 1.0;
  
  const fpr = trueNegatives + falsePositives > 0 ? falsePositives / (trueNegatives + falsePositives) : 0.0;
  const fnr = truePositives + falseNegatives > 0 ? falseNegatives / (truePositives + falseNegatives) : 0.0;
  const ambiguityRate = cases.length > 0 ? ambiguousMatchesCount / cases.length : 0.0;

  latencies.sort((a, b) => a - b);
  const minLatency = latencies[0];
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)];
  const maxLatency = latencies[latencies.length - 1];

  console.log("------------------------------------------------------------");
  console.log(`  Precision:           ${(precision * 100).toFixed(1)}%  (Threshold: >95.0%)`);
  console.log(`  Recall:              ${(recall * 100).toFixed(1)}%  (Threshold: >80.0%)`);
  console.log(`  False Positive Rate: ${(fpr * 100).toFixed(1)}%`);
  console.log(`  False Negative Rate: ${(fnr * 100).toFixed(1)}%`);
  console.log(`  Ambiguity Rate:      ${(ambiguityRate * 100).toFixed(1)}% (${ambiguousMatchesCount} ambiguous)`);
  console.log("------------------------------------------------------------");
  console.log(`  Latency -> Min: ${minLatency.toFixed(3)}ms | Avg: ${avgLatency.toFixed(3)}ms | P95: ${p95Latency.toFixed(3)}ms | Max: ${maxLatency.toFixed(3)}ms`);
  console.log("  Category Breakdown:");
  for (const [cat, stats] of Object.entries(categoryDetails)) {
    console.log(`    - ${cat.padEnd(20)}: ${stats.passed}/${stats.total} passed (${((stats.passed/stats.total)*100).toFixed(0)}%)`);
  }
  console.log("------------------------------------------------------------");

  const passes = precision >= 0.95 && recall >= 0.80;
  if (passes) {
    console.log(`✓ ${name} Extractor = Certified (PASS)`);
  } else {
    console.warn(`⚠ WARNING: ${name} Extractor = Uncertified (FAIL)`);
  }
  return passes;
}

function main() {
  console.log("============================================================");
  console.log("              RADAR ACCEPTANCE TEST SUITE");
  console.log("============================================================");

  const commPass = runAcceptanceTestsFor(
    "Commercial Accountability",
    commercialExtractorInstance,
    "gold-commercial.json",
    "NONE"
  );

  const mandatePass = runAcceptanceTestsFor(
    "Mandate / Directives",
    mandateExtractorInstance,
    "gold-mandate.json",
    "NONE"
  );

  const reportingPass = runAcceptanceTestsFor(
    "Reporting Line Hierarchy",
    reportingLineExtractorInstance,
    "gold-reporting.json",
    "NONE"
  );

  const techPass = runAcceptanceTestsFor(
    "Technology Stack",
    technologyExtractorInstance,
    "gold-tech.json",
    "NONE"
  );

  console.log("\n============================================================");
  console.log("              FINAL CERTIFICATION REPORT");
  console.log("============================================================");
  console.log(`  Commercial Accountability : ${commPass ? "✅ CERTIFIED" : "❌ UNCERTIFIED"}`);
  console.log(`  Mandate / Directives      : ${mandatePass ? "✅ CERTIFIED" : "❌ UNCERTIFIED"}`);
  console.log(`  Reporting Line Hierarchy  : ${reportingPass ? "✅ CERTIFIED" : "❌ UNCERTIFIED"}`);
  console.log(`  Technology Stack          : ${techPass ? "✅ CERTIFIED" : "❌ UNCERTIFIED"}`);
  console.log("============================================================\n");

  const allPass = commPass && mandatePass && reportingPass && techPass;
  process.exit(allPass ? 0 : 1);
}

main();
