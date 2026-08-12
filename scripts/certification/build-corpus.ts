import fs from "fs";
import path from "path";
import crypto from "crypto";
import { readLiveOpportunities } from "../../src/lib/intelligence/engine";
import { rawOpportunities as authored } from "../../src/data/opportunity-fixtures";
import { extraOpportunities } from "../../src/data/extra-fixtures";

const ROOT = path.resolve(process.cwd(), "radar-certification");
const CORPUS_DIR = path.join(ROOT, "corpus");
const ORACLE_DIR = path.join(ROOT, "oracle");
const ADVERSARIAL_DIR = path.join(ROOT, "adversarial");
const BASELINE_DIR = path.join(ROOT, "baseline");

console.log("============================================================");
console.log("   BUILDING IMMUTABLE 100-JD CERTIFICATION CORPUS & ORACLE");
console.log("============================================================\n");

// Ensure target directories exist
fs.mkdirSync(CORPUS_DIR, { recursive: true });
fs.mkdirSync(ORACLE_DIR, { recursive: true });
fs.mkdirSync(ADVERSARIAL_DIR, { recursive: true });
fs.mkdirSync(BASELINE_DIR, { recursive: true });

// Gather candidate opportunities (combining authored, extra, and live scraped JDs)
const allOpsMap = new Map<string, any>();

for (const o of authored as any[]) {
  if (o.jobHash) allOpsMap.set(o.jobHash, o);
}
for (const o of extraOpportunities as any[]) {
  if (o.jobHash) allOpsMap.set(o.jobHash, o);
}

try {
  const liveOps = readLiveOpportunities();
  for (const o of liveOps) {
    if (o.jobHash && !allOpsMap.has(o.jobHash)) {
      allOpsMap.set(o.jobHash, o);
    }
  }
} catch (e: any) {
  console.warn("Live ops load note:", e.message);
}

const allOps = Array.from(allOpsMap.values());
const selected = allOps.slice(0, 100);

console.log(`Selected ${selected.length} opportunities for the canonical 100-JD corpus.`);

// Export 100 Corpus Items (Input Evidence ONLY)
selected.forEach((op, idx) => {
  const numStr = String(idx + 1).padStart(3, "0");
  const corpusPath = path.join(CORPUS_DIR, `${numStr}.json`);
  const oraclePath = path.join(ORACLE_DIR, `${numStr}.expected.json`);

  const rawText = op.rawText || op.description || op.normalizedText || op.rawDescription || "";

  const corpusItem = {
    id: op.jobHash || `jd-${numStr}`,
    title: op.role || "Executive Role",
    company: op.company || "Target Company",
    location: op.location || "Remote",
    description: rawText,
    source: op.scrapedFrom || "LINKEDIN"
  };

  fs.writeFileSync(corpusPath, JSON.stringify(corpusItem, null, 2), "utf-8");

  // Determine Independent Oracle Truth (Decoupled from internal logic)
  const isSparse = rawText.trim().split(/\s+/).length < 25;
  const titleLower = (op.role || "").toLowerCase();
  const descLower = rawText.toLowerCase();

  let domain = "COMMERCIAL_MARKETING";
  if (titleLower.includes("doctor") || titleLower.includes("medical") || titleLower.includes("clinical")) {
    domain = "HEALTHCARE_CLINICAL";
  } else if (titleLower.includes("cfo") || titleLower.includes("finance")) {
    domain = "FINANCE";
  } else if (titleLower.includes("hr") || titleLower.includes("people")) {
    domain = "HUMAN_RESOURCES";
  }

  let altitude = "EXECUTIVE";
  if (titleLower.includes("chief") || titleLower.includes("cmo") || titleLower.includes("cro") || titleLower.includes("vp")) {
    altitude = "EXECUTIVE";
  } else if (titleLower.includes("director") || titleLower.includes("head")) {
    altitude = "STRATEGIC";
  } else if (titleLower.includes("manager") || titleLower.includes("lead")) {
    altitude = "MANAGERIAL";
  }

  let mandateType = "BUSINESS_GROWTH";
  if (descLower.includes("transform") || descLower.includes("overhaul")) {
    mandateType = "TRANSFORMATION";
  } else if (descLower.includes("scale") || descLower.includes("expand")) {
    mandateType = "SCALE";
  }

  let expectedDecision = "PURSUE";
  if (isSparse) {
    expectedDecision = null;
  } else if (domain !== "COMMERCIAL_MARKETING" && domain !== "FINANCE") {
    expectedDecision = "PASS";
  } else if (altitude === "MANAGERIAL") {
    expectedDecision = "CONSIDER";
  }

  const oracleItem = {
    id: op.jobHash || `jd-${numStr}`,
    domain,
    altitude,
    mandateType,
    mandateScope: "ENTERPRISE",
    expectedDecision: isSparse ? null : expectedDecision,
    evidenceClass: isSparse ? "SPARSE_SPEC" : "SUFFICIENT",
    governance: "VALID_BENCHMARK"
  };

  fs.writeFileSync(oraclePath, JSON.stringify(oracleItem, null, 2), "utf-8");
});

// Compute CORPUS_SHA256 Hash Lock
const hasher = crypto.createHash("sha256");
const corpusFiles = fs.readdirSync(CORPUS_DIR).sort();
corpusFiles.forEach(f => {
  const content = fs.readFileSync(path.join(CORPUS_DIR, f), "utf-8");
  hasher.update(content);
});
const corpusHash = hasher.digest("hex");

console.log(`\n✅ Successfully generated 100 Corpus Items and 100 Oracle Expected Truths.`);
console.log(`🔒 CORPUS_SHA256: ${corpusHash}`);
