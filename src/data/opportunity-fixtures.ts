// Indian-market fixtures aligned with the golden benchmark cases
// (see tests/ranking/BenchmarkRegression.ts in the archive): BMW India,
// VML, TCS, Acme Corp Mumbai, and the entry-level rejection case.

export type EvidenceSource = "title" | "snippet" | "location" | "llm";
export type Status = "Explicit" | "Inferred" | "Missing";
export type DecisionVerb = "PURSUE" | "CONSIDER" | "PASS";
export type ScrapeSource = "LinkedIn" | "Naukri" | "Indeed";

export type Traced<T> = {
  value: T | null;
  status: Status;
  evidence: { quote: string; source: EvidenceSource }[];
};

export type DimensionKey =
  | "requiredLevel"
  | "reportingLine"
  | "mandate"
  | "commercialAccountability"
  | "functionalScope"
  | "geography"
  | "workModel"
  | "technologyStack";

export type EvidenceBucket = "Matched" | "Adjacent" | "Missing" | "Contradicted";

export type OpportunitySource = Omit<
  Opportunity,
  | "decision"
  | "recommendation"
  | "whyNow"
  | "positioning"
  | "primaryProof"
  | "headspace"
  | "headspaceInvestment"
  | "hiringRisk"
  | "alternativePath"
>;

export type DimensionResult = {
  key: DimensionKey;
  label: string;
  importance: "Core" | "Supporting" | "Context";
  bucket: EvidenceBucket;
  jdEvidence: Traced<string>;
  candidateProof?: { headline: string; detail: string };
};

export interface CapabilityCardViewModel {
  id: string;
  name: string;
  description: string;
  strength: "Strong" | "Moderate" | "Weak";
  score: number;
  scorePercentage: number;
  evidenceQuote: string;
  dimensionLabel: string;
  weight?: number;
  weightedContribution?: number;
}

export interface RecommendationViewModel {
  score: number;
  decision: string;
  policyId: string;
  policyVersion: string;
  explanation: string;
  capabilities: CapabilityCardViewModel[];
}

export type Opportunity = {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  postedRelative: string;
  scrapedFrom: ScrapeSource;
  decision: DecisionVerb;
  recommendation: string;
  /** One sentence answering "why now?" — timing / market moment context. Optional. */
  whyNow?: string;
  primaryConcern: { dimension: DimensionKey; jdQuote: string } | null;
  positioning: string[];
  /** The single strongest career proof point; when set, the brief foregrounds it
   *  and lists the rest as supporting evidence. */
  primaryProof?: { headline: string; detail: string };
  headspace: Array<{ action: string; benefit: string; effort: "Low" | "Medium" | "High" }>;
  /** Optional structured headspace summary used by the brief. Falls back to the
   *  headspace list when absent. */
  headspaceInvestment?: {
    estimateHours: string;   // e.g. "8–12 hours"
    window: string;          // e.g. "over 2 weeks"
    leverage: string;        // highest-leverage action, one sentence
    optional?: string[];     // optional actions, short phrases
  };
  dimensions: DimensionResult[];
  applyUrl?: string;
  hiringRisk: string;
  alternativePath?: string;
  recommendationResult?: RecommendationViewModel;
};

/** Derive the apply URL from the scraped source when a direct one wasn't captured. */
export function applyUrlFor(o: Opportunity): string {
  if (o.applyUrl) return o.applyUrl;
  const q = encodeURIComponent(`${o.role} ${o.company}`);
  switch (o.scrapedFrom) {
    case "LinkedIn":
      return `https://www.linkedin.com/jobs/search/?keywords=${q}&location=India`;
    case "Naukri":
      return `https://www.naukri.com/${encodeURIComponent(o.role.toLowerCase().replace(/\s+/g, "-"))}-jobs`;
    case "Indeed":
      return `https://in.indeed.com/jobs?q=${q}&l=India`;
  }
}

// Helpers to keep fixture rows short.
const jd = (value: string | null, quote: string, source: EvidenceSource = "snippet"): Traced<string> =>
  value === null
    ? { value: null, status: "Missing", evidence: [] }
    : { value, status: "Explicit", evidence: [{ quote, source }] };

const proof = (headline: string, detail: string) => ({ headline, detail });

