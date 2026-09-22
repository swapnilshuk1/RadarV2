// Indian-market fixtures aligned with the golden benchmark cases
// (see tests/ranking/BenchmarkRegression.ts in the archive): BMW India,
// VML, TCS, Acme Corp Mumbai, and the entry-level rejection case.

export type EvidenceSource = "title" | "snippet" | "location" | "llm";
export type Status = "Explicit" | "Inferred" | "Missing";
export type DecisionVerb = "PURSUE" | "CONSIDER" | "PASS" | "UNKNOWN" | "NOT_EVALUABLE" | "SPARSE_SPEC";
export type ScrapeSource = "LinkedIn" | "Naukri" | "Indeed" | "Unknown";

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
  | "functionalCategory"
  | "geography"
  | "workModel"
  | "technologyStack";

export type EvidenceBucket = "Matched" | "Adjacent" | "Missing" | "Contradicted";

export type OpportunitySource = {
  evaluationState?: "LEGACY" | "EVALUATED";
  opportunityVersion?: string;
} & Omit<
  EvaluatedOpportunity,
  | "evaluationState"
  | "decision"
  | "recommendation"
  | "whyNow"
  | "positioning"
  | "primaryProof"
  | "headspace"
  | "headspaceInvestment"
  | "hiringRisk"
  | "alternativePath"
  | "dossierPresentation"
  | "dossierPresentationV2"
> & {
  rawText?: string;
  normalizedText?: string;
  description?: string;
  rawDescription?: string;
  whyNow?: string;
  positioning?: string[];
  primaryProof?: { headline: string; detail: string };
  headspaceInvestment?: {
    estimateHours: string;
    window: string;
    leverage: string;
    optional?: string[];
  };
  hiringRisk?: string;
  alternativePath?: string;
};

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

import type { DecisionConfidence } from "../domain/entities";

export interface RecommendationViewModel {
  score: number | null;
  decision: string;
  policyId: string;
  policyVersion: string;
  explanation: string;
  capabilities: CapabilityCardViewModel[];
  decisionConfidence?: DecisionConfidence;
  vetoed?: boolean;
  vetoReason?: string | null;
}

export type EvaluatedOpportunity = {
  evaluationState: "EVALUATED" | "COMPLETE" | "LEGACY";
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
  esi?: number;
  diligenceStatus?: "READY" | "INSUFFICIENT" | "STALE" | "FAILED" | "UNKNOWN";
  recommendationArchetype?: string;
  recommendationArchetypeTagline?: string;
  mandateArchetype?: string;
  primaryDriver?: string;
  secondaryDriver?: string;
  primaryRisk?: string;
  tailoringEffort?: "LOW" | "MODERATE" | "HIGH";
  capabilityAlignmentText?: string;
  /** P1-F: Executive-facing recommended action based on decision + tailoring effort */
  recommendedAction?: string;

  // RADAR V4 Multi-State Multi-Truth Model
  engineRecommendation?: import("@/domain/decision_v4").EngineRecommendationV4;
  userDecision?: import("@/domain/decision_v4").UserDecisionStateV4 | null;
  effectiveDecision?: import("@/domain/decision_v4").EffectiveDecision;
  reviewWorkflowState?: import("@/domain/decision_v4").ReviewWorkflowState;
  /** Canonical fingerprint freshness, independent of the legacy workflow label. */
  reviewState?: import("@/domain/decision_v4").CanonicalReviewState;
  evaluationContextFingerprint?: string | null;
  evaluationFingerprint?: string | null;
  displayScore?: string;
  uiBadge?: { label: string; variant: "signal" | "caution" | "pass" | "muted" };
  /** Optional evaluation-time presentation only; canonical scalars remain authoritative. */
  dossierPresentation?: import("@/lib/domain/dossier_presentation").CanonicalDossierPresentationV1;
  dossierPresentationV2?: import("@/lib/domain/dossier_presentation").CanonicalDossierPresentationV2;
  richDossier?: import('@/dossier/contracts').Dossier;
  memoReviewState?: 'preparing' | 'preparation_attention' | 'pending' | 'reviewed' | 'withheld';
};

export interface ApplicationAction {
  url: string;
  label: "Apply direct" | "Search LinkedIn" | "Search Naukri" | "Search Indeed";
  isDirect: boolean;
}

/**
 * Produces an application action without ever exposing an internal ingestion
 * placeholder as an external destination. A portal search is intentionally
 * labeled as such when the original posting URL was not captured.
 */
export function applicationActionFor(o: Pick<Opportunity, "applyUrl" | "role" | "company" | "scrapedFrom">): ApplicationAction | undefined {
  if (isExternalPostingUrl(o.applyUrl)) {
    return { url: o.applyUrl, label: "Apply direct", isDirect: true };
  }
  const q = encodeURIComponent(`${o.role} ${o.company}`);
  switch (o.scrapedFrom) {
    case "LinkedIn":
      return { url: `https://www.linkedin.com/jobs/search/?keywords=${q}&location=India`, label: "Search LinkedIn", isDirect: false };
    case "Naukri":
      return { url: `https://www.naukri.com/${encodeURIComponent(o.role.toLowerCase().replace(/\s+/g, "-"))}-jobs`, label: "Search Naukri", isDirect: false };
    case "Indeed":
      return { url: `https://in.indeed.com/jobs?q=${q}&l=India`, label: "Search Indeed", isDirect: false };
  }
}

/** @deprecated Use applicationActionFor when rendering application controls. */
export function applyUrlFor(o: Opportunity): string | undefined {
  return applicationActionFor(o)?.url;
}

// Helpers to keep fixture rows short.
const jd = (value: string | null, quote: string, source: EvidenceSource = "snippet"): Traced<string> =>
  value === null
    ? { value: null, status: "Missing", evidence: [] }
    : { value, status: "Explicit", evidence: [{ quote, source, provenance: "fixture" } as any] };

const proof = (headline: string, detail: string) => ({ headline, detail });

export const rawOpportunities: OpportunitySource[] = [
  // 1 · PURSUE — golden: BMW India CMO, Gurugram
  {
    evaluationState: "LEGACY",
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
    evaluationState: "LEGACY",
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