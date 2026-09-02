import { getDatabaseAdapter } from "../../src/data/database";
import * as fs from "fs";
import * as path from "path";

interface CohortRow {
  index: number;
  id: string;
  portal: string;
  title: string;
  company: string;
  discoveryUrl: string;
  enrichmentUrl: string;
  acquisitionMethod: string;
  httpStatus: number;
  contentType: string;
  rawPayloadSize: number;
  extractedTextSize: number;
  extractionQuality: string;
  htmlScriptDominates: boolean;
  groundedDimensionsCount: number;
  evaluationStatus: string;
  policyVerdict: string;
  humanPlausiblyRelevant: boolean;
  failureClassification:
    | "EXTRACTOR_FAILURE"
    | "ACQUISITION_FAILURE"
    | "SOURCE_FAILURE"
    | "LEGITIMATE_SPARSE"
    | "VALID_CONTENT_BUT_IRRELEVANT"
    | "SUCCESS_RELEVANT";
  evidenceNotes: string;
}

async function build39CohortMatrix() {
  const journalPath = path.resolve(
    process.cwd(),
    ".scraper-artifacts/runs/run-1788182498220/journal.ndjson"
  );
  const journalLines = fs.readFileSync(journalPath, "utf-8").split("\n").filter(Boolean);

  const snapshotPaths: string[] = [];
  for (const line of journalLines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "snapshot_written" && ev.path) {
        snapshotPaths.push(ev.path);
      }
    } catch (e) {}
  }

  console.log(`Found ${snapshotPaths.length} snapshot paths from run journal.`);

  // Load all snapshot files from local disk
  const snapshots: any[] = [];
  for (const snapPath of snapshotPaths) {
    if (fs.existsSync(snapPath)) {
      snapshots.push(JSON.parse(fs.readFileSync(snapPath, "utf-8")));
    }
  }

  console.log(`Loaded ${snapshots.length} snapshot objects from disk.`);

  // Try to query Turso in a single query, or fallback to snapshot fields
  let dbEvaluations: Record<string, any> = {};
  try {
    const db = await getDatabaseAdapter();
    const rows = await db.many<any>(
      `SELECT ov.job_title, ov.company_name, me.decision, me.quality_score, me.vetoed, 
              me.evaluation_state, me.evaluation_json
       FROM opportunity_versions ov
       JOIN materialized_evaluations me ON ov.canonical_job_id = me.canonical_job_id
       ORDER BY me.materialized_at DESC
       LIMIT 200`
    );
    for (const r of rows) {
      const key = `${r.job_title}:::${r.company_name}`.toLowerCase();
      if (!dbEvaluations[key]) dbEvaluations[key] = r;
    }
    console.log(`Loaded ${rows.length} materialized evaluations from database.`);
  } catch (err: any) {
    console.warn("Could not query DB batch, falling back to local extraction analysis:", err.message);
  }

  const rows: CohortRow[] = [];
  let idx = 1;

  for (const snap of snapshots) {
    const cardHash = snap.cardHash || "N/A";
    const portal = snap.portal || "Unknown";
    const title = snap.title || snap.jobTitle || "Untitled";
    const company = snap.company || snap.companyName || "Unknown Company";
    const discoveryUrl = snap.searchUrl || snap.detailUrl || "N/A";
    const enrichmentUrl =
      snap.enrichmentUrl ||
      (snap.detailUrl && !snap.detailUrl.includes("naukri.com") && !snap.detailUrl.includes("linkedin.com")
        ? snap.detailUrl
        : "None");
    const acquisitionMethod = snap.acquisitionRoute || (snap.detail?.fetched ? "FASTPATH" : "DISCOVERY_RICH");
    const httpStatus = snap.detail?.httpStatus || 200;
    const contentType = snap.rawHtml ? "HTML" : "TEXT";

    const rawHtml = snap.rawHtml || snap.detail?.rawHtml || "";
    const rawText = snap.rawText || snap.detail?.rawText || "";
    const rawPayloadSize = rawHtml.length || rawText.length;
    const extractedTextSize = rawText.length;

    const hasScriptDomination =
      rawText.trim().startsWith("var ") ||
      rawText.trim().startsWith("(function") ||
      rawText.includes("window.ub =") ||
      rawText.includes("rmkcdn.successfactors.com") ||
      rawText.includes("Skip to content Insights");

    // Match with evaluation
    const evalKey = `${title}:::${company}`.toLowerCase();
    const dbRow = dbEvaluations[evalKey];

    let evaluationStatus = dbRow?.evaluation_state || "EVALUATED";
    let policyVerdict = dbRow?.decision || "UNKNOWN";
    let groundedDimensionsCount = 0;

    if (dbRow?.evaluation_json) {
      try {
        const evalJson = JSON.parse(dbRow.evaluation_json);
        const dims = evalJson.dimensions || evalJson.jobProjection?.dimensions || {};
        groundedDimensionsCount = Object.keys(dims).length;
        if (evalJson.effectiveDecision) policyVerdict = evalJson.effectiveDecision;
        else if (evalJson.engineVerdict) policyVerdict = evalJson.engineVerdict;
      } catch (e) {}
    } else {
      // Estimate verdict from text quality if not yet evaluated
      if (hasScriptDomination) {
        policyVerdict = "VETOED (G-EVIDENCE-INTEGRITY-FAILED)";
        evaluationStatus = "NOT_EVALUABLE";
      } else if (rawText.length < 500) {
        policyVerdict = "SPARSE_SPEC";
        evaluationStatus = "SPARSE_SPEC";
      }
    }

    const extractionQuality = rawText.length > 2000 && !hasScriptDomination ? "COMPLETE" : "SPARSE / COMPROMISED";

    const titleLower = title.toLowerCase();
    const isExecutive =
      titleLower.includes("chief") ||
      titleLower.includes("vp") ||
      titleLower.includes("vice president") ||
      titleLower.includes("head") ||
      titleLower.includes("director") ||
      titleLower.includes("lead");
    const isRelevantDomain =
      titleLower.includes("market") ||
      titleLower.includes("growth") ||
      titleLower.includes("digital") ||
      titleLower.includes("customer") ||
      titleLower.includes("commercial") ||
      titleLower.includes("transformation");

    const humanPlausiblyRelevant = isExecutive && isRelevantDomain;

    // Classification logic
    let failureClassification: CohortRow["failureClassification"] = "SUCCESS_RELEVANT";
    let evidenceNotes = "";

    if (hasScriptDomination) {
      failureClassification = "EXTRACTOR_FAILURE";
      evidenceNotes = `Raw payload contains tracking scripts / inline JavaScript (${rawPayloadSize} bytes). Actual job DOM selector was not targeted.`;
    } else if (rawText.includes("Job searching just got simpler") || rawText.includes("Search Jobs Filters")) {
      failureClassification = "SOURCE_FAILURE";
      evidenceNotes = "Enrichment target URL redirected to portal root search page instead of posting.";
    } else if (rawPayloadSize < 300) {
      failureClassification = "ACQUISITION_FAILURE";
      evidenceNotes = "HTTP request returned empty or stub response.";
    } else if (!humanPlausiblyRelevant) {
      failureClassification = "VALID_CONTENT_BUT_IRRELEVANT";
      evidenceNotes = `Clean acquisition (${rawText.length} chars), but outside persona: "${title}" @ "${company}".`;
    } else if (rawText.length < 1000) {
      failureClassification = "LEGITIMATE_SPARSE";
      evidenceNotes = `Posting contains valid text (${rawText.length} chars) but lacks operational scale/P&L depth.`;
    } else {
      failureClassification = "SUCCESS_RELEVANT";
      evidenceNotes = `High-signal clean extraction (${rawText.length} chars). Title & domain match executive profile.`;
    }

    rows.push({
      index: idx++,
      id: cardHash,
      portal,
      title,
      company,
      discoveryUrl,
      enrichmentUrl,
      acquisitionMethod,
      httpStatus,
      contentType,
      rawPayloadSize,
      extractedTextSize,
      extractionQuality,
      htmlScriptDominates: hasScriptDomination,
      groundedDimensionsCount,
      evaluationStatus,
      policyVerdict,
      humanPlausiblyRelevant,
      failureClassification,
      evidenceNotes,
    });
  }

  // Deduplicate by cardHash / id if multiple snapshots were written for same card
  const uniqueRows: CohortRow[] = [];
  const seenIds = new Set<string>();
  for (const r of rows) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id);
      uniqueRows.push({ ...r, index: uniqueRows.length + 1 });
    }
  }

  console.log(`\nUnique opportunities analyzed: ${uniqueRows.length}`);

  fs.writeFileSync(
    path.resolve(process.cwd(), "cohort_39_full_matrix.json"),
    JSON.stringify(uniqueRows, null, 2)
  );

  console.log("=== CLASSIFICATION BREAKDOWN ===");
  const breakdown: Record<string, number> = {};
  for (const r of uniqueRows) {
    breakdown[r.failureClassification] = (breakdown[r.failureClassification] || 0) + 1;
  }
  console.log(JSON.stringify(breakdown, null, 2));

  console.log("\n=== PORTAL BREAKDOWN ===");
  const portalCounts: Record<string, number> = {};
  for (const r of uniqueRows) {
    portalCounts[r.portal] = (portalCounts[r.portal] || 0) + 1;
  }
  console.log(JSON.stringify(portalCounts, null, 2));
}

build39CohortMatrix().catch(console.error);
