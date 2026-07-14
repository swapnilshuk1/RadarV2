import fs from "fs";
import path from "path";
import { extract } from "./scraper/extract/extractor";
import type { JobSnapshot, BenchmarkSuite, BenchmarkTruth, BenchmarkEntry } from "./scraper/types";

// Helper: Normalize strings for Exact matching
const norm = (s: string | null | undefined) => (s || "").toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');

// Set similarity (Jaccard)
function jaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

// Convert an array of BenchmarkValue to a set of normalized strings
const toSet = (arr: any): Set<string> => {
  if (!arr) return new Set();
  if (!Array.isArray(arr)) arr = [arr];
  return new Set(arr.filter(a => a && a.value).map(a => norm(a.value)));
};

interface Metric {
  totalFieldsPresent: number;     // for Recall
  totalFieldsExtracted: number;   // for Precision
  truePositives: number;
  hallucinationsFact: number;     // Type 1
  hallucinationsBool: number;     // Type 2
  hallucinationsRel: number;      // Type 3
  coverageMisses: number;
}

function initMetric(): Metric {
  return { totalFieldsPresent: 0, totalFieldsExtracted: 0, truePositives: 0, hallucinationsFact: 0, hallucinationsBool: 0, hallucinationsRel: 0, coverageMisses: 0 };
}

async function main() {
  const datasetPath = path.join(process.cwd(), "src/data/benchmark/dataset-v1.json");
  if (!fs.existsSync(datasetPath)) {
    console.error("Dataset not found at", datasetPath);
    process.exit(1);
  }

  const dataset: BenchmarkSuite = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  console.log("Loaded Benchmark Suite v" + dataset.version + " (" + dataset.entries.length + " entries)");

  const metrics: Record<string, Metric> = {
    role: initMetric(),
    company: initMetric(),
    location: initMetric(),
    salary: initMetric(),
    technologies: initMetric(),
    remoteType: initMetric()
  };

  let processed = 0;

  for (const entry of dataset.entries) {
    console.log(`Evaluating [${entry.difficulty}] ${entry.metadata.originalCompany}...`);
    
    // Re-create the snapshot structure expected by extract()
    const fakeSnap: JobSnapshot = {
      snapshotSchemaVersion: "1.0",
      scraperVersion: "1.0",
      cardHash: entry.cardHash,
      portal: entry.portal as any,
      title: entry.metadata.originalTitle,
      company: entry.metadata.originalCompany,
      location: entry.truth.location?.value || "",
      keyword: "",
      discoveredAt: new Date().toISOString(),
      searchUrl: "",
      detailUrl: entry.metadata.url,
      card: {
        rawHtml: "",
        rawText: "",
        title: entry.metadata.originalTitle,
        company: entry.metadata.originalCompany,
        location: entry.truth.location?.value || ""
      },
      detail: {
        fetched: true,
        rawText: entry.rawText,
        rawHtml: entry.rawHtml
      },
      telemetry: { cardExtractMs: 0, detailExtractMs: 0, totalMs: 0 }
    };

    // Run current extractor
    const result = await extract(fakeSnap);
    processed++;

    const t = entry.truth;

    // Evaluate Role (Exact)
    if (t.role?.value) metrics.role.totalFieldsPresent++;
    if (result.role) {
      metrics.role.totalFieldsExtracted++;
      if (norm(result.role) === norm(t.role?.value)) metrics.role.truePositives++;
      else if (!t.role?.value) metrics.role.hallucinationsFact++;
    } else if (t.role?.value) {
      metrics.role.coverageMisses++;
    }

    // Evaluate Company (Exact)
    if (t.company?.value) metrics.company.totalFieldsPresent++;
    if (result.company) {
      metrics.company.totalFieldsExtracted++;
      if (norm(result.company) === norm(t.company?.value)) metrics.company.truePositives++;
      else if (!t.company?.value) metrics.company.hallucinationsFact++;
    } else if (t.company?.value) {
      metrics.company.coverageMisses++;
    }

    // Evaluate Location (Exact)
    if (t.location?.value) metrics.location.totalFieldsPresent++;
    if (result.location) {
      metrics.location.totalFieldsExtracted++;
      if (norm(result.location) === norm(t.location?.value)) metrics.location.truePositives++;
      else if (!t.location?.value) metrics.location.hallucinationsFact++;
    } else if (t.location?.value) {
      metrics.location.coverageMisses++;
    }

    // Evaluate Salary (Currently missing in extractor!)
    if (t.salary?.value) {
      metrics.salary.totalFieldsPresent++;
      metrics.salary.coverageMisses++;
    }

    // Evaluate Technologies (Set)
    const tTech = toSet(t.technologies || []);
    const extTechDim = result.dimensions.find(d => d.key === "technologyStack");
    const extTechStr = extTechDim?.jdEvidence.value || "";
    // Extremely rudimentary set extraction from the string for now
    const extTech = new Set(extTechStr.split(',').map(norm).filter(Boolean));
    
    if (tTech.size > 0) metrics.technologies.totalFieldsPresent += tTech.size;
    if (extTech.size > 0) metrics.technologies.totalFieldsExtracted += extTech.size;
    
    // Calculate overlap
    let overlaps = 0;
    for (const tech of extTech) {
      if (tTech.has(tech)) overlaps++;
      else if (tTech.size === 0) metrics.technologies.hallucinationsFact++;
    }
    metrics.technologies.truePositives += overlaps;
    if (tTech.size > overlaps) metrics.technologies.coverageMisses += (tTech.size - overlaps);
  }

  // Dashboard Output
  console.log("\\n\\n==========================================");
  console.log("       RADAR BENCHMARK SUITE v1.0         ");
  console.log("==========================================");
  console.log("Evaluated: " + processed + " jobs\\n");
  
  console.log(
    "Field".padEnd(15) + 
    "Precision".padEnd(12) + 
    "Recall".padEnd(10) + 
    "Coverage".padEnd(10) + 
    "Hallucination"
  );
  console.log("-".repeat(60));

  for (const [field, m] of Object.entries(metrics)) {
    const precision = m.totalFieldsExtracted > 0 ? ((m.truePositives / m.totalFieldsExtracted) * 100).toFixed(1) + "%" : "0.0%";
    const recall = m.totalFieldsPresent > 0 ? ((m.truePositives / m.totalFieldsPresent) * 100).toFixed(1) + "%" : "0.0%";
    const coverage = m.totalFieldsPresent > 0 ? (((m.totalFieldsPresent - m.coverageMisses) / m.totalFieldsPresent) * 100).toFixed(1) + "%" : "0.0%";
    const hal = m.hallucinationsFact + m.hallucinationsBool + m.hallucinationsRel;
    
    console.log(
      field.padEnd(15) + 
      precision.padEnd(12) + 
      recall.padEnd(10) + 
      coverage.padEnd(10) + 
      hal.toString()
    );
  }

  console.log("\\nWorst-Case Report to follow...\\n");
}

main().catch(console.error);
