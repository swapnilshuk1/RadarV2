import fs from "fs";
import path from "path";
import { getDatabaseAdapter } from "../src/data/database";
import { DimensionResolver } from "../src/lib/recommendation/DimensionResolver";
import { DeterministicScorer, type JobSlice } from "../src/lib/recommendation/DeterministicScorer";

const POLICY_DIMENSIONS = [
  { key: "leadershipLevel", expectedAttribute: "requiredLevel", label: "Leadership Level", weight: 25,
    keywords: [/ceo/i, /coo/i, /cto/i, /cfo/i, /president/i, /vp\b/i, /svp\b/i, /evp\b/i, /director/i, /head of/i, /chief/i, /md\b/i] },
  { key: "mandate", expectedAttribute: "mandate", label: "Mandate", weight: 20,
    keywords: [/strategy/i, /roadmap/i, /growth/i, /launch/i, /optimize/i, /scale/i, /ownership/i, /build\s+from\s+scratch/i, /greenfield/i, /modernize/i, /turnaround/i, /restructure/i] },
  { key: "transformation", expectedAttribute: "mandate", label: "Transformation", weight: 15,
    keywords: [/transform/i, /turnaround/i, /pivot/i, /restruct/i, /reorgani/i, /align/i] },
  { key: "commercialAccountability", expectedAttribute: "commercialAccountability", label: "Commercial Accountability", weight: 15,
    keywords: [/p&l/i, /budget/i, /revenue/i, /profitability/i, /ebitda/i, /sales target/i, /financial accountability/i] },
  { key: "reportingLine", expectedAttribute: "reportingLine", label: "Reporting Line", weight: 10,
    keywords: [/reports?\s+to\b/i, /reporting\s+to\b/i, /accountable\s+to\b/i, /reporting\s+line\b/i] },
  { key: "geography", expectedAttribute: "geography", label: "Geography", weight: 10,
    keywords: [/global/i, /international/i, /worldwide/i, /apac/i, /emea/i, /regional/i, /local/i, /india/i] },
  { key: "technologyStack", expectedAttribute: "technologyStack", label: "Technology Stack", weight: 10,
    keywords: [/saas/i, /crm/i, /erp/i, /aws/i, /azure/i, /gcp/i, /salesforce/i, /adobe/i, /hubspot/i, /platform/i] },
  { key: "functionalScope", expectedAttribute: "functionalScope", label: "Functional Scope", weight: 5,
    keywords: [/marketing/i, /growth/i, /sales/i, /product/i, /operations/i, /business head/i] }
];

interface PipelineLineage {
  jobId: string;
  title: string;
  dimension: string;
  rawJd: boolean;
  regexMatched: boolean;
  normalized: boolean;
  kg: boolean;
  resolver: boolean;
  scorer: boolean;
  recommendation: boolean;
}

// Frozen Baselines for comparison (Before vs After)
const BASELINES: Record<string, { coverage: number; captureRate: number; expectedLoss: number }> = {
  commercialAccountability: { coverage: 4.8, captureRate: 6.2, expectedLoss: 14.29 },
  mandate: { coverage: 25.7, captureRate: 32.0, expectedLoss: 14.56 },
  reportingLine: { coverage: 0.0, captureRate: 0.0, expectedLoss: 10.00 },
  technologyStack: { coverage: 13.4, captureRate: 19.0, expectedLoss: 8.66 }
};

// Reconstructed old extractors for simulation
function simulateOldCommercial(text: string): boolean {
  return !!text.match(/p&l/i) || !!text.match(/budget/i);
}
function simulateOldMandate(text: string): boolean {
  return !!text.match(/transform|turnaround|pivot|restruct|align/i) || !!text.match(/scale|growth/i) || !!text.match(/strategy|roadmap|launch|optimize|ownership/i);
}

