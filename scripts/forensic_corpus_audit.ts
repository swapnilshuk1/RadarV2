import { getDatabaseAdapter } from "../src/data/database/index.js";
import fs from "fs";
import path from "path";

export interface ForensicRecord {
  oppId: string;
  docId: string;
  jobHash: string;
  portal: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  wordCount: number;
  charCount: number;
  responsibilities: "Yes" | "No" | "Partial";
  requirements: "Yes" | "No" | "Partial";
  qualifications: "Yes" | "No" | "Partial";
  captureTimestamp: string;
  captureMethod: string;
  scrapeRun: string;
  telemetry: any;
  failureSignals: string;
  whySuspicious: string;
  classification: "LIKELY_CAPTURE_FAILURE" | "POSSIBLE_CAPTURE_FAILURE" | "CAPTURE_SPARSE" | "MANUAL_INSPECTION_REQUIRED";
  priority: "P0" | "P1" | "P2" | "HEALTHY";
  textPreview: string;
}

function checkResponsibilities(text: string, dims: any[]): "Yes" | "No" | "Partial" {
  const lower = text.toLowerCase();
  const hasHeading = /responsibilit|duties|accountabilit|what you('ll| will) do|key deliverables|mandate|scope of work|role overview/i.test(lower);
  const mandateDim = dims?.find(d => d.key === "mandate" || d.key === "functionalScope");
  const hasDimEvidence = (mandateDim?.jdEvidence?.evidence?.length || 0) > 0;
  
  if (hasHeading && hasDimEvidence) return "Yes";
  if (hasHeading || hasDimEvidence || text.length > 1500) return "Partial";
  return "No";
}

function checkRequirements(text: string, dims: any[]): "Yes" | "No" | "Partial" {
  const lower = text.toLowerCase();
  const hasHeading = /requirement|must have|what we('re| are) looking for|skills required|technical skills|desired skills|competenc/i.test(lower);
  const reqDim = dims?.find(d => d.key === "requiredLevel" || d.key === "technologyStack");
  const hasDimEvidence = (reqDim?.jdEvidence?.evidence?.length || 0) > 0;

  if (hasHeading && hasDimEvidence) return "Yes";
  if (hasHeading || hasDimEvidence || text.length > 1500) return "Partial";
  return "No";
}

function checkQualifications(text: string, dims: any[]): "Yes" | "No" | "Partial" {
  const lower = text.toLowerCase();
  const hasHeading = /qualification|education|bachelor|master|mba|degree|years of experience|experience required|eligibility/i.test(lower);
  const expDim = dims?.find(d => d.key === "requiredLevel");
  const hasDimEvidence = (expDim?.jdEvidence?.evidence?.length || 0) > 0;

  if (hasHeading && hasDimEvidence) return "Yes";
  if (hasHeading || hasDimEvidence || text.length > 1500) return "Partial";
  return "No";
}

async function runAudit() {
  const db = getDatabaseAdapter();

  console.log("Querying all documents and opportunities from Turso Cloud...");

  // Load canonical opportunities and acquisition ledger into memory maps for fast URL resolution
  const canonRows = await db.many<any>("SELECT * FROM canonical_opportunities");
  const canonMap = new Map<string, any>();
  for (const row of canonRows) {
    if (row.source_job_id) canonMap.set(row.source_job_id, row);
    if (row.id) canonMap.set(row.id, row);
  }

  const acqRows = await db.many<any>("SELECT * FROM acquisition_ledger");
  const acqMap = new Map<string, any>();
  for (const row of acqRows) {
    if (row.source_job_id) acqMap.set(row.source_job_id, row);
    if (row.canonical_job_id) acqMap.set(row.canonical_job_id, row);
  }

  // Load all documents
  const docs = await db.many<any>(`
    SELECT d.id as doc_id, d.opportunity_id, d.source_id, d.payload_type, d.content,
           d.created_at as doc_created_at, d.meta_run_id, d.meta_timestamp, d.meta_extractor_version,
           o.canonical_title, o.location as opp_location, o.fingerprint, o.created_at as opp_created_at,
           c.name as company_name
    FROM documents d
    LEFT JOIN opportunities o ON d.opportunity_id = o.id
    LEFT JOIN companies c ON o.company_id = c.id
  `);

  console.log(`Loaded ${docs.length} documents from Turso.`);

  // Also check if any extra opportunities are in live-scraped.json
  const liveScrapedPath = path.resolve("src/data/live-scraped.json");
  let liveScrapedMap = new Map<string, any>();
  if (fs.existsSync(liveScrapedPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(liveScrapedPath, "utf8"));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.jobHash) liveScrapedMap.set(item.jobHash, item);
        }
      }
    } catch {}
  }

  const records: ForensicRecord[] = [];
  const seenJobHashes = new Set<string>();

  for (const doc of docs) {
    let parsed: any = null;
    try {
      parsed = JSON.parse(doc.content);
    } catch {
      // Non-JSON content (raw HTML or text)
      parsed = {
        normalizedText: doc.content || "",
        role: doc.canonical_title,
        company: doc.company_name,
        scrapedFrom: doc.source_id,
        applyUrl: null,
      };
    }

    const jobHash = parsed.jobHash || doc.fingerprint || doc.doc_id;
    if (seenJobHashes.has(jobHash)) continue;
    seenJobHashes.add(jobHash);

    const title = parsed.role || doc.canonical_title || "Unknown Title";
    const company = parsed.company || doc.company_name || "Unknown Company";
    const location = parsed.location || doc.opp_location || "Unknown Location";
    const portal = parsed.scrapedFrom || doc.source_id || "Unknown Portal";
    
    // Resolve URL with priority: parsed.applyUrl -> acqMap -> canonMap
    let sourceUrl = parsed.applyUrl || "";
    if (!sourceUrl || sourceUrl.includes("search?") || sourceUrl.includes("undefined")) {
      const acq = acqMap.get(jobHash);
      if (acq && acq.canonical_url) {
        sourceUrl = acq.canonical_url;
      } else {
        const canon = canonMap.get(jobHash);
        if (canon && canon.canonical_url) {
          sourceUrl = canon.canonical_url;
        }
      }
    }
    if (!sourceUrl) {
      sourceUrl = "SOURCE URL NOT AVAILABLE";
    }

    // Determine raw/normalized text
    const text = (parsed.normalizedText || parsed.description || parsed.rawText || "").trim();
    const charCount = text.length;
    const words = text ? text.split(/\s+/).filter(Boolean) : [];
    const wordCount = words.length;

    const responsibilities = checkResponsibilities(text, parsed.dimensions);
    const requirements = checkRequirements(text, parsed.dimensions);
    const qualifications = checkQualifications(text, parsed.dimensions);

    const captureTimestamp = parsed.discoveredAt || doc.meta_timestamp || doc.doc_created_at || "Unknown";
    
    // Capture method & telemetry
    const acq = acqMap.get(jobHash);
    let captureMethod = acq?.last_acquisition_method || (parsed.telemetry?.llmCalled ? "PLAYWRIGHT_WITH_LLM" : "PLAYWRIGHT_DOM");
    if (parsed.telemetry?.httpStatus) {
      captureMethod = `HTTP_${parsed.telemetry.httpStatus}`;
    }

    const scrapeRun = doc.meta_run_id || acq?.id || "run_legacy";
    
    // Telemetry and failure signals
    const signals: string[] = [];
    if (parsed.telemetry?.llmFallbackReason) {
      signals.push(`LLM_FALLBACK: ${parsed.telemetry.llmFallbackReason}`);
    }
    if (parsed.telemetry?.llmCalled) {
      signals.push(`LLM_CALLED (${parsed.telemetry.llmMs}ms)`);
    }
    if (acq?.last_failure_class) {
      signals.push(`ACQ_FAIL: ${acq.last_failure_class}`);
    }
    if (text.toLowerCase().includes("easily apply") && wordCount < 50) {
      signals.push("SEARCH_CARD_SNIPPET_LEAK");
    }
    if (text.toLowerCase().includes("sign in") || text.toLowerCase().includes("join linkedin")) {
      signals.push("AUTHWALL_TEXT_DETECTED");
    }
    if (text.toLowerCase().includes("just a moment") || text.toLowerCase().includes("security check")) {
      signals.push("CLOUDFLARE_CHALLENGE_DETECTED");
    }
    if (wordCount === 0) {
      signals.push("EMPTY_PAYLOAD_BODY");
    }

    const failureSignals = signals.length > 0 ? signals.join("; ") : "NONE_RECORDED";

    // Why suspicious & priority categorization
    let whySuspicious = "";
    let priority: "P0" | "P1" | "P2" | "HEALTHY" = "HEALTHY";
    let classification: "LIKELY_CAPTURE_FAILURE" | "POSSIBLE_CAPTURE_FAILURE" | "CAPTURE_SPARSE" | "MANUAL_INSPECTION_REQUIRED" = "MANUAL_INSPECTION_REQUIRED";

    if (wordCount === 0) {
      priority = "P0";
      whySuspicious = "Zero JD content captured; title/company exists but body payload is completely empty.";
      classification = "LIKELY_CAPTURE_FAILURE";
    } else if (wordCount < 30) {
      priority = "P0";
      if (text.toLowerCase().includes("easily apply") || text.toLowerCase().includes("posted recently") || text.toLowerCase().includes("health insurance")) {
        whySuspicious = `Only search card snippet captured (${wordCount} words / ${charCount} chars); detail page body never hydrated.`;
      } else {
        whySuspicious = `Severe JD truncation/snippet capture (${wordCount} words / ${charCount} chars); essentially no JD body.`;
      }
      classification = "LIKELY_CAPTURE_FAILURE";
    } else if (wordCount < 50) {
      priority = "P0";
      whySuspicious = `Extremely sparse capture (${wordCount} words); missing responsibilities, requirements, and qualifications.`;
      classification = "LIKELY_CAPTURE_FAILURE";
    } else if (wordCount < 100) {
      priority = "P1";
      whySuspicious = `Highly truncated JD (${wordCount} words); substantively below portal median (~600+ words).`;
      classification = "POSSIBLE_CAPTURE_FAILURE";
    } else if (wordCount <= 150) {
      priority = "P1";
      whySuspicious = `Short JD capture (${wordCount} words); incomplete structural sections.`;
      classification = "POSSIBLE_CAPTURE_FAILURE";
    } else if (wordCount <= 250 && (responsibilities === "No" || requirements === "No")) {
      priority = "P2";
      whySuspicious = `Sub-standard JD volume (${wordCount} words) with missing key structural sections.`;
      classification = "MANUAL_INSPECTION_REQUIRED";
    }

    records.push({
      oppId: doc.opportunity_id || doc.doc_id,
      docId: doc.doc_id,
      jobHash,
      portal,
      title,
      company,
      location,
      sourceUrl,
      wordCount,
      charCount,
      responsibilities,
      requirements,
      qualifications,
      captureTimestamp,
      captureMethod,
      scrapeRun,
      telemetry: parsed.telemetry,
      failureSignals,
      whySuspicious,
      classification,
      priority,
      textPreview: text.slice(0, 120),
    });
  }

  // Also check live-scraped.json for any records not yet in DB
  for (const [hash, item] of liveScrapedMap.entries()) {
    if (!seenJobHashes.has(hash)) {
      seenJobHashes.add(hash);
      const title = item.role || item.title || "Unknown Title";
      const company = item.company || "Unknown Company";
      const location = item.location || "Unknown Location";
      const portal = item.scrapedFrom || item.portal || "Unknown Portal";
      const sourceUrl = item.applyUrl || item.url || "SOURCE URL NOT AVAILABLE";
      const text = (item.normalizedText || item.description || "").trim();
      const charCount = text.length;
      const words = text ? text.split(/\s+/).filter(Boolean) : [];
      const wordCount = words.length;

      const responsibilities = checkResponsibilities(text, item.dimensions);
      const requirements = checkRequirements(text, item.dimensions);
      const qualifications = checkQualifications(text, item.dimensions);

      let whySuspicious = "";
      let priority: "P0" | "P1" | "P2" | "HEALTHY" = "HEALTHY";
      let classification: "LIKELY_CAPTURE_FAILURE" | "POSSIBLE_CAPTURE_FAILURE" | "CAPTURE_SPARSE" | "MANUAL_INSPECTION_REQUIRED" = "MANUAL_INSPECTION_REQUIRED";

      if (wordCount === 0) {
        priority = "P0";
        whySuspicious = "Zero JD content captured in live-scraped cache.";
        classification = "LIKELY_CAPTURE_FAILURE";
      } else if (wordCount < 50) {
        priority = "P0";
        whySuspicious = `Extremely sparse capture in live cache (${wordCount} words).`;
        classification = "LIKELY_CAPTURE_FAILURE";
      } else if (wordCount <= 150) {
        priority = "P1";
        whySuspicious = `Short JD capture (${wordCount} words).`;
        classification = "POSSIBLE_CAPTURE_FAILURE";
      } else if (wordCount <= 250 && (responsibilities === "No" || requirements === "No")) {
        priority = "P2";
        whySuspicious = `Sub-standard volume (${wordCount} words).`;
        classification = "MANUAL_INSPECTION_REQUIRED";
      }

      records.push({
        oppId: `live_${hash}`,
        docId: `live_${hash}`,
        jobHash: hash,
        portal,
        title,
        company,
        location,
        sourceUrl,
        wordCount,
        charCount,
        responsibilities,
        requirements,
        qualifications,
        captureTimestamp: item.postedRelative || "Recently",
        captureMethod: "LIVE_SCRAPED_CACHE",
        scrapeRun: "live_cache",
        telemetry: item.telemetry,
        failureSignals: item.telemetry?.llmFallbackReason ? `LLM_FALLBACK: ${item.telemetry.llmFallbackReason}` : "NONE_RECORDED",
        whySuspicious,
        classification,
        priority,
        textPreview: text.slice(0, 120),
      });
    }
  }

  // Summary metrics
  const total = records.length;
  const p0 = records.filter(r => r.priority === "P0");
  const p1 = records.filter(r => r.priority === "P1");
  const p2 = records.filter(r => r.priority === "P2");
  const healthy = records.filter(r => r.priority === "HEALTHY");

  console.log("\n================ AUDIT SUMMARY ================");
  console.log(`Total Opportunities Inspected: ${total}`);
  console.log(`P0 (Extremely Suspicious, <50 words): ${p0.length}`);
  console.log(`P1 (Highly Suspicious, 50-150 words): ${p1.length}`);
  console.log(`P2 (Potentially Suspicious, 150-250 words): ${p2.length}`);
  console.log(`Healthy (>250 words & structured): ${healthy.length}`);

  // Breakdown by portal
  const portals = Array.from(new Set(records.map(r => r.portal)));
  console.log("\n================ BREAKDOWN BY PORTAL ================");
  console.log("| Portal | P0 | P1 | P2 | Total Suspicious | Total Ingested | % Suspicious |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const p of portals) {
    const pTotal = records.filter(r => r.portal === p);
    const pP0 = pTotal.filter(r => r.priority === "P0").length;
    const pP1 = pTotal.filter(r => r.priority === "P1").length;
    const pP2 = pTotal.filter(r => r.priority === "P2").length;
    const pSusp = pP0 + pP1 + pP2;
    const pct = ((pSusp / pTotal.length) * 100).toFixed(1);
    console.log(`| ${p} | ${pP0} | ${pP1} | ${pP2} | ${pSusp} | ${pTotal.length} | ${pct}% |`);
  }

  // Save audit results to a JSON file for detailed forensic report generation
  const auditReportPath = path.resolve("scripts/forensic_sparse_report.json");
  fs.writeFileSync(auditReportPath, JSON.stringify({
    total,
    counts: { p0: p0.length, p1: p1.length, p2: p2.length, healthy: healthy.length },
    p0: p0.sort((a, b) => a.wordCount - b.wordCount),
    p1: p1.sort((a, b) => a.wordCount - b.wordCount),
    p2: p2.sort((a, b) => a.wordCount - b.wordCount),
  }, null, 2));

  console.log(`\nDetailed forensic audit saved to ${auditReportPath}`);
}

runAudit().catch(console.error);
