/**
 * scripts/eval/v4-simulation/corpus-sampler.ts
 *
 * Stratified Sampler for RADAR V4 Phase 8 Engine Simulation.
 * Selects 120+ real scraped JDs from .scraper-artifacts/extractions/ across 16 categories,
 * 9 seniority tiers, and multiple fit/failure modes while preserving complete original JD texts.
 */

import * as fs from "fs";
import * as path from "path";
import type { OpportunitySource, DimensionResult } from "@/data/opportunity-fixtures";

export interface SampledJD {
  file: string;
  jobHash: string;
  role: string;
  company: string;
  location: string;
  source: string;
  applyUrl: string;
  category: string;
  seniorityTier: string;
  fitSpectrumBucket: string;
  fullJDText: string;
  dimensions: DimensionResult[];
  rawOpportunity: OpportunitySource;
}

const CATEGORIES = [
  "Digital Transformation",
  "Commercial Growth",
  "Product",
  "Product Marketing",
  "Performance Marketing",
  "CRM / MarTech",
  "General Marketing Leadership",
  "Strategy",
  "Operations",
  "Sales / GTM",
  "Technology / Digital",
  "Customer Experience",
  "Consulting",
  "Founder / Entrepreneurial",
  "Private Equity / Portfolio",
  "General Management",
] as const;

export type Category = (typeof CATEGORIES)[number];

function classifyCategory(role: string, text: string): Category {
  const r = (role || "").toLowerCase();
  const t = (text || "").toLowerCase();

  // 1. Digital Transformation
  if (r.includes("transformation") || r.includes("modernization") || t.includes("digital transformation") && (r.includes("digital") || r.includes("lead") || r.includes("director"))) {
    return "Digital Transformation";
  }

  // 2. Product Marketing
  if (r.includes("product marketing") || r.includes("pmm") || (r.includes("product") && r.includes("marketing"))) {
    return "Product Marketing";
  }

  // 3. Performance Marketing
  if (r.includes("performance marketing") || r.includes("growth marketing") || r.includes("paid acquisition") || r.includes("user acquisition") || r.includes("performance media")) {
    return "Performance Marketing";
  }

  // 4. CRM / MarTech
  if (r.includes("crm") || r.includes("martech") || r.includes("retention") || r.includes("lifecycle marketing") || r.includes("marketing automation") || r.includes("loyalty")) {
    return "CRM / MarTech";
  }

  // 5. Commercial Growth
  if (r.includes("growth") || r.includes("commercial") || r.includes("revenue") || r.includes("chief commercial officer") || r.includes("cro") || r.includes("cgo") || r.includes("business growth")) {
    return "Commercial Growth";
  }

  // 6. Product
  if (r.includes("product") || r.includes("cpo") || r.includes("vp product") || r.includes("product owner") || r.includes("product manager") || r.includes("product lead")) {
    return "Product";
  }

  // 7. General Marketing Leadership
  if (r.includes("cmo") || r.includes("marketing") || r.includes("brand") || r.includes("head of marketing") || r.includes("vp marketing")) {
    return "General Marketing Leadership";
  }

  // 8. Strategy
  if (r.includes("strategy") || r.includes("strategic") || r.includes("corporate development") || r.includes("corp dev") || r.includes("chief strategy officer") || r.includes("cso")) {
    return "Strategy";
  }

  // 9. Operations
  if (r.includes("operations") || r.includes("coo") || r.includes("operating") || r.includes("business ops") || r.includes("operational excellence") || r.includes("supply chain")) {
    return "Operations";
  }

  // 10. Sales / GTM
  if (r.includes("sales") || r.includes("gtm") || r.includes("go to market") || r.includes("account executive") || r.includes("business development") || r.includes("head of sales")) {
    return "Sales / GTM";
  }

  // 11. Customer Experience
  if (r.includes("customer experience") || r.includes("cx") || r.includes("client services") || r.includes("customer success") || r.includes("client experience") || r.includes("customer transformation")) {
    return "Customer Experience";
  }

  // 12. Technology / Digital / Non-Commercial Technical
  if (r.includes("software") || r.includes("engineering") || r.includes("cto") || r.includes("architect") || r.includes("tech lead") || r.includes("developer") || r.includes("devops") || r.includes("data science") || r.includes("ai engineer") || r.includes("bim") || r.includes("medical") || r.includes("doctor")) {
    return "Technology / Digital";
  }

  // 13. Consulting
  if (r.includes("consultant") || r.includes("consulting") || r.includes("advisory") || r.includes("partner - practice") || r.includes("principal consultant")) {
    return "Consulting";
  }

  // 14. Founder / Entrepreneurial
  if (r.includes("founder") || r.includes("co-founder") || r.includes("entrepreneur") || r.includes("venture") || r.includes("founding")) {
    return "Founder / Entrepreneurial";
  }

  // 15. Private Equity / Portfolio
  if (r.includes("portfolio") || r.includes("private equity") || r.includes("value creation") || r.includes("operating partner") || r.includes("investment")) {
    return "Private Equity / Portfolio";
  }

  // 16. General Management
  return "General Management";
}

