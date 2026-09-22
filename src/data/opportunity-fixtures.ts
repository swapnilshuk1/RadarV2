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
  memoReviewState?: 'preparing' | 'pending' | 'reviewed' | 'withheld';
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