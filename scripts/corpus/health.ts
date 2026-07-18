import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { LIVE_SCRAPED_JSON } from "../scraper/config";

export interface CorpusHealthStats {
  totalJobs: number;
  textCoveragePercent: number;
  avgDescLength: number;
  capabilityCoveragePercent: number;
  avgDimensionConfidencePercent: number;
  avgEvidenceQuotesPerJob: number;
  extractionVersion: string;
  editorialCoveragePercent: number;
}

/**
 * Calculates health statistics for the Job Intelligence Corpus.
 */
export function calculateCorpusHealth(dbPath?: string): CorpusHealthStats {
  const resolvedDbPath = dbPath || path.resolve(process.cwd(), "radar.sqlite");
  
  let totalJobs = 0;
  let textCoverage = 0;
  let totalDescLength = 0;
  let jobsWithDesc = 0;
  let capabilityCoverage = 0;
  let totalDimConfidence = 0;
  let totalDimConfidenceCount = 0;
  let totalEvidenceQuotes = 0;
  let extractionVersion = "Unknown";
  let editorialCoverage = 0;

  // Let's read from both SQLite and live-scraped.json if available
  if (fs.existsSync(LIVE_SCRAPED_JSON)) {
    try {
      const records = JSON.parse(fs.readFileSync(LIVE_SCRAPED_JSON, "utf-8")) as any[];
      totalJobs = records.length;
      
      for (const rec of records) {
        // Extraction Version
        if (rec.extractorVersion && rec.extractorVersion !== "1.0.0") {
          extractionVersion = rec.extractorVersion;
        } else if (rec.dimensionVersion) {
          extractionVersion = rec.dimensionVersion;
        }

        // Text Coverage
        const text = rec.normalizedText || "";
        if (text.length > 50) {
          textCoverage++;
          totalDescLength += text.length;
          jobsWithDesc++;
        }

        // Dimensions confidence & quotes
        const dims = Array.isArray(rec.dimensions) ? rec.dimensions : [];
        for (const dim of dims) {
          const status = dim.jdEvidence?.status;
          const confidence = status === "Explicit" ? 100 : status === "Inferred" ? 70 : 0;
          totalDimConfidence += confidence;
          totalDimConfidenceCount++;

          const quotes = dim.jdEvidence?.evidence || [];
          totalEvidenceQuotes += quotes.length;
        }

        // Capability Coverage
        const hasCaps = rec.dimensions?.some((d: any) => d.jdEvidence?.value !== null);
        if (hasCaps) capabilityCoverage++;

        // Editorial Coverage (whyNow, headspace, positioning, alternativePath, headspaceInvestment)
        const hasEditorial = rec.whyNow || rec.positioning || rec.alternativePath;
        if (hasEditorial) editorialCoverage++;
      }
    } catch (err: any) {
      console.error("[Health] Error reading live-scraped.json for statistics:", err.message);
    }
  }

  // Fallback to SQLite if live-scraped is empty
  if (totalJobs === 0 && fs.existsSync(resolvedDbPath)) {
    try {
      const db = new Database(resolvedDbPath, { readonly: true });
      const rows = db.prepare("SELECT content FROM documents WHERE payload_type = 'Structured'").all() as { content: string }[];
      totalJobs = rows.length;

      for (const row of rows) {
        const rec = JSON.parse(row.content);
        const text = rec.normalizedText || "";
        if (text.length > 50) {
          textCoverage++;
          totalDescLength += text.length;
          jobsWithDesc++;
        }

        const dims = rec.dimensions || [];
        for (const dim of dims) {
          const status = dim.jdEvidence?.status;
          totalDimConfidence += status === "Explicit" ? 100 : status === "Inferred" ? 70 : 0;
          totalDimConfidenceCount++;
          totalEvidenceQuotes += (dim.jdEvidence?.evidence || []).length;
        }

        if (dims.length > 0) capabilityCoverage++;
        if (rec.whyNow || rec.positioning) editorialCoverage++;
        if (rec.extractorVersion) extractionVersion = rec.extractorVersion;
      }
      db.close();
    } catch (err: any) {
      console.error("[Health] Error reading SQLite database for statistics:", err.message);
    }
  }

  return {
    totalJobs,
    textCoveragePercent: totalJobs > 0 ? (textCoverage / totalJobs) * 100 : 0,
    avgDescLength: jobsWithDesc > 0 ? Math.round(totalDescLength / jobsWithDesc) : 0,
    capabilityCoveragePercent: totalJobs > 0 ? (capabilityCoverage / totalJobs) * 100 : 0,
    avgDimensionConfidencePercent: totalDimConfidenceCount > 0 ? Math.round(totalDimConfidence / totalDimConfidenceCount) : 0,
    avgEvidenceQuotesPerJob: totalJobs > 0 ? parseFloat((totalEvidenceQuotes / totalJobs).toFixed(1)) : 0,
    extractionVersion: extractionVersion === "Unknown" ? "4.1.0" : extractionVersion,
    editorialCoveragePercent: totalJobs > 0 ? (editorialCoverage / totalJobs) * 100 : 0,
  };
}

export function displayCorpusHealth() {
  const stats = calculateCorpusHealth();

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("             JOB INTELLIGENCE CORPUS HEALTH REPORT");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`  ✦ Total Scraped Opportunities  : \x1b[32m${stats.totalJobs}\x1b[0m`);
  console.log(`  ✦ Description Coverage        : \x1b[32m${stats.textCoveragePercent.toFixed(1)}%\x1b[0m`);
  console.log(`  ✦ Average Description Length  : \x1b[32m${stats.avgDescLength.toLocaleString()} chars\x1b[0m`);
  console.log(`  ✦ Capability Alignment Coverage: \x1b[32m${stats.capabilityCoveragePercent.toFixed(1)}%\x1b[0m`);
  console.log(`  ✦ Average Dimension Confidence : \x1b[32m${stats.avgDimensionConfidencePercent}%\x1b[0m`);
  console.log(`  ✦ Verbatim Evidence Density   : \x1b[32m${stats.avgEvidenceQuotesPerJob} quotes/job\x1b[0m`);
  console.log(`  ✦ Dynamic Editorial Coverage   : \x1b[32m${stats.editorialCoveragePercent.toFixed(1)}%\x1b[0m`);
  console.log(`  ✦ Active Extraction Schema     : \x1b[36mVersion ${stats.extractionVersion}\x1b[0m`);
  console.log("══════════════════════════════════════════════════════════════════\n");
}

// CLI check
const isMain = typeof process !== "undefined" && 
  process.argv && 
  process.argv[1] && 
  (process.argv[1].endsWith("health.ts") || process.argv[1].endsWith("health"));

if (isMain) {
  displayCorpusHealth();
}
