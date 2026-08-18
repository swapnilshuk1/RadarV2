import fs from "fs";
import path from "path";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";

export interface GoldenDemoCase {
  id: string;
  jobHash: string;
  category: string;
  companyName: string;
  roleTitle: string;
  qualityScore: number | null;
  decisionVerb: string;
  archetype: string;
  bottomLineTLDR: string;
  actionNotice: string;
  freshnessState: string;
  postedRelative: string;
  compState: string;
  salaryDisplay: string;
  platformSignalState: string;
  relationshipState: string;
  provenanceMode: "FIXTURE" | "LOCAL_EXPERIMENT" | "LIVE_AUTHORIZED";
  intelligenceDepth: "HIGH" | "MEDIUM" | "LIMITED" | "UNKNOWN";
  sourceType: string;
}

async function buildGoldenDemoDataset() {
  console.log("==========================================================================");
  console.log("            RADAR v2 — GOLDEN DEMO DATASET GENERATION HARNESS            ");
  console.log("==========================================================================");

  const rawOpps = await OpportunityService.listForUser("swapnil-shukla");

  const categories = [
    { label: "Obvious Winner (PURSUE) + Platform Signal AVAILABLE", filter: (o: any) => o.decision === "PURSUE" && (o.qualityScore ?? 0) >= 75 },
    { label: "Marginal PURSUE + CONVERGENCE", filter: (o: any) => o.decision === "PURSUE" && (o.qualityScore ?? 0) >= 65 && (o.qualityScore ?? 0) <= 72 },
    { label: "High-Value CONSIDER + CONFLICT", filter: (o: any) => o.decision === "CONSIDER" && (o.qualityScore ?? 0) >= 70 },
    { label: "High-Quality PASS + CONFLICT", filter: (o: any) => o.decision === "PASS" && (o.qualityScore ?? 0) >= 65 },
    { label: "Easy Trap CONSIDER + Signal UNAVAILABLE", filter: (o: any) => o.decision === "CONSIDER" && (o.qualityScore ?? 0) < 55 },
    { label: "Founder-led Archetype + PLATFORM_SPECIFIC_SIGNAL", filter: (o: any) => o.archetype === "founder" || (o.role + " " + o.companyName).toLowerCase().includes("founder") },
    { label: "Global Matrix + Greenhouse Direct ATS", filter: (o: any) => (o.role + " " + o.companyName).toLowerCase().includes("global") || (o.role + " " + o.companyName).toLowerCase().includes("vp") },
    { label: "PE-backed Operator + High Intelligence Depth", filter: (o: any) => o.archetype === "pe_operator" || (o.role + " " + o.companyName).toLowerCase().includes("director") },
    { label: "Advisory/Fractional + Signal NOT_APPLICABLE", filter: (o: any) => (o.role + " " + o.companyName).toLowerCase().includes("advisor") || (o.role + " " + o.companyName).toLowerCase().includes("consultant") },
    { label: "SPARSE_SPEC / Limited Intelligence Depth", filter: (o: any) => o.decision === "SPARSE_SPEC" || o.decision === "NOT_EVALUABLE" },
  ];

  const dataset: GoldenDemoCase[] = [];

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    let match = rawOpps.find(cat.filter);
    if (!match) {
      match = rawOpps[i % rawOpps.length];
    }

    const brief = BriefCompositionEngine.compose(match, { bypassHistory: true });

    // Assign P7-A Freshness & Compensation attributes
    let freshnessState = "RECENT";
    let postedRelative = match.postedRelative || "Posted 4 days ago";
    if (i === 3) {
      postedRelative = "Posted 47 days ago";
      freshnessState = "STALE";
    } else if (i === 9) {
      postedRelative = "";
      freshnessState = "UNKNOWN";
    }

    let compState = "UNKNOWN";
    let salaryDisplay = "Compensation: Not Disclosed";
    if (i === 0 || i === 1) {
      compState = "KNOWN";
      salaryDisplay = "Salary Disclosed · ₹1.8 Cr – ₹2.4 Cr";
    } else if (i === 2 || i === 6) {
      compState = "ESTIMATED";
      salaryDisplay = "Market Estimate · ₹1.5 Cr – ₹2.2 Cr (Payscale Benchmark)";
    }

    // Assign P7-D Platform Provenance & Depth attributes
    let platformSignalState = "AVAILABLE";
    let relationshipState = "CONVERGENCE";
    let provenanceMode: "FIXTURE" | "LOCAL_EXPERIMENT" | "LIVE_AUTHORIZED" = "LOCAL_EXPERIMENT";
    let intelligenceDepth: "HIGH" | "MEDIUM" | "LIMITED" | "UNKNOWN" = "HIGH";
    let sourceType = "LinkedIn";

    if (i === 0) {
      platformSignalState = "AVAILABLE";
      relationshipState = "CONVERGENCE";
      provenanceMode = "LOCAL_EXPERIMENT";
      intelligenceDepth = "HIGH";
    } else if (i === 2 || i === 3) {
      platformSignalState = "AVAILABLE";
      relationshipState = "CONFLICT";
      provenanceMode = "LOCAL_EXPERIMENT";
      intelligenceDepth = "HIGH";
    } else if (i === 4) {
      platformSignalState = "UNAVAILABLE";
      relationshipState = "MISSING";
      provenanceMode = "FIXTURE";
      intelligenceDepth = "MEDIUM";
    } else if (i === 5) {
      platformSignalState = "AVAILABLE";
      relationshipState = "PLATFORM_SPECIFIC_SIGNAL";
      provenanceMode = "LOCAL_EXPERIMENT";
      intelligenceDepth = "HIGH";
    } else if (i === 6) {
      platformSignalState = "AVAILABLE";
      relationshipState = "CONVERGENCE";
      provenanceMode = "LIVE_AUTHORIZED";
      intelligenceDepth = "HIGH";
      sourceType = "Greenhouse Direct ATS";
    } else if (i === 8) {
      platformSignalState = "NOT_APPLICABLE";
      relationshipState = "MISSING";
      provenanceMode = "FIXTURE";
      intelligenceDepth = "MEDIUM";
    } else if (i === 9) {
      platformSignalState = "UNKNOWN";
      relationshipState = "MISSING";
      provenanceMode = "FIXTURE";
      intelligenceDepth = "LIMITED";
      sourceType = "Scraped Spec";
    }

    const demoCase: GoldenDemoCase = {
      id: `golden-${i + 1}`,
      jobHash: match.jobHash || `hash-${i + 1}`,
      category: cat.label,
      companyName: match.companyName || match.company_id || "Enterprise Partner",
      roleTitle: match.role || match.canonical_title || "Executive Role",
      qualityScore: brief.qualityScore,
      decisionVerb: match.decision || brief.verdictGuidance.primaryVerb,
      archetype: match.archetype || "corporate_leader",
      bottomLineTLDR: brief.oneMinuteTLDR.bottomLine,
      actionNotice: brief.verdictGuidance.actionNotice,
      freshnessState,
      postedRelative,
      compState,
      salaryDisplay,
      platformSignalState,
      relationshipState,
      provenanceMode,
      intelligenceDepth,
      sourceType,
    };

    dataset.push(demoCase);
    console.log(`✓ [${demoCase.category}] -> ${demoCase.companyName} | ${demoCase.roleTitle} | Signal: ${platformSignalState} | Rel: ${relationshipState} | Prov: ${provenanceMode} | Depth: ${intelligenceDepth}`);
  }

  const outputPath = path.join(process.cwd(), "src", "data", "golden_demo_dataset.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2), "utf-8");

  console.log(`\n✅ Saved Golden Demo Dataset (${dataset.length} cases) to ${outputPath}`);
  console.log("==========================================================================");
}

buildGoldenDemoDataset().catch(console.error);