export const rawOpportunities: OpportunitySource[] = [
  // 1 · PURSUE — golden: BMW India CMO, Gurugram
  {
    jobHash: "j-bmw-india-cmo",
    role: "Chief Marketing Officer (CMO)",
    company: "BMW India",
    location: "Gurugram · India",
    postedRelative: "Posted 2 days ago",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Matched",
        jdEvidence: jd("CMO", "Chief Marketing Officer (CMO)", "title"),
        candidateProof: proof("20+ yrs, VP → CMO trajectory", "Currently VP Marketing / Performance CoE Lead; target titles include CMO, SVP, CGO.") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Matched",
        jdEvidence: jd("MD + Board", "Reports directly to the Managing Director and the Board."),
        candidateProof: proof("Board exposure confirmed", "leadershipProfile.boardExposure = true; board-ready CMO archetype.") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched",
        jdEvidence: jd("Transformation", "Lead the India digital transformation across 22 dealers and CRM."),
        candidateProof: proof("13-market Salesforce CRM reset", "Legacy-to-Salesforce migration across APAC/ME/ANZ/ZA in 12 months — same pattern, larger surface.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Matched",
        jdEvidence: jd("₹1.5 Cr+ P&L", "Own the India marketing P&L (₹1.5 Cr+ scale)."),
        candidateProof: proof("$8M Ford + ₹36 Cr BMW", "Direct P&L on Ford commercial portfolio and BMW 3-year retainer — an order of magnitude above the ask.") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Growth + CRM + Analytics", "Own growth marketing, CRM, and analytics for India."),
        candidateProof: proof("Full capability stack", "capabilities.growth + capabilities.crm + capabilities.analytics.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Gurugram", "Gurugram · India", "location"),
        candidateProof: proof("Preferred location", "preferences.locations lists Gurugram / Delhi NCR first.") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Hybrid", "Hybrid — 3 days in the Gurugram HQ.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Matched",
        jdEvidence: jd("Salesforce CDP", "Deep experience in Salesforce CDP and lifecycle marketing required."),
        candidateProof: proof("SFMC + Salesforce CDP deployed", "Platform-native — already run across 13 markets.") },
    ],
  },

  // 2 · PURSUE — Reliance Retail CGO, Mumbai
  {
    jobHash: "j-reliance-cgo",
    role: "Chief Growth Officer, D2C",
    company: "Reliance Retail",
    location: "Mumbai · India",
    postedRelative: "Posted 4 days ago",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Matched",
        jdEvidence: jd("CxO", "Chief Growth Officer", "title"),
        candidateProof: proof("CGO is on your target list", "strategy.targetTitles includes CGO.") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Matched",
        jdEvidence: jd("CEO", "Reports to the CEO, Reliance Retail Digital."),
        candidateProof: proof("CxO reporting proven", "Prior reporting into CMO / CEO layer at Ford and BMW.") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched",
        jdEvidence: jd("Transformation", "Re-platform Salesforce CRM within 12 months."),
        candidateProof: proof("13-market Salesforce reset in 12 months", "Exact playbook already delivered once.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Matched",
        jdEvidence: jd("D2C P&L", "Owns D2C P&L (₹300 Cr+ topline)."),
        candidateProof: proof("$8M Ford + ₹36 Cr BMW", "Comparable P&L archetype, larger commercial altitude.") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Growth + CRM", "Growth, CRM, and lifecycle marketing."),
        candidateProof: proof("Full capability stack", "capabilities.growth + capabilities.crm explicit.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Mumbai", "Mumbai · India", "location"),
        candidateProof: proof("Preferred location", "preferences.locations includes Mumbai.") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Hybrid", "Hybrid, 3 days in Mumbai HQ.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Matched",
        jdEvidence: jd("Salesforce", "Stack: Salesforce Marketing Cloud, CDP."),
        candidateProof: proof("Platform-native", "Already run across 13 markets.") },
    ],
  },

  // 3 · CONSIDER — golden: VML VP Performance Marketing, Gurugram (Apply This Week)
  {
    jobHash: "j-vml-vp-perf",
    role: "VP Performance Marketing",
    company: "VML India",
    location: "Gurugram · India",
    postedRelative: "Posted 6 days ago",
    scrapedFrom: "Naukri",
    primaryConcern: {
      dimension: "commercialAccountability",
      jdQuote: "Own a $10M+ marketing fee-book across performance channels.",
    },
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Matched",
        jdEvidence: jd("VP", "VP Performance Marketing", "title"),
        candidateProof: proof("VP is on the target list", "strategy.targetTitles includes VP Marketing / Performance.") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Matched",
        jdEvidence: jd("MD India", "Reports to the Managing Director, VML India."),
        candidateProof: proof("CxO reporting proven", "Prior reporting into CMO / CEO layer across Ford and BMW.") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched",
        jdEvidence: jd("GTM + CRM setup", "Requires 12+ years in digital marketing, GTM strategy, and CRM setups."),
        candidateProof: proof("GTM + CRM already delivered", "Legacy-to-Salesforce migration across 13 markets covers both.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Matched",
        jdEvidence: jd("$10M+ fee-book", "Experience managing $10M+ marketing fee-books and performance channels."),
        candidateProof: proof("$8M Ford fee-book precedent", "Order-of-magnitude match; ₹36 Cr BMW retainer extends the archetype.") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Performance + CRM", "Digital marketing, GTM strategy, and CRM setups."),
        candidateProof: proof("Full capability stack", "capabilities.growth + capabilities.crm both explicit.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Gurugram", "Gurugram · India", "location"),
        candidateProof: proof("Preferred location", "preferences.locations includes Gurugram.") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Hybrid", "Hybrid, 3 days in-office.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Matched",
        jdEvidence: jd("Salesforce", "Stack: Salesforce Marketing Cloud, Google Analytics 4."),
        candidateProof: proof("SFMC + CDP deployed", "Platform-native.") },
    ],
  },

  // 4 · CONSIDER — golden: Acme Corp VP Digital Marketing, Mumbai (Monitor Closely — on-site)
  {
    jobHash: "j-acme-vp-mumbai",
    role: "VP Digital Marketing",
    company: "Acme Corp",
    location: "Mumbai · India",
    postedRelative: "Posted 8 days ago",
    scrapedFrom: "Indeed",
    primaryConcern: {
      dimension: "workModel",
      jdQuote: "Must be located in Mumbai office (100% on-site).",
    },
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Matched",
        jdEvidence: jd("VP", "VP Digital Marketing", "title"),
        candidateProof: proof("Current title", "You are VP Marketing already — lateral unless commercial scope grows.") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched",
        jdEvidence: jd("GTM + CRM + Digital", "Experience in GTM, CRM, and digital platforms."),
        candidateProof: proof("All three delivered at Ford", "GTM + Salesforce CRM + digital platform stack — end-to-end.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Digital + CRM", "GTM, CRM, and digital platforms."),
        candidateProof: proof("Full capability stack", "capabilities.growth + capabilities.crm.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Adjacent",
        jdEvidence: jd("Mumbai", "Mumbai · India", "location"),
        candidateProof: proof("Adjacent, not preferred", "preferences.locations lists Gurugram / Delhi NCR first; Mumbai is secondary.") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Contradicted",
        jdEvidence: jd("On-site", "Must be located in Mumbai office (100% on-site)."),
        candidateProof: proof("Hybrid preference violated", "preferences.workModel = hybrid; 100% on-site in Mumbai is out of scope.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Matched",
        jdEvidence: jd("Salesforce", "Stack: Salesforce, GA4."),
        candidateProof: proof("Platform-native", "SFMC + CDP already run at APAC scale.") },
    ],
  },

  // 5 · PASS — golden: TCS Transformation Lead, Bengaluru (level mismatch)
  {
    jobHash: "j-tcs-transformation",
    role: "Transformation Lead",
    company: "Tata Consultancy Services",
    location: "Bengaluru · India",
    postedRelative: "Posted 12 days ago",
    scrapedFrom: "Naukri",
    primaryConcern: {
      dimension: "requiredLevel",
      jdQuote: "Agile transformation lead with 5–8 years experience.",
    },
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Contradicted",
        jdEvidence: jd("5–8 yrs", "5–8 years experience."),
        candidateProof: proof("20 yrs; VP → CMO trajectory", "This is a two-notch downgrade — Scrum / PMO delivery, not executive.") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Adjacent",
        jdEvidence: jd("Agile transformation", "Scrum, PMO, and project management."),
        candidateProof: proof("Transformation family match", "Adjacent theme, wrong altitude.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Adjacent",
        jdEvidence: jd("PMO / delivery", "Scrum, PMO, and project management.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Bengaluru", "Bengaluru · India", "location") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Missing",
        jdEvidence: jd(null, "") },
    ],
  },

  // 6 · PASS — golden: entry-level rejection (Zestlabs — Junior Coordinator, Remote India)
  {
    jobHash: "j-zestlabs-coord",
    role: "Junior Coordinator, Marketing",
    company: "Zestlabs (Seed)",
    location: "Remote · India",
    postedRelative: "Posted 9 days ago",
    scrapedFrom: "Indeed",
    primaryConcern: {
      dimension: "requiredLevel",
      jdQuote: "Entry-level marketing assistant, 0–1 years experience.",
    },
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Contradicted",
        jdEvidence: jd("0–1 yrs", "Entry level marketing assistant with 0–1 years experience."),
        candidateProof: proof("20 yrs — categorical mismatch", "VP → CMO trajectory; this is entry-level and gated out by the rules engine.") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Adjacent",
        jdEvidence: jd("Social + cold email", "Help run social media channels and cold emails.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Adjacent",
        jdEvidence: jd("Social / outbound", "Social media channels and cold emails.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Adjacent",
        jdEvidence: jd("Remote · India", "Remote · India", "location") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Remote", "Fully remote.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Missing",
        jdEvidence: jd(null, "") },
    ],
  },

  // 7 · PURSUE — Tata Digital, Bengaluru
  {
    jobHash: "j-tata-digital-svp",
    role: "SVP Growth & CRM",
    company: "Tata Digital",
    location: "Bengaluru · India",
    postedRelative: "Posted 1 day ago",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Matched",
        jdEvidence: jd("SVP", "SVP Growth & CRM", "title"),
        candidateProof: proof("SVP on target list", "strategy.targetTitles includes SVP.") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Matched",
        jdEvidence: jd("CEO", "Reports to CEO, Tata Digital.") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched",
        jdEvidence: jd("Growth + CRM", "Own growth, CRM, and lifecycle across Tata Neu.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Matched",
        jdEvidence: jd("₹200 Cr+ P&L", "Owns the Tata Neu growth P&L.") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Growth + CRM", "Growth, CRM, lifecycle.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Adjacent",
        jdEvidence: jd("Bengaluru", "Bengaluru · India", "location") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Hybrid", "Hybrid, 3 days in-office.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Matched",
        jdEvidence: jd("Salesforce", "Stack: Salesforce Marketing Cloud + CDP.") },
    ],
  },

  // 8 · CONSIDER — HUL Mumbai
  {
    jobHash: "j-hul-vp-digital",
    role: "VP Digital & E-commerce",
    company: "Hindustan Unilever",
    location: "Mumbai · India",
    postedRelative: "Posted 3 days ago",
    scrapedFrom: "LinkedIn",
    primaryConcern: { dimension: "mandate", jdQuote: "Operate within HUL's category-first brand structure." },
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Matched",
        jdEvidence: jd("VP", "VP Digital & E-commerce", "title") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Matched",
        jdEvidence: jd("CMO", "Reports to CMO, HUL.") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Adjacent",
        jdEvidence: jd("Category-first", "Operate within HUL's category-first brand structure.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Adjacent",
        jdEvidence: jd("D2C P&L", "Indirect P&L via category owners.") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Digital + E-com", "Digital, e-commerce, CRM.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Adjacent",
        jdEvidence: jd("Mumbai", "Mumbai · India", "location") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Hybrid", "Hybrid, 3 days at HUL HQ.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Matched",
        jdEvidence: jd("Salesforce", "Salesforce Marketing Cloud + Adobe Analytics.") },
    ],
  },

  // 9 · CONSIDER — Flipkart Bengaluru
  {
    jobHash: "j-flipkart-vp-growth",
    role: "VP Growth Marketing",
    company: "Flipkart",
    location: "Bengaluru · India",
    postedRelative: "Posted 5 days ago",
    scrapedFrom: "Naukri",
    primaryConcern: { dimension: "geography", jdQuote: "Based in Bengaluru HQ; relocation required." },
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Matched",
        jdEvidence: jd("VP", "VP Growth Marketing", "title") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Matched",
        jdEvidence: jd("CMO", "Reports to CMO, Flipkart.") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched",
        jdEvidence: jd("Growth", "Own India growth marketing across categories.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Matched",
        jdEvidence: jd("Category P&L", "Category-level growth P&L.") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Growth + CRM", "Growth, CRM, lifecycle.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Contradicted",
        jdEvidence: jd("Bengaluru", "Based in Bengaluru HQ; relocation required.", "location") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Hybrid", "Hybrid, 3 days on-site.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Matched",
        jdEvidence: jd("Salesforce CDP", "Salesforce CDP + in-house data platform.") },
    ],
  },

  // 10 · PASS — Snapdeal, senior in title only
  {
    jobHash: "j-snapdeal-head-perf",
    role: "Head of Performance Marketing",
    company: "Snapdeal",
    location: "Delhi NCR · India",
    postedRelative: "Posted 11 days ago",
    scrapedFrom: "Indeed",
    primaryConcern: { dimension: "requiredLevel", jdQuote: "8–10 years of performance marketing experience." },
    dimensions: [
      { key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Contradicted",
        jdEvidence: jd("8–10 yrs", "8–10 years of performance marketing experience.") },
      { key: "reportingLine", label: "Reporting Line", importance: "Core", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "mandate", label: "Mandate", importance: "Core", bucket: "Adjacent",
        jdEvidence: jd("Performance", "Own paid + performance channels.") },
      { key: "commercialAccountability", label: "Commercial Accountability", importance: "Core", bucket: "Missing",
        jdEvidence: jd(null, "") },
      { key: "functionalScope", label: "Functional Scope", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Performance", "Paid + performance.") },
      { key: "geography", label: "Geography", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Delhi NCR", "Delhi NCR · India", "location") },
      { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched",
        jdEvidence: jd("Hybrid", "Hybrid, 3 days in-office.") },
      { key: "technologyStack", label: "Technology Stack", importance: "Context", bucket: "Missing",
        jdEvidence: jd(null, "") },
    ],
  },
];

