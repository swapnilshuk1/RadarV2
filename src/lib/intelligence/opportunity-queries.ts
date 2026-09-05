/**
 * src/lib/intelligence/opportunity-queries.ts
 *
 * RADAR v2 — Application Query Contract: OpportunityQueries (ADR-SERVING-001).
 *
 * Reclassified from domain port to Application-level Query Contract.
 * Expresses experience queries for executive dashboards, feed pages, metrics aggregation,
 * single-item dossier lookup, and deterministic adjacent navigation.
 *
 * Invariants:
 * 1. Lean Projections: Feed queries return FeedSummary items omitting heavy raw documents and full JSON traces.
 * 2. Keyset Pagination: Cursors are opaque tokens (v1:<base64url>).
 * 3. Scope Enforcement: All operations require AuthorizedPersonScope.
 * 4. Read-Only: 100% side-effect free.
 */

import type { AuthorizedPersonScope } from "../security/auth";
import type { ScrapeSource, ServedOpportunity } from "../../data/opportunity-fixtures";
import type {
  EngineVerdict,
  UserAction,
  EffectiveDecision,
  ReviewWorkflowState,
  CanonicalServingVerdict,
  CanonicalReviewState,
} from "../../domain/decision_v4";
import type { CategoryId } from "../domain/category_taxonomy";
import type { CanonicalOpportunityMetrics } from "./metric-integrity";
import type { OpaqueCursor } from "./cursor";

export type { OpaqueCursor } from "./cursor";

/**
 * Lean DTO for executive opportunity cards on list / feed views.
 * Replaces full 20-60 KB ServedOpportunity objects with a ~500-byte projection.
 */
export interface FeedSummary {
  readonly jobHash: string;
  readonly role: string;
  readonly company: string;
  readonly location: string;
  readonly scrapedFrom: ScrapeSource;
  readonly postedAt?: string | null;
  readonly postedPrecision?: string | null;
  readonly applyUrl?: string | null;
  readonly evaluationState: "COMPLETE" | "EVALUATED" | "SPARSE_SPEC" | "NOT_EVALUABLE" | "PROFILE_REQUIRED" | "INVALID" | "UNMATERIALIZED" | "UNKNOWN";
  readonly engineVerdict?: EngineVerdict | null;
  readonly qualityScore?: number | null;
  /** Context identity is retained separately from the exact reviewed artifact. */
  readonly evaluationContextFingerprint: string | null;
  /** Persisted materialized evaluation provenance; never synthesized at read time. */
  readonly evaluationFingerprint: string | null;
  readonly vetoed: boolean;
  readonly userAction?: UserAction | null;
  readonly reviewedFingerprint: string | null;
  /** Canonical user-facing decision: user action when explicit, otherwise engine verdict. */
  readonly effectiveDecision: CanonicalServingVerdict;
  readonly reviewState: CanonicalReviewState;
  /** @deprecated compatibility label for older UI consumers. */
  readonly reviewWorkflowState: ReviewWorkflowState;
  readonly populationTier: number;
  readonly categoryIds: CategoryId[];
}

/**
 * Keyset-paginated page of executive opportunities.
 */
export interface FeedPage {
  readonly items: readonly FeedSummary[];
  readonly nextCursor: OpaqueCursor;
  readonly totalCount: number;
  readonly hasMore: boolean;
}

/**
 * Query filters for opportunity feeds.
 */
export interface FeedFilters {
  readonly categoryId?: CategoryId;
  readonly decisionFilter?: "all" | "unreviewed" | "decided";
  /**
   * Canonical unreviewed engine shortlist only. This is a server-side
   * membership filter; presentation clients must not reconstruct it.
   */
  readonly shortlistQueue?: boolean;
}

/**
 * Contextual navigation state for single opportunity dossier view.
 */
export interface NavigationContext {
  readonly currentIndex: number;
  readonly totalCount: number;
  readonly prevJobHash?: string;
  readonly nextJobHash?: string;
}

/**
 * Application Query Contract for all opportunity serving surfaces.
 */
export interface OpportunityQueries {
  /**
   * Retrieves a keyset-paginated feed of lean opportunity summaries.
   */
  getFeed(
    scope: AuthorizedPersonScope,
    cursor?: OpaqueCursor,
    filters?: FeedFilters,
    pageSize?: number
  ): Promise<FeedPage>;

  /**
   * Computes holistic executive metrics across the candidate population via SQL aggregation.
   */
  getMetrics(scope: AuthorizedPersonScope): Promise<CanonicalOpportunityMetrics>;

  /**
   * Point lookup for a single opportunity dossier with full narrative and evidence artifacts.
   */
  getDossier(
    scope: AuthorizedPersonScope,
    jobHash: string
  ): Promise<ServedOpportunity | null>;

  /**
   * Point lookup for previous/next adjacent navigation within the filtered population.
   * Returns null if the target jobHash does not exist in the authorized filtered population.
   */
  getNavigation(
    scope: AuthorizedPersonScope,
    jobHash: string,
    filters?: FeedFilters
  ): Promise<NavigationContext | null>;
}
