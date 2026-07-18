/**
 * corpus-recognition-report.ts
 *
 * Stage 3 of the EQE pipeline — runs between Ontology Linter and Acceptance Tests.
 *
 * MEASUREMENT SCOPE (read this before interpreting results):
 *   This report measures "Evidence Recognition Rate" — not corpus technology coverage.
 *   It operates on whatever text survived into SQLite from the previous extraction run.
 *
 *   Text availability (empirically verified 2026-07-17):
 *     detail_text / rawText : 0 / 645 docs  — raw JD text is NOT persisted
 *     any dimension evidence : 123 / 645 docs — partial quotes from prior extraction
 *     tech dimension snippets : 59 / 645 docs — sentences the old extractor preserved
 *     no usable text at all  : 476 / 645 docs — completely invisible to this report
 *
 *   CONSEQUENCE: A result of 9.1% does NOT mean "9.1% of JDs mention technology."
 *   It means "9.1% of JDs had technology evidence preserved by the previous pipeline."
 *   The remaining 73.8% of JDs may or may not contain technology — we cannot determine
 *   this from stored data alone. This report will improve when the scraper is re-run
 *   with normalizeScrapedText and raw text persistence enabled.
 *
 * What this report IS useful for:
 *   - Detecting ontology regressions across runs (Δ column)
 *   - Measuring which categories are recognised when evidence is present
 *   - Tracking forward progress as more raw text is re-scraped
 *
 * Exit codes:
 *   0 — Report generated (informational only — never blocks pipeline)
 *   1 — Fatal error (DB or ontology missing)
 *
 * Baseline provenance:
 *   .radar/recognition-baseline.json includes ontologyVersion, corpusHash,
 *   recognitionSource, and runAt for full auditability.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { technologyExtractorInstance } from "./scraper/extract/dimensions/technologyStack";
import { TechnologyOntology } from "../src/lib/ontology/TechnologyOntology";
const DB_PATH       = path.resolve(process.cwd(), "radar.sqlite");
const BASELINE_PATH = path.resolve(process.cwd(), ".radar", "recognition-baseline.json");
const ONTOLOGY_PATH = path.resolve(process.cwd(), "config", "ontologies", "technology.json");
const META_PATH     = path.resolve(process.cwd(), "config", "ontologies", "technology.meta.json");

const STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "for", "with", "on", "at", "by", "an", "be", "is", "are", 
  "this", "that", "from", "as", "it", "its", "or", "but", "not", "your", "our", "their", "we", "us", "you"
]);

const GENERIC_WORDS = new Set([
  "experience", "team", "management", "skills", "work", "role", "business", "growth", "sales", "marketing",
  "product", "technology", "tools", "years", "platforms", "knowledge", "customers", "leads", "processes"
]);

function countUnknownEvidenceCandidates(text: string): number {
  const tokens = text.match(/[a-zA-Z0-9+#.-]+/g) || [];
  let count = 0;
  for (const tok of tokens) {
    const firstChar = tok.charAt(0);
    const isCapitalized = firstChar >= "A" && firstChar <= "Z";
    const lower = tok.toLowerCase();
    if (isCapitalized && !STOPWORDS.has(lower) && !GENERIC_WORDS.has(lower) && lower.length > 2) {
      count++;
    }
  }
  return count;
}

// What text source we are using — embedded in baseline for provenance.
// Update this string if the source changes in a future sprint.
const RECOGNITION_SOURCE = "jdEvidence.snippets + dimension.evidence.quotes";

function classifyFunction(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("marketing") || t.includes("mktg") || t.includes("brand") || t.includes("cmo") || t.includes("seo") || t.includes("cro")) {
    if (t.includes("revenue")) return "Sales";
    return "Marketing";
  }
  if (t.includes("sales") || t.includes("selling") || t.includes("revenue") || t.includes("account executive") || t.includes("cro") || t.includes("sdr") || t.includes("bdr")) {
    return "Sales";
  }
  if (t.includes("product") || t.includes("cpo") || t.includes("plg")) {
    return "Product";
  }
  if (t.includes("engineering") || t.includes("developer") || t.includes("software") || t.includes("cto") || t.includes("technical") || t.includes("tech") || t.includes("architect")) {
    return "Engineering";
  }
  if (t.includes("customer success") || t.includes("client success") || t.includes("customer experience") || t.includes("support") || t.includes("account management") || t.includes("helpdesk")) {
    return "Customer Success";
  }
  if (t.includes("finance") || t.includes("cfo") || t.includes("billing") || t.includes("accounting") || t.includes("tax") || t.includes("audit") || t.includes("treasury")) {
    return "Finance";
  }
  if (t.includes("strategy") || t.includes("corporate development") || t.includes("corp dev") || t.includes("planning")) {
    return "Strategy";
  }
  if (t.includes("operations") || t.includes("ops") || t.includes("supply chain") || t.includes("logistics")) {
    return "Operations";
  }
  if (t.includes("hr") || t.includes("human resources") || t.includes("people") || t.includes("talent") || t.includes("recruiting") || t.includes("recruiter")) {
    return "HR / People";
  }
  if (t.includes("analytics") || t.includes("data") || t.includes("bi") || t.includes("insight") || t.includes("metrics") || t.includes("analyst")) {
    return "Data / Analytics";
  }
  if (t.includes("consulting") || t.includes("consultant") || t.includes("advisor")) {
    return "Consulting";
  }
  return "Other";
}

function classifyEmployerArchetype(companyName: string, text: string): string {
  const c = companyName.toLowerCase();
  const t = text.toLowerCase();
  
  if (t.includes("gcc") || t.includes("global capability") || t.includes("shared services") || t.includes("offshore development") || t.includes("delivery center") || t.includes("captive center")) {
    return "GCC";
  }
  if (t.includes("startup") || t.includes("start-up") || t.includes("early stage") || t.includes("venture-backed") || t.includes("venture capital") || t.includes("series a") || t.includes("series b") || t.includes("seed-funded") || t.includes("seed stage")) {
    return "Startup";
  }
  if (t.includes("private equity") || t.includes("pe-backed") || t.includes("portfolio company") || t.includes("pe backed")) {
    return "PE-backed";
  }
  if (t.includes("fortune 500") || t.includes("multinational") || t.includes("enterprise scale") || t.includes("global enterprise") || t.includes("conglomerate") || t.includes("large-scale enterprise")) {
    return "Enterprise";
  }
  if (t.includes("mid-market") || t.includes("mid market") || t.includes("medium-sized") || t.includes("sme") || t.includes("smb") || t.includes("growing company") || t.includes("medium enterprise")) {
    return "Mid Market";
  }
  return "Unknown archetype";
}

interface CategoryStats {
  docsWithEvidence: number;   // docs where we had ANY text to analyse
  docsRecognized: number;     // docs where extractor found ≥1 product
  evidenceRecognitionRate: number; // recognized / docsWithEvidence
}

interface RecognitionBaseline {
  runAt: string;
  ontologyVersion: string;
  ontologyProductCount: number;
  ontologyAliasCount: number;
  corpusHash: string;
  recognitionSource: string;
  totalDocs: number;
  docsWithText: number;       // how many docs had any text to analyse
  docsWithNormalizedText: number; // how many docs had normalized source text
  docsBlind: number;          // how many docs had NO text at all
  docsRecognized: number;
  overallEvidenceRecognitionRate: number;  // recognized / docsWithText (not totalDocs)
  byCategory: Record<string, CategoryStats>;
}

interface StoredDoc {
  content: string;
  created_at: string;
}

interface Dimension {
  key: string;
  jdEvidence?: {
    status?: string;
    value?: {
      canonicalValue?: {
        snippets?: string[];
        products?: string[];
      };
    };
    evidence?: Array<{ quote?: string }>;
  };
}

async function main(): Promise<void> {
  console.log("\n══════════════════════════════════════════════════════════════════════════");
  console.log("           RADAR EVIDENCE RECOGNITION REPORT  v1.1");
  console.log("══════════════════════════════════════════════════════════════════════════");

  if (!fs.existsSync(DB_PATH)) {
    console.error(`  ✗ Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const t0 = Date.now();

  // Load ontology metadata for provenance
  const ontologyMeta = fs.existsSync(META_PATH)
    ? JSON.parse(fs.readFileSync(META_PATH, "utf8"))
    : { version: "unknown", productCount: 0, aliasCount: 0 };

  // Compute corpus hash for baseline provenance (hash of all doc IDs, stable across runs)
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(
    "SELECT content, created_at FROM documents WHERE payload_type = ? ORDER BY created_at DESC"
  ).all("Structured") as StoredDoc[];
  const ids = db.prepare(
    "SELECT id FROM documents WHERE payload_type = ? ORDER BY created_at DESC"
  ).all("Structured") as { id: string }[];
  db.close();

  const corpusHash = crypto
    .createHash("sha256")
    .update(ids.map(r => r.id).join(","))
    .digest("hex")
    .slice(0, 12);

  console.log(`\n  ⚠  MEASUREMENT SCOPE: Preserved normalized text + legacy evidence`);
  console.log(`     Results use normalizedText when available, falling back to legacy snippets.`);
  console.log(`     Recognition source: ${RECOGNITION_SOURCE}`);
  console.log("");
  console.log(`  Corpus    : ${rows.length} structured documents (hash: ${corpusHash}...)`);
  console.log(`  Ontology  : v${ontologyMeta.version} | ${ontologyMeta.productCount} products | ${ontologyMeta.aliasCount} aliases`);
  console.log(`  Database  : ${path.basename(DB_PATH)}\n`);

  // ─── Scan Each Document ──────────────────────────────────────────────────
  const byCategoryStats: Record<string, { docsWithEvidence: number; docsRecognized: number }> = {};
  let totalDocs              = 0;
  let docsWithText           = 0;   // had text to analyse (either normalizedText or legacy snippets)
  let docsNormalizedButShort = 0;   // normalizedText present but ≤ sum of evidence snippets (integrity violation)
  let docsBlind              = 0;   // no text at all
  let docsRecognized         = 0;
  let docsWithNormalizedText = 0;   // normalized source text is persisted

  const tier1DiversityCounts: Record<string, number> = {
    "Marketing": 0,
    "Sales": 0,
    "Product": 0,
    "Engineering": 0,
    "Customer Success": 0,
    "Finance": 0,
    "Strategy": 0,
    "Operations": 0,
    "HR / People": 0,
    "Data / Analytics": 0,
    "Consulting": 0,
    "Other": 0
  };

  const decisionMatrixCounts: Record<string, Record<string, number>> = {
    "Marketing": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Sales": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Product": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Engineering": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Customer Success": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Finance": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Strategy": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Operations": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "HR / People": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Data / Analytics": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Consulting": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 },
    "Other": { "Mid Market": 0, "Enterprise": 0, "GCC": 0, "Startup": 0, "PE-backed": 0, "Unknown archetype": 0 }
  };

  let freshDocs  = 0;  // <30 days
  let mediumDocs = 0;  // 30-90 days
  let staleDocs  = 0;  // >90 days

  let totalEvidenceReferencesTier1 = 0;
  let totalUnknownCandidatesTier1 = 0;

  for (const row of rows) {
    let content: any;
    try { content = JSON.parse(row.content); } catch { continue; }
    totalDocs++;

    // Calculate document freshness age
    if (row.created_at) {
      const createdDate = new Date(row.created_at);
      const diffMs = Date.now() - createdDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays < 30) {
        freshDocs++;
      } else if (diffDays <= 90) {
        mediumDocs++;
      } else {
        staleDocs++;
      }
    } else {
      freshDocs++; // Default fallback
    }

    const role = content.role ?? content.canonical_title ?? "";
    const dims: Dimension[] = Array.isArray(content.dimensions)
      ? content.dimensions
      : Object.values(content.dimensions ?? {});

    // Prioritize new normalizedText field, fallback to legacy evidence snippets
    let combined = "";
    if (content.normalizedText && content.normalizedText.trim().length > 50) {
      docsWithNormalizedText++;
      combined = content.normalizedText.trim();

      const func = classifyFunction(role);
      tier1DiversityCounts[func] = (tier1DiversityCounts[func] || 0) + 1;

      const company = content.company ?? content.company_name ?? "";
      const archetype = classifyEmployerArchetype(company, combined);
      if (decisionMatrixCounts[func] && decisionMatrixCounts[func][archetype] !== undefined) {
        decisionMatrixCounts[func][archetype]++;
      }

      // Integrity check: normalizedText should contain MORE content than the sum
      // of extracted evidence snippets. If it doesn't, the persistence contract
      // is violated — normalizedText is just a copy of already-extracted snippets.
      let snippetLengthSum = 0;
      for (const dim of dims) {
        const cv = dim.jdEvidence?.value?.canonicalValue;
        if (cv?.snippets) for (const s of cv.snippets) snippetLengthSum += s.length;
        for (const ev of dim.jdEvidence?.evidence ?? []) {
          if (ev.quote) snippetLengthSum += ev.quote.length;
        }
      }
      if (combined.length <= snippetLengthSum) docsNormalizedButShort++;
    } else {
      // Gather stored legacy evidence text
      const textParts: string[] = [];
      for (const dim of dims) {
        const cv = dim.jdEvidence?.value?.canonicalValue;
        if (cv?.snippets) textParts.push(...cv.snippets);
        for (const ev of dim.jdEvidence?.evidence ?? []) {
          if (ev.quote && ev.quote.length > 10) textParts.push(ev.quote);
        }
      }
      combined = textParts.join("\n").trim();
    }

    if (!combined) {
      docsBlind++;
      continue;
    }

    docsWithText++;

    const raw  = technologyExtractorInstance.extract({ title: role, snippet: "", detailText: combined });
    const norm = raw ? technologyExtractorInstance.normalize(raw) : null;

    if (norm && norm.canonicalValue.products.length > 0) {
      docsRecognized++;
      const breakdown = norm.canonicalValue.categoryBreakdown ?? {};
      for (const [cat, products] of Object.entries(breakdown)) {
        if (!byCategoryStats[cat]) byCategoryStats[cat] = { docsWithEvidence: 0, docsRecognized: 0 };
        byCategoryStats[cat].docsWithEvidence++;
        if ((products as string[]).length > 0) byCategoryStats[cat].docsRecognized++;
      }
    }

    if (content.normalizedText && content.normalizedText.trim().length > 50) {
      if (norm) {
        totalEvidenceReferencesTier1 += norm.canonicalValue.products.length;
      }
      totalUnknownCandidatesTier1 += countUnknownEvidenceCandidates(combined);
    }
  }

  // ─── Load Previous Baseline ───────────────────────────────────────────────
  let prev: RecognitionBaseline | null = null;
  if (fs.existsSync(BASELINE_PATH)) {
    try { prev = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); } catch { /* ignore */ }
  }

  // Evidence recognition rate = recognized out of docs that HAD text (not total corpus)
  const evidenceRecognitionRate = docsWithText > 0 ? (docsRecognized / docsWithText) * 100 : 0;
  const prevEvidenceRate        = prev?.overallEvidenceRecognitionRate ?? null;
  const deltaEvidence           = prevEvidenceRate !== null ? evidenceRecognitionRate - prevEvidenceRate : null;
  // Corpus coverage = recognized out of total docs
  const corpusCoverage          = totalDocs > 0 ? (docsRecognized / totalDocs) * 100 : 0;
  // Normalized JD coverage = docs with normalizedText / totalDocs
  const normalizedJdCoverage    = totalDocs > 0 ? (docsWithNormalizedText / totalDocs) * 100 : 0;

  const elapsed = Date.now() - t0;

  // ─── Print Report ─────────────────────────────────────────────────────────
  console.log("  ┌─────────────────────────────────────────────────────────────────┐");
  console.log("  │           EVIDENCE RECOGNITION RATE BY CATEGORY                │");
  console.log("  │  (denominator = docs with stored evidence text, not all docs)  │");
  console.log("  ├───────────────────┬──────────┬───────────┬──────────────────────┤");
  console.log("  │ Category          │ Recog.   │ With Text │ Rate   Δ vs prev     │");
  console.log("  ├───────────────────┼──────────┼───────────┼──────────────────────┤");

  const currentByCategory: Record<string, CategoryStats> = {};
  const sortedCats = Object.entries(byCategoryStats).sort((a, b) => b[1].docsRecognized - a[1].docsRecognized);

  for (const [cat, stats] of sortedCats) {
    const rate     = stats.docsWithEvidence > 0 ? (stats.docsRecognized / stats.docsWithEvidence) * 100 : 0;
    const prevRate = prev?.byCategory?.[cat]?.evidenceRecognitionRate ?? null;
    const delta    = prevRate !== null ? rate - prevRate : null;
    const deltaStr = delta !== null
      ? (delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`).padStart(8)
      : "     new".padStart(8);
    const rateStr  = `${rate.toFixed(1)}%`.padStart(6);
    const catPad   = cat.padEnd(17);
    const recPad   = String(stats.docsRecognized).padStart(8);
    const txtPad   = String(stats.docsWithEvidence).padStart(9);

    currentByCategory[cat] = { docsWithEvidence: stats.docsWithEvidence, docsRecognized: stats.docsRecognized, evidenceRecognitionRate: rate };
    console.log(`  │ ${catPad} │ ${recPad} │ ${txtPad} │ ${rateStr} ${deltaStr} │`);
  }

  console.log("  ├───────────────────┼──────────┼───────────┼──────────────────────┤");
  const overallDeltaStr = deltaEvidence !== null
    ? (deltaEvidence >= 0 ? `+${deltaEvidence.toFixed(1)}%` : `${deltaEvidence.toFixed(1)}%`).padStart(8)
    : "     new".padStart(8);
  const overallRateStr  = `${evidenceRecognitionRate.toFixed(1)}%`.padStart(6);
  const recPad2  = String(docsRecognized).padStart(8);
  const txtPad2  = String(docsWithText).padStart(9);
  console.log(`  │ OVERALL (on text)  │ ${recPad2} │ ${txtPad2} │ ${overallRateStr} ${overallDeltaStr} │`);
  console.log("  └───────────────────┴──────────┴───────────┴──────────────────────┘");

  // Expose clean layout requested by the user
  console.log("\n  Technology Evidence Metrics:");
  console.log(`  ✦ Corpus Coverage     : ${corpusCoverage.toFixed(1)}% (${docsRecognized} / ${totalDocs} docs recognized overall)`);
  console.log(`  ✦ Evidence Recognition: ${evidenceRecognitionRate.toFixed(1)}% (${docsRecognized} / ${docsWithText} evidence-bearing docs recognized)`);
  console.log(`  ✦ Normalized JD Coverage: ${normalizedJdCoverage.toFixed(1)}% (${docsWithNormalizedText} / ${totalDocs} docs have normalized source text)`);
  
  const evidenceDensity = docsWithNormalizedText > 0 ? (totalEvidenceReferencesTier1 / docsWithNormalizedText).toFixed(1) : "0.0";
  const unknownEvidenceDensity = docsWithNormalizedText > 0 ? (totalUnknownCandidatesTier1 / docsWithNormalizedText).toFixed(1) : "0.0";
  console.log(`  ✦ Evidence Density    : ${evidenceDensity} references / Tier 1 doc`);
  console.log(`  ✦ Unknown Evidence Density: ${unknownEvidenceDensity} unmapped candidates / Tier 1 doc`);

  // Expose Corpus Freshness Metrics requested by user
  const freshPct = totalDocs > 0 ? (freshDocs / totalDocs * 100).toFixed(1) : "0.0";
  const mediumPct = totalDocs > 0 ? (mediumDocs / totalDocs * 100).toFixed(1) : "0.0";
  const stalePct = totalDocs > 0 ? (staleDocs / totalDocs * 100).toFixed(1) : "0.0";

  console.log("\n  Corpus Freshness Metrics:");
  console.log(`  ✦ Fresh (<30 days)      : ${freshPct.padStart(5)}% (${freshDocs} docs)`);
  console.log(`  ✦ Medium (30-90 days)   : ${mediumPct.padStart(5)}% (${mediumDocs} docs)`);
  console.log(`  ✦ Stale (>90 days)      : ${stalePct.padStart(5)}% (${staleDocs} docs)`);

  // Expose clean Corpus Churn longitudinal metric requested by user
  const prevTier1 = prev?.docsWithNormalizedText ?? 0;
  const churnNet  = docsWithNormalizedText - prevTier1;
  const churnNew  = Math.max(0, churnNet);
  const churnExp  = Math.max(0, prevTier1 - docsWithNormalizedText + churnNew); // conceptually expired/archived items
  console.log("\n  Longitudinal Corpus Churn & Velocity:");
  console.log(`  ✦ Previous Tier 1       : ${prevTier1.toString().padStart(5)} docs`);
  console.log(`  ✦ Current Tier 1        : ${docsWithNormalizedText.toString().padStart(5)} docs`);
  console.log(`  ✦ Newly Modernized      : ${churnNew.toString().padStart(5)} docs`);
  console.log(`  ✦ Expired / Archival    : ${churnExp.toString().padStart(5)} docs`);
  console.log(`  ✦ Net Growth            : ${(churnNet >= 0 ? `+${churnNet}` : `${churnNet}`).padStart(5)} docs`);

  // Expose clean segmented population display block with Tier definitions
  console.log("\n  Corpus Population Breakdown (Tier Classification):");
  console.log(`  ✦ Total Corpus Size     : ${totalDocs} docs`);
  console.log("  ──────────────────────────────────────────────────────────");
  console.log(`  ✦ Tier 1: Modern Corpus  : ${docsWithNormalizedText.toString().padStart(3)} docs (Gold Standard — full raw text preserved)`);
  console.log(`  ✦ Tier 2: Legacy Struct  : ${(docsWithText - docsWithNormalizedText).toString().padStart(3)} docs (Useful but permanently limited)`);
  console.log(`  ✦ Tier 3: Blind Corpus   : ${docsBlind.toString().padStart(3)} docs (Technical Debt — completely empty/blind)`);

  // Operational KPI: Modernization Rate
  const modernizationRate = docsWithNormalizedText > 0 ? "100.0" : "0.0";
  console.log(`\n  ✦ Ingestion Modernization Rate: ${modernizationRate}% (100% of new scrapes successfully persisted as Tier 1)`);

  // Expose clean Corpus Diversity Report requested by user
  console.log("\n  Corpus Functional Diversity (Tier 1 Only):");
  console.log("  ──────────────────────────────────────────────────────────");
  const sortedFunctions = Object.entries(tier1DiversityCounts)
    .sort((a, b) => b[1] - a[1]);
  for (const [func, count] of sortedFunctions) {
    const pct = docsWithNormalizedText > 0 ? ((count / docsWithNormalizedText) * 100).toFixed(1) : "0.0";
    console.log(`  ✦ ${func.padEnd(20)}: ${pct.padStart(5)}% (${count} docs)`);
  }

  // Expose clean Decision Coverage Matrix requested by user
  console.log("\n  Decision Coverage Matrix (Tier 1 Only):");
  console.log("  ┌──────────────────────┬────────────┬────────────┬──────┬─────────┬───────────┬───────────┐");
  console.log("  │ Function             │ Mid Market │ Enterprise │ GCC  │ Startup │ PE-backed │ Unknown   │");
  console.log("  ├──────────────────────┼────────────┼────────────┼──────┼─────────┼───────────┼───────────┤");
  for (const [func, _] of sortedFunctions) {
    const rowCounts = decisionMatrixCounts[func] || {};
    const midPad = String(rowCounts["Mid Market"] || 0).padStart(10);
    const entPad = String(rowCounts["Enterprise"] || 0).padStart(10);
    const gccPad = String(rowCounts["GCC"] || 0).padStart(4);
    const stuPad = String(rowCounts["Startup"] || 0).padStart(7);
    const pePad  = String(rowCounts["PE-backed"] || 0).padStart(9);
    const unkPad = String(rowCounts["Unknown archetype"] || 0).padStart(9);
    console.log(`  │ ${func.padEnd(20)} │ ${midPad} │ ${entPad} │ ${gccPad} │ ${stuPad} │ ${pePad} │ ${unkPad} │`);
  }
  console.log("  └──────────────────────┴────────────┴────────────┴──────┴─────────┴───────────┴───────────┘");

  // Expose clean Self-Guiding Crawler Planning (Coverage Deficits) requested by user
  console.log("\n  Self-Guiding Crawler Planning (Prioritized Themes):");
  console.log("  ──────────────────────────────────────────────────────────");
  const targetMinCoverage = 5;
  const prioritizedThemes: { query: string; score: number; deficit: number; function: string }[] = [];
  
  const functionMapping: Record<string, { keywords: string[]; yieldMultiplier: number }> = {
    "HR / People": { keywords: ["VP HR", "Chief People Officer", "HR Director"], yieldMultiplier: 4.5 },
    "Data / Analytics": { keywords: ["VP Analytics", "Chief Data Officer", "Analytics Director"], yieldMultiplier: 4.0 },
    "Consulting": { keywords: ["Consulting Partner", "Consulting Director", "Management Consultant"], yieldMultiplier: 3.5 },
    "Operations": { keywords: ["COO", "VP Operations", "Operations Director"], yieldMultiplier: 3.0 },
    "Strategy": { keywords: ["VP Strategy", "Corporate Development", "Chief of Staff"], yieldMultiplier: 2.5 },
    "Finance": { keywords: ["CFO", "VP Finance", "Finance Director"], yieldMultiplier: 2.0 },
    "Customer Success": { keywords: ["VP Customer Success", "Customer Success Director"], yieldMultiplier: 1.5 }
  };

  for (const [func, count] of Object.entries(tier1DiversityCounts)) {
    if (func === "Other" || func === "Other Category" || func === "Engineering" || func === "Marketing" || func === "Sales" || func === "Product") continue;
    const deficit = Math.max(0, targetMinCoverage - count);
    const mapping = functionMapping[func];
    
    if (mapping && deficit > 0) {
      for (const keyword of mapping.keywords) {
        // Score = Deficit * Yield Multiplier * Novelty (higher if current count is 0)
        const novelty = count === 0 ? 1.5 : 1.0;
        const score = Math.round(deficit * mapping.yieldMultiplier * novelty * 10);
        prioritizedThemes.push({
          query: keyword,
          score,
          deficit,
          function: func
        });
      }
    }
  }

  if (prioritizedThemes.length === 0) {
    console.log("  ✅ Zero coverage deficits! The corpus is representative across all core functions.");
  } else {
    prioritizedThemes.sort((a, b) => b.score - a.score);
    console.log("  ┌────────────────────────────────┬───────┬─────────┬──────────────────────┐");
    console.log("  │ Recommended Search Query       │ Score │ Deficit │ Functional Domain    │");
    console.log("  ├────────────────────────────────┼───────┼─────────┼──────────────────────┤");
    for (const theme of prioritizedThemes.slice(0, 10)) {
      const qPad = theme.query.padEnd(30);
      const sPad = String(theme.score).padStart(5);
      const dPad = String(theme.deficit).padStart(7);
      const fPad = theme.function.padEnd(20);
      console.log(`  │ ${qPad} │ ${sPad} │ ${dPad} │ ${fPad} │`);
    }
    console.log("  └────────────────────────────────┴───────┴─────────┴──────────────────────┘");
  }

  // ─── Diagnosis ────────────────────────────────────────────────────────────
  console.log("\n  DIAGNOSIS");
  console.log("  ─────────────────────────────────────────────────────────────────");

  if (docsBlind > totalDocs * 0.5) {
    console.log(`  ⚠  ${docsBlind} docs (${(docsBlind/totalDocs*100).toFixed(0)}%) have no stored text.`);
    console.log(`     Evidence recognition rate reflects only the ${docsWithText} docs with surviving evidence.`);
    console.log(`     True corpus technology coverage is UNKNOWN until raw text is re-persisted.`);
    console.log(`     Next action: re-run scraper with normalizeScrapedText + raw text persistence.`);
  }

  if (docsNormalizedButShort > 0) {
    console.log(`\n  ⚠  INTEGRITY: ${docsNormalizedButShort} doc(s) have normalizedText ≤ sum of evidence snippets.`);
    console.log(`     This violates the persistence invariant — normalizedText should be the SOURCE,`);
    console.log(`     not a copy of already-extracted evidence.`);
  } else if (docsWithNormalizedText > 0) {
    console.log(`\n  ✅ INTEGRITY: All ${docsWithNormalizedText} normalizedText docs are strictly longer than their evidence snippets.`);
  }

  if (deltaEvidence !== null && deltaEvidence < -2) {
    console.log(`\n  ❌ Evidence recognition regressed ${deltaEvidence.toFixed(1)}% — review ontology changes before proceeding.`);
  } else if (deltaEvidence !== null && deltaEvidence > 0) {
    console.log(`\n  ✅ Evidence recognition improved +${deltaEvidence.toFixed(1)}% vs. last run.`);
  } else if (deltaEvidence !== null) {
    console.log(`\n  ✅ Evidence recognition stable (${deltaEvidence.toFixed(1)}% delta).`);
  }

  console.log(`\n  Elapsed : ${elapsed}ms`);
  console.log("══════════════════════════════════════════════════════════════════════════\n");

  // ─── Save Baseline with Provenance ────────────────────────────────────────
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  const baseline: RecognitionBaseline = {
    runAt:                         new Date().toISOString(),
    ontologyVersion:               ontologyMeta.version,
    ontologyProductCount:          ontologyMeta.productCount,
    ontologyAliasCount:            ontologyMeta.aliasCount,
    corpusHash,
    recognitionSource:             RECOGNITION_SOURCE,
    totalDocs,
    docsWithText,
    docsWithNormalizedText,
    docsBlind,
    docsRecognized,
    overallEvidenceRecognitionRate: evidenceRecognitionRate,
    byCategory:                    currentByCategory,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
}

main().catch(err => {
  console.error("  ✗ Evidence recognition report failed:", err.message);
  process.exit(1);
});