async function main() {
  const db = getDatabaseAdapter();
  const resolver = new DimensionResolver();
  const scorer = new DeterministicScorer();
  const profile = { id: "default-profile", hardConstraints: [], technology: [] } as any;
  const policy = {
    id: "default-policy",
    weights: {
      leadershipLevel: 25,
      mandate: 20,
      transformation: 15,
      commercialAccountability: 15,
      geography: 10,
      technologyStack: 10,
      functionalScope: 5
    }
  } as any;

  try {
    const jobs = await db.many<any>(`
      SELECT id, fingerprint, canonical_title FROM opportunities WHERE lifecycle IN ('Normalized', 'Verified')
    `);

    const factRows = await db.many<any>("SELECT opportunity_id, attribute, value FROM facts");
    const docRows = await db.many<any>("SELECT opportunity_id, content FROM documents");

    const factsByJob = new Map<string, Record<string, any>>();
    for (const fact of factRows) {
      if (!factsByJob.has(fact.opportunity_id)) factsByJob.set(fact.opportunity_id, {});
      try {
        const parsed = JSON.parse(fact.value);
        factsByJob.get(fact.opportunity_id)![fact.attribute] = parsed?.value ?? parsed ?? null;
      } catch {
        factsByJob.get(fact.opportunity_id)![fact.attribute] = fact.value;
      }
    }

    const docExtractionsByJob = new Map<string, any>();
    for (const doc of docRows) {
      if (doc.opportunity_id) {
        try {
          docExtractionsByJob.set(doc.opportunity_id, JSON.parse(doc.content));
        } catch {}
      }
    }

    const lineages: PipelineLineage[] = [];

    for (const job of jobs) {
      let rawText = "";
      const snapPath = path.join(".scraper-artifacts", "snapshots", `${job.fingerprint}.json`);
      if (fs.existsSync(snapPath)) {
        try {
          const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
          rawText = [
            snapshot.title,
            snapshot.company,
            snapshot.location,
            snapshot.rawText,
            snapshot.detail?.rawText
          ].filter(Boolean).join("\n");
        } catch {}
      }

      const jobFacts = factsByJob.get(job.id) ?? {};
      const jobSliceDimensions: Record<string, any> = {};
      for (const [k, v] of Object.entries(jobFacts)) {
        jobSliceDimensions[k] = { value: v };
      }
      const jobSlice: JobSlice = {
        jobId: job.id,
        jobHash: job.fingerprint,
        graphVersion: "v1",
        dimensions: jobSliceDimensions
      };

      const extractedJson = docExtractionsByJob.get(job.id);

      for (const policyDim of POLICY_DIMENSIONS) {
        let rawJdPresent = false;
        if (rawText) {
          for (const rx of policyDim.keywords) {
            if (rawText.match(rx)) {
              rawJdPresent = true;
              break;
            }
          }
        }

        let regexMatched = false;
        let normalized = false;
        if (extractedJson && extractedJson.dimensions) {
          const extractedDim = extractedJson.dimensions.find((d: any) => d.key === policyDim.expectedAttribute);
          if (extractedDim && extractedDim.jdEvidence) {
            const evVal = extractedDim.jdEvidence.value;
            if (evVal !== null && evVal !== "") {
              regexMatched = true;
              normalized = true;
            }
          }
        }

        const kgAttribute = policyDim.expectedAttribute;
        const kg = jobFacts[kgAttribute] !== undefined && jobFacts[kgAttribute] !== null && jobFacts[kgAttribute] !== "";

        const resolved = resolver.resolve(policyDim.key, jobSlice, profile);
        const resolvedPresent = resolved.source !== "none" && resolved.value !== null && resolved.value !== "";

        lineages.push({
          jobId: job.id,
          title: job.canonical_title,
          dimension: policyDim.key,
          rawJd: rawJdPresent,
          regexMatched,
          normalized,
          kg,
          resolver: resolvedPresent,
          scorer: resolvedPresent,
          recommendation: resolvedPresent
        });
      }
    }

    const totalJobs = jobs.length;

    // A. ENGINEERING PIPELINE REPORT
    console.log("==========================================================================================");
    console.log("                                ENGINEERING PIPELINE REPORT");
    console.log("==========================================================================================");
    console.log(`${"Dimension".padEnd(25)} | ${"Raw JD".padEnd(8)} | ${"Regex Match".padEnd(11)} | ${"Normalizer".padEnd(10)} | ${"KG Stored".padEnd(9)} | ${"Resolver".padEnd(8)} | ${"Recommendation".padEnd(14)}`);
    console.log("-".repeat(106));

    for (const policyDim of POLICY_DIMENSIONS) {
      const dimLineages = lineages.filter(l => l.dimension === policyDim.key);
      const rawJdCount = dimLineages.filter(l => l.rawJd).length;
      const regexCount = dimLineages.filter(l => l.regexMatched).length;
      const normCount = dimLineages.filter(l => l.normalized).length;
      const kgCount = dimLineages.filter(l => l.kg).length;
      const resolverCount = dimLineages.filter(l => l.resolver).length;
      const recCount = dimLineages.filter(l => l.recommendation).length;

      console.log(
        `${policyDim.label.padEnd(25)} | ` +
        `${rawJdCount.toString().padStart(6)}   | ` +
        `${regexCount.toString().padStart(9)}   | ` +
        `${normCount.toString().padStart(8)}   | ` +
        `${kgCount.toString().padStart(7)}   | ` +
        `${resolverCount.toString().padStart(6)}   | ` +
        `${recCount.toString().padStart(8)}`
      );
    }
    console.log("=".repeat(106));

    // B. BUSINESS LIFT & ROI REPORT
    console.log("\n==========================================================================================");
    console.log("                               BUSINESS LIFT & ROI REPORT");
    console.log("==========================================================================================");
    console.log(`${"Dimension Key / Metric".padEnd(28)} | ${"Baseline (7A.3)".padEnd(16)} | ${"Current Live (7A.4C)".padEnd(20)} | ${"Lift / Delta".padEnd(12)}`);
    console.log("-".repeat(106));

    for (const key of ["commercialAccountability", "mandate", "reportingLine", "technologyStack"]) {
      const label = POLICY_DIMENSIONS.find(d => d.key === key)?.label ?? key;
      const baseline = BASELINES[key];
      const dimLineages = lineages.filter(l => l.dimension === key);
      const liveKgPct = (dimLineages.filter(l => l.kg).length / totalJobs) * 100;

      const liveRawJdCount = dimLineages.filter(l => l.rawJd).length;
      const liveExtractedCount = dimLineages.filter(l => l.kg).length;
      const liveCaptureRate = liveRawJdCount > 0 ? (liveExtractedCount / liveRawJdCount) * 100 : 0.0;

      const weight = POLICY_DIMENSIONS.find(d => d.key === key)?.weight ?? 15;
      const liveMissingCount = dimLineages.filter(l => !l.resolver).length;
      const liveLoss = weight * (liveMissingCount / totalJobs);

      const coverageLift = baseline.coverage > 0 ? liveKgPct / baseline.coverage : liveKgPct > 0 ? Infinity : 1.0;
      const captureLift = baseline.captureRate > 0 ? liveCaptureRate / baseline.captureRate : liveCaptureRate > 0 ? Infinity : 1.0;
      const lossDelta = liveLoss - baseline.expectedLoss;

      console.log(`[${label}]`);
      console.log(`  - KG Coverage            | ${baseline.coverage.toFixed(1).padStart(13)}%   | ${liveKgPct.toFixed(1).padStart(17)}%   | × ${coverageLift.toFixed(2)} Lift`);
      console.log(`  - Evidence Capture Rate  | ${baseline.captureRate.toFixed(1).padStart(13)}%   | ${liveCaptureRate.toFixed(1).padStart(17)}%   | × ${captureLift.toFixed(2)} Lift`);
      console.log(`  - Expected Score Loss    | ${baseline.expectedLoss.toFixed(2).padStart(14)} pts | ${liveLoss.toFixed(2).padStart(18)} pts | ${lossDelta >= 0 ? "+" : ""}${lossDelta.toFixed(2)} pts`);
      console.log("-".repeat(106));
    }

    // C. DECISION STABILITY & UTILITY TELEMETRY
    // Compute recommendations under simulated old baseline state
    const liveAssessments = new Map<string, string>();
    for (const job of jobs) {
      const facts = factsByJob.get(job.id) ?? {};
      const jobSliceDims: Record<string, any> = {};
      for (const [k, v] of Object.entries(facts)) {
        jobSliceDims[k] = { value: v };
      }
      const slice: JobSlice = { jobId: job.id, jobHash: job.fingerprint, graphVersion: "v1", dimensions: jobSliceDims };
      const assess = scorer.score({ profile, policy, job: slice, recommendationRunId: "live" });
      liveAssessments.set(job.id, assess.decision);
    }

    const baselineAssessments = new Map<string, string>();
    for (const job of jobs) {
      let rawText = "";
      const snapPath = path.join(".scraper-artifacts", "snapshots", `${job.fingerprint}.json`);
      if (fs.existsSync(snapPath)) {
        try {
          const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
          rawText = [snap.rawText, snap.detail?.rawText].filter(Boolean).join("\n");
        } catch {}
      }

      const baseFacts: Record<string, any> = {};
      const liveFactsObj = factsByJob.get(job.id) ?? {};
      for (const [k, v] of Object.entries(liveFactsObj)) {
        if (k !== "commercialAccountability" && k !== "mandate" && k !== "reportingLine" && k !== "technologyStack") {
          baseFacts[k] = v;
        }
      }

      if (simulateOldCommercial(rawText)) baseFacts["commercialAccountability"] = "PL_OWNERSHIP";
      if (simulateOldMandate(rawText)) baseFacts["mandate"] = "TRANSFORMATION";
      // reportingLine and technologyStack were missing in 7A.3

      const slice: JobSlice = { jobId: job.id, jobHash: job.fingerprint, graphVersion: "v1", dimensions: {} };
      for (const [k, v] of Object.entries(baseFacts)) {
        slice.dimensions[k] = { value: v };
      }
      const assess = scorer.score({ profile, policy, job: slice, recommendationRunId: "base" });
      baselineAssessments.set(job.id, assess.decision);
    }

    let stayedExcellent = 0;
    let movedUp = 0;
    let movedDown = 0;
    let selfCorrected = 0;
    let newlyScorable = 0;
    let totalChanged = 0;

    const categoriesOrder = ["Needs More Evidence", "Weak Fit", "Average Fit", "Good Fit", "Excellent Fit"];

    for (const job of jobs) {
      const baseDec = baselineAssessments.get(job.id)!;
      const liveDec = liveAssessments.get(job.id)!;

      if (baseDec === liveDec) {
        if (liveDec === "Excellent Fit") stayedExcellent++;
      } else {
        totalChanged++;
        const baseIdx = categoriesOrder.indexOf(baseDec);
        const liveIdx = categoriesOrder.indexOf(liveDec);

        if (baseDec === "Needs More Evidence" && liveDec !== "Needs More Evidence") {
          newlyScorable++;
        } else if (liveDec === "Needs More Evidence" && baseDec !== "Needs More Evidence") {
          selfCorrected++;
        } else if (liveIdx > baseIdx) {
          movedUp++;
        } else if (liveIdx < baseIdx) {
          movedDown++;
        }
      }
    }

    const volatility = (totalChanged / totalJobs) * 100;

    console.log("\n==========================================================================================");
    console.log("                         DECISION STABILITY & VOLATILITY REPORT");
    console.log("==========================================================================================");
    console.log(`  Stayed Excellent              : ${stayedExcellent}`);
    console.log(`  Moved Up (Higher Fit Rank)    : ${movedUp}`);
    console.log(`  Moved Down (Lower Fit Rank)   : ${movedDown}`);
    console.log(`  Self Corrected (Insufficient) : ${selfCorrected}`);
    console.log(`  Newly Scorable (Evidence Add) : ${newlyScorable}`);
    console.log(`  Recommendation Volatility     : ${volatility.toFixed(1)}% (${totalChanged} / ${totalJobs} changed)`);
    console.log("==========================================================================================");

    // D. EVIDENCE UTILITY REPORT
    console.log("\n==========================================================================================");
    console.log("                                  EVIDENCE UTILITY REPORT");
    console.log("==========================================================================================");

    let liveCommercialCount = 0;
    let liveMandateCount = 0;
    let liveReportingCount = 0;
    let liveTechCount = 0;

    let baseCommercialCount = 0;
    let baseMandateCount = 0;

    for (const job of jobs) {
      let rawText = "";
      const snapPath = path.join(".scraper-artifacts", "snapshots", `${job.fingerprint}.json`);
      if (fs.existsSync(snapPath)) {
        try {
          const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
          rawText = [snap.rawText, snap.detail?.rawText].filter(Boolean).join("\n");
        } catch {}
      }
      if (simulateOldCommercial(rawText)) baseCommercialCount++;
      if (simulateOldMandate(rawText)) baseMandateCount++;

      const liveObj = factsByJob.get(job.id) ?? {};
      if (liveObj["commercialAccountability"]) liveCommercialCount++;
      if (liveObj["mandate"]) liveMandateCount++;
      if (liveObj["reportingLine"]) liveReportingCount++;
      if (liveObj["technologyStack"]) liveTechCount++;
    }

    const commAdded = liveCommercialCount - baseCommercialCount;
    const mandAdded = liveMandateCount - baseMandateCount;
    const repAdded = liveReportingCount;
    const techAdded = liveTechCount;

    // Compute utilities
    const commUtility = commAdded > 0 ? (movedUp / commAdded) * 100 : 0.0;
    const repUtility = repAdded > 0 ? (newlyScorable / repAdded) * 100 : 0.0;
    const techUtility = techAdded > 0 ? (movedUp / techAdded) * 100 : 0.0;

    console.log(`  - Commercial Accountability:`);
    console.log(`    Facts Added: ${commAdded.toString().padEnd(4)} | Rec Changes: ${movedUp.toString().padEnd(3)} | Evidence Utility: ${commUtility.toFixed(1)}%`);
    console.log(`  - Reporting Line Hierarchy:`);
    console.log(`    Facts Added: ${repAdded.toString().padEnd(4)} | Rec Changes: ${newlyScorable.toString().padEnd(3)} | Evidence Utility: ${repUtility.toFixed(1)}%`);
    console.log(`  - Technology Stack:`);
    console.log(`    Facts Added: ${techAdded.toString().padEnd(4)} | Rec Changes: ${movedUp.toString().padEnd(3)} | Evidence Utility: ${techUtility.toFixed(1)}%`);
    console.log("==========================================================================================\n");

  } catch (err) {
    console.error("Error executing gap diagnostics:", err);
  } finally {
    db.close();
  }
}

main();