function classifySeniority(role: string, text: string): string {
  const r = (role || "").toLowerCase();
  const t = (text || "").toLowerCase();

  if (r.includes("founder") || r.includes("partner") || r.includes("co-founder")) return "Founder / Partner";
  if (r.includes("chief") || r.includes("cmo") || r.includes("cro") || r.includes("coo") || r.includes("cpo") || r.includes("cgo") || r.includes("cso") || r.includes("cto") || r.includes("c-suite") || r.includes("president &")) return "C-suite";
  if (r.includes("svp") || r.includes("senior vice president")) return "SVP";
  if (r.includes("vp") || r.includes("vice president") || r.includes("head of") || r.includes("head -") || r.includes("executive director")) return "VP";
  if (r.includes("senior director") || r.includes("sr director") || r.includes("sr. director")) return "Senior Director";
  if (r.includes("director")) return "Director";
  if (r.includes("associate director") || r.includes("principal")) return "Associate Director";
  if (r.includes("senior manager") || r.includes("sr manager") || r.includes("sr. manager") || r.includes("lead")) return "Senior Manager";
  if (r.includes("manager") || r.includes("specialist") || r.includes("executive") || r.includes("analyst") || r.includes("coordinator")) return "Manager";

  return "Director"; // default executive baseline
}

function classifyFitSpectrum(role: string, company: string, text: string, category: string, seniority: string): string {
  const r = (role || "").toLowerCase();
  const t = (text || "").toLowerCase();

  if (t.trim().split(/\s+/).length < 25) {
    return "Sparse Spec";
  }

  if (
    category === "Technology / Digital" &&
    (r.includes("medical") || r.includes("superintendent") || r.includes("bim") || r.includes("architect") || r.includes(".net") || r.includes("qa engineer"))
  ) {
    return "Domain Mismatch";
  }

  if (
    (seniority === "C-suite" || seniority === "VP") &&
    (t.includes("2-5 years") || t.includes("2 to 6 years") || t.includes("3-5 years") || t.includes("1-3 years") || t.includes("individual contributor"))
  ) {
    return "Misleading Title";
  }

  if (
    seniority === "Manager" ||
    r.includes("specialist") ||
    r.includes("executive") ||
    r.includes("analyst") ||
    t.includes("5-8 lpa") ||
    t.includes("8-12 lpa")
  ) {
    return "Weak Match / Sub-Tier";
  }

  if (
    (seniority === "Director" || seniority === "VP") &&
    (category === "Commercial Growth" || category === "General Marketing Leadership" || category === "Digital Transformation") &&
    t.includes("p&l") &&
    (t.includes("15+") || t.includes("12+") || t.includes("10+"))
  ) {
    return "Strong Match";
  }

  if (
    (seniority === "Director" || seniority === "Associate Director" || seniority === "Senior Manager") &&
    (category === "Product Marketing" || category === "CRM / MarTech" || category === "Performance Marketing" || category === "Strategy")
  ) {
    return "Adjacent Match";
  }

  if (
    (seniority === "Senior Manager" || seniority === "Associate Director") &&
    (t.includes("growth") || t.includes("marketing"))
  ) {
    return "Career Regression / Easy Trap";
  }

  return "Standard Match";
}

export function sampleCorpus(targetCount: number = 125): SampledJD[] {
  const extractionsDir = path.resolve(process.cwd(), ".scraper-artifacts", "extractions");
  if (!fs.existsSync(extractionsDir)) {
    throw new Error(`Extractions directory not found at: ${extractionsDir}`);
  }

  const files = fs.readdirSync(extractionsDir).filter((f) => f.endsWith(".json"));
  console.log(`Scanning ${files.length} real scraped extraction files from .scraper-artifacts/extractions/ ...`);

  const allJDs: SampledJD[] = [];

  for (const f of files) {
    try {
      const fullPath = path.join(extractionsDir, f);
      const raw = JSON.parse(fs.readFileSync(fullPath, "utf-8"));

      const role = raw.role || "Untitled Opportunity";
      const company = raw.company || "Unknown Company";
      const location = raw.location || "India";
      const source = raw.scrapedFrom || "LinkedIn";
      const applyUrl = raw.applyUrl || "";
      const fullJDText = raw.normalizedText || raw.rawText || raw.description || "";
      const dimensions: DimensionResult[] = Array.isArray(raw.dimensions) ? raw.dimensions : [];

      const category = classifyCategory(role, fullJDText);
      const seniorityTier = classifySeniority(role, fullJDText);
      const fitSpectrumBucket = classifyFitSpectrum(role, company, fullJDText, category, seniorityTier);

      // Build compatible OpportunitySource
      const rawOpportunity: OpportunitySource = {
        id: raw.jobHash || `opp_${f.replace(".json", "")}`,
        jobHash: raw.jobHash || `j-${f.slice(0, 12)}`,
        role,
        company,
        location,
        dimensions,
        rawText: fullJDText,
        normalizedText: fullJDText,
        description: fullJDText,
        applyUrl,
        scrapedFrom: source,
        salary: raw.salary || "Competitive Executive Compensation",
        tags: [category, seniorityTier, fitSpectrumBucket],
        score: null,
      } as any;

      allJDs.push({
        file: f,
        jobHash: rawOpportunity.jobHash,
        role,
        company,
        location,
        source,
        applyUrl,
        category,
        seniorityTier,
        fitSpectrumBucket,
        fullJDText,
        dimensions,
        rawOpportunity,
      });
    } catch (err) {
      // Ignore unparseable files
    }
  }

  console.log(`Parsed ${allJDs.length} valid real JD candidates.`);

  // Stratified Selection Algorithm:
  // We want balanced representation across all 16 categories (~6-9 per category),
  // ensuring seniority diversity and intentional failure modes (sparse, domain mismatch, misleading title, easy trap).

  const selected: SampledJD[] = [];
  const selectedHashes = new Set<string>();

  // 1. First ensure critical failure modes & boundary conditions are included
  const sparseCases = allJDs.filter((j) => j.fitSpectrumBucket === "Sparse Spec");
  for (const s of sparseCases.slice(0, 5)) {
    if (!selectedHashes.has(s.jobHash)) {
      selected.push(s);
      selectedHashes.add(s.jobHash);
    }
  }

  const domainMismatches = allJDs.filter((j) => j.fitSpectrumBucket === "Domain Mismatch");
  for (const d of domainMismatches.slice(0, 10)) {
    if (!selectedHashes.has(d.jobHash)) {
      selected.push(d);
      selectedHashes.add(d.jobHash);
    }
  }

  const misleadingTitles = allJDs.filter((j) => j.fitSpectrumBucket === "Misleading Title");
  for (const m of misleadingTitles.slice(0, 10)) {
    if (!selectedHashes.has(m.jobHash)) {
      selected.push(m);
      selectedHashes.add(m.jobHash);
    }
  }

  const easyTraps = allJDs.filter((j) => j.fitSpectrumBucket === "Career Regression / Easy Trap");
  for (const e of easyTraps.slice(0, 10)) {
    if (!selectedHashes.has(e.jobHash)) {
      selected.push(e);
      selectedHashes.add(e.jobHash);
    }
  }

  // 2. Now fill every category up to target ~7-9 per category
  for (const cat of CATEGORIES) {
    const inCat = allJDs.filter((j) => j.category === cat);
    // Sort by text length & diversity to get rich real JDs
    inCat.sort((a, b) => b.fullJDText.length - a.fullJDText.length);

    let count = selected.filter((s) => s.category === cat).length;
    for (const item of inCat) {
      if (count >= 8) break;
      if (!selectedHashes.has(item.jobHash)) {
        selected.push(item);
        selectedHashes.add(item.jobHash);
        count++;
      }
    }
  }

  // 3. If we still need more to reach targetCount (e.g. 125), pick highest quality diverse items
  if (selected.length < targetCount) {
    const remaining = allJDs.filter((j) => !selectedHashes.has(j.jobHash));
    // Sort by seniority and rich text length
    remaining.sort((a, b) => b.fullJDText.length - a.fullJDText.length);
    for (const item of remaining) {
      if (selected.length >= targetCount) break;
      selected.push(item);
      selectedHashes.add(item.jobHash);
    }
  }

  console.log(`Stratified selection complete: Selected ${selected.length} real JDs.`);
  return selected;
}
