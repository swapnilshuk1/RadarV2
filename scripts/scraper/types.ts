// Shared type contracts across the four pipeline layers:
//   Acquisition  -> JobSnapshot          (raw evidence, portal-native)
//   Extraction   -> ExtractionResult     (deterministic + LLM enrichment)
//   Assembly     -> RecommendationRecord (schema the app consumes)
//   Persistence  -> live-scraped.json    (approved system-of-record view)

import type { PortalAuthSession } from "../../src/lib/security/PortalAuthSession";

export type PortalName = "LinkedIn" | "Indeed" | "Naukri";

export type AcquisitionChannel = "search" | "recommended";

/**
 * A concrete portal execution surface compiled from persisted search intent.
 * Freshness and portal-specific filters belong here, rather than in the
 * canonical SearchDefinition, because they describe how a search is executed.
 */
export interface AcquisitionVariant {
  id?: string;
  definitionId?: string;
  familyId?: string;
  portal?: PortalName;
  query: string;
  requestedTerms?: string[];
  location?: string;
  radiusKm?: number;
  industry?: string;
  department?: string;
  isRemote?: boolean;
  postedWithinDays?: 1 | 7 | 14 | 30;
  sort?: "relevance" | "date";
  channel?: AcquisitionChannel;
}

export type PortalSearchRequest = AcquisitionVariant & { page: number };

export type UnitStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped_gated"
  | "skipped_empty"
  | "skipped_pruned"
  | "aborted";

// ---------- Manifest / Journal ----------

export interface UnitDecisionRecord {
  ruleVersion: string;
  cardsSeen: number;
  cardsParsed: number;
  duplicates: number;
  extractionErrors: number;
  qualified: number | null;
  recommended: number | null;
  newCompanies: number | null;
  decision: "CONTINUE" | "STOP";
  reason: string;
}

export interface WorkUnit {
  id: string;                // portal:kw:page
  portal: PortalName;
  keyword: string;
  page: number;
  status: UnitStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  executionPlanId?: string;  // from ExecutionPlan.json, or adhoc ID
  definitionId?: string;     // attach definition ID for stopping rules
  familyId?: string;         // attach family ID for downstream association
  variant?: AcquisitionVariant;
  cardIds: string[];         // list of card work-unit ids discovered on this page
  decisionRecord?: UnitDecisionRecord;
}

export interface CardUnit {
  id: string;                // <parentUnit>#<cardHash>
  parentUnitId: string;
  cardHash: string;
  status: UnitStatus;
  attempts: number;
  snapshotPath?: string;
  extractionPath?: string;
  error?: string;
  isNew?: boolean;
}

export interface PageExecutionRecord {
  type: "PageExecutionRecord";
  telemetrySchemaVersion: string;
  runId: string;
  executionPlanId: string; // Ensure this is always populated (or synthetic)
  definitionId: string;    // Ensure this is always populated (or synthetic)
  familyId: string;        // Ensure this is always populated (or synthetic)
  plannerVersion: string;
  ruleVersion: string;
  extractorVersion: string;
  promptVersion: string;
  portal: PortalName;
  keyword: string;
  page: number;
  cardsSeen: number;
  cardsParsed: number;
  duplicates: number;
  rejected: number;
  opportunities: number;
  saved: number;
  qualified: number | null; // Always null at acquisition time
  latencyMs: number;
  decision: string;
  decisionReason: string;
  failureReason: string | null;
  timestamp: string;
}

export type RunState =
  | "queued"
  | "initializing"
  | "waiting_for_confirmation"
  | "running"
  | "enriching"
  | "stopping"
  | "completing"
  | "completed"
  | "stopped"
  | "failed"
  | "aborted";

export type HealthScore = "Healthy" | "Slow" | "Degraded" | "Blocked" | "Disabled";

export interface PortalHealth {
  status: "ready" | "error" | "timeout" | "navigating" | "gated"; // Keep for backward compatibility with confirmation UI
  score: number; // 0 to 100 percentage
  details: string;
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  status: RunState;
  scraperVersion: string;
  snapshotSchemaVersion: string;
  extractorVersion: string;
  recommendationSchemaVersion: string;
  keywords: string[];
  portals: PortalName[];
  maxPages: number;
  maxCardsPerPage: number;
  opportunitiesFound?: number;
  evaluatedCount?: number;
  remainingCount?: number;
  stage?: "discover" | "evaluate" | "prioritize" | "complete" | "stopped" | "failed";
  sources?: Record<string, "pending" | "searching" | "completed" | "failed">;
  portalHealth?: Record<string, PortalHealth>;
  recentActivities?: string[];
  telemetry?: {
    httpAttempted: number;
    httpSuccessful: number;
    httpFallbacks: number;
    duplicatePreDetail: number;
    duplicatePostDetail: number;
    llmCalls: number;
    m4ShadowPathSuccess?: number;
    m4ShadowPathFailure?: number;
    canonicalIngestSuccess?: number;
    canonicalIngestFailure?: number;
    canonicalOpportunitiesIngested?: number;
    canonicalOpportunitiesReused?: number;
    newVersionsCreated?: number;
    duplicateVersionsSuppressed?: number;
    candidatesProjected?: number;
    evaluationJobsEnqueued?: number;
  };
  pageExecutionRecords?: PageExecutionRecord[];
  units: WorkUnit[];
  cards: CardUnit[];
}

export type AcquisitionRoute =
  | "DISCOVERY_RICH"
  | "ATS_ENRICHED"
  | "DISCOVERY_FALLBACK_PARTIAL"
  | "DISCOVERY_QUICKAPPLY_PARTIAL"
  | "DETAIL_PAGE_BROWSER"
  | "DETAIL_PAGE_HTTP";

export type EnrichmentStatus =
  | "ENRICHED_SUCCESS"
  | "ENRICHED_FAILED"
  | "NOT_APPLICABLE";

export interface FeedCard {
  cardHash: string;
  portal: PortalName;
  keyword: string;
  searchUrl: string;
  detailUrl: string;
  discoveredAt: string;
  title: string;
  company: string;
  location: string;
  salary?: string;
  postedAt?: string;
  postedPrecision?: "EXACT" | "RELATIVE_ESTIMATE" | "LOWER_BOUND" | "UNKNOWN";
  rawHtml: string;
  rawText: string;
  // Executive Enrichment Metadata
  applyRedirectUrl?: string;
  jobApplyType?: string;
  companyApplyJob?: boolean;
}

// DetailedCard replaces JobSnapshot as the payload post-acquisition
export interface DetailedCard extends FeedCard {
  canonicalJobId?: string;
  snapshotSchemaVersion: string;
  scraperVersion: string;
  acquisitionRoute?: AcquisitionRoute;
  enrichmentStatus?: EnrichmentStatus;
  fallbackRoute?: string;
  detail: {
    fetched: boolean;
    rawHtml?: string;
    rawText?: string;
    fetchError?: string;
    fetchDurationMs?: number;
    httpStatus?: number;
    /** Final destination after a bounded portal navigation. */
    finalUrl?: string;
    quality?: "VALID" | "SPARSE" | "EMPTY" | "ERROR";
    /** Title read from the detail page; distinct from the discovery-card title. */
    extractedTitle?: string;
    extractedCompany?: string;
  };
  acquisitionAttempts?: AcquisitionAttempt[];
  /**
   * Bound after canonical ingestion. This lets a run artifact identify the
   * exact immutable document version evaluated downstream without embedding
   * that document in the journal or duplicating BlobStore payloads.
   */
  evaluationEvidence?: {
    state: "PENDING" | "BOUND" | "UNAVAILABLE";
    canonicalJobId?: string;
    opportunityVersion?: string;
    contentHash?: string;
    sourcePayloadKey?: string | null;
    sourceMediaType?: string | null;
  };
  telemetry: {
    cardExtractMs: number;
    detailExtractMs: number;
    totalMs: number;
  };
}
// ---------- Snapshot (acquisition layer output) ----------

export interface JobSnapshot {
  snapshotSchemaVersion: string;
  scraperVersion: string;
  cardHash: string;              // sha1(portal + canonical url)
  portal: PortalName;
  keyword: string;
  discoveredAt: string;
  searchUrl: string;
  detailUrl: string;
  card: {
    rawHtml: string;
    rawText: string;
    title?: string;
    company?: string;
    location?: string;
    salary?: string;
    postedAtISO?: string;
  };
  detail: {
    fetched: boolean;
    rawHtml?: string;
    rawText?: string;
    fetchError?: string;
    fetchDurationMs?: number;
    quality?: "VALID" | "SPARSE" | "EMPTY" | "ERROR";
  };
  telemetry: {
    cardExtractMs: number;
    detailExtractMs: number;
    totalMs: number;
  };
}

// ---------- Extraction (deterministic + LLM output) ----------

export type EvidenceSource = "title" | "snippet" | "detail" | "url" | "inferred";
export type EvidenceStatus = "Explicit" | "Inferred" | "Missing";
export type Bucket = "Matched" | "Adjacent" | "Missing" | "Contradicted";
export type Importance = "Core" | "Supporting" | "Context";
// Provenance metadata: preferred over a numeric confidence score.
export type Provenance = "explicit" | "inferred" | "llm";
export type Quality = "high" | "medium" | "low";

export interface Evidence {
  quote: string;                 // MUST appear verbatim in rawText
  source: EvidenceSource;
}

export interface DimensionResult {
  key: string;
  label: string;
  importance: Importance;
  bucket: Bucket;
  jdEvidence: {
    value: string | null;
    status: EvidenceStatus;
    evidence: Evidence[];
    provenance: Provenance;
    quality: Quality;
    extractorId?: string;        // which module produced this
  };
  candidateProof: { headline: string; detail: string };
}

export interface ExtractionResult {
  extractorVersion: string;
  promptVersion: string;
  jobHash: string;
  role: string;
  company: string;
  location: string;
  postedRelative: string;
  scrapedFrom: PortalName;
  primaryConcern: string | null;
  applyUrl: string;
  dimensions: DimensionResult[];
  normalizedText: string;
  telemetry: {
    deterministicMs: number;
    llmMs: number;
    llmCalled: boolean;
    llmFallbackReason?: string;
    tokensIn?: number;
    tokensOut?: number;
  };
}

// ---------- Portal handler contract ----------

export interface PortalContext {
  portal: PortalName;
  runId: string;
  keyword: string;
  page: number;
  searchUrl: string;
  variant?: AcquisitionVariant;
  /** Per-run discovery cap. Overrides portal defaults for controlled cohorts. */
  maxCardsPerPage?: number;
  browserContext: any;   // playwright BrowserContext
  searchPage?: any;      // persistent Playwright Page dedicated to search
  detailPage?: any;      // persistent Playwright Page dedicated to details
  searchMutex?: any;     // transaction-scoped Mutex for searchPage
  detailMutex?: any;     // transaction-scoped Mutex for detailPage
  pageManager?: any;     // PageManager instance for ownership-aware page lifecycle
  activePage?: any;      // backward-compatibility reference to searchPage
  authSession?: PortalAuthSession; // JIT authentication session (holds ZERO plaintext secrets)
  logger: (msg: string) => void;
  isHttpDisabled?: (url: string) => boolean;
  recordHttpFailure?: (url: string, reason: string) => void;
  recordTelemetry?: (event: "httpAttempted" | "httpSuccessful" | "httpFallbacks" | "duplicatePreDetail" | "duplicatePostDetail" | "llmCalls" | "m4ShadowPathSuccess" | "m4ShadowPathFailure" | "canonicalIngestSuccess" | "canonicalIngestFailure" | "evaluationJobsEnqueued") => void;
  isCancelled?: () => boolean;
}

export interface PortalHandler {
  name: PortalName;
  detailStrategy: "http" | "browser" | "auto";
  buildSearchUrl(request: PortalSearchRequest | string, page?: number): string;
  ensureSession(ctx: PortalContext): Promise<"ready" | "gated" | "error">;
  listCards(ctx: PortalContext): Promise<FeedCard[]>;
  fetchDetail(ctx: PortalContext, url: string): Promise<DetailedCard["detail"]>;
}

// ---------- Benchmark Suite ----------

export interface BenchmarkValue<T> {
  value: T | null;
  evidence: string;
  confidence?: number;
}

export interface BenchmarkTruth {
  role: BenchmarkValue<string>;
  company: BenchmarkValue<string>;
  location: BenchmarkValue<string>;
  salary: BenchmarkValue<string>;
  mustHave: BenchmarkValue<string>[];
  niceToHave: BenchmarkValue<string>[];
  tools: BenchmarkValue<string>[];
  technologies: BenchmarkValue<string>[];
  leadershipLevel: BenchmarkValue<string>;
  aiExposure: BenchmarkValue<boolean>;
  travel: BenchmarkValue<string>;
  remoteType: BenchmarkValue<string>;
}

export interface ExpectedRecommendation {
  fit: "Excellent" | "Average" | "Poor";
  reason: string[];
}

export interface BenchmarkEntry {
  id: string;                    // unique benchmark id
  cardHash: string;
  portal: PortalName;
  difficulty: "Easy" | "Medium" | "Hard";
  isNegativeExample?: boolean;   // true for internship, spam, etc.
  rawHtml: string;
  rawText: string;
  metadata: {
    originalTitle: string;
    originalCompany: string;
    url: string;
  };
  truth: BenchmarkTruth;
  expectedRecommendation: ExpectedRecommendation;
}

export interface BenchmarkSuite {
  version: string;
  entries: BenchmarkEntry[];
}

// ---------- First-Class Acquisition State & Content Quality Contracts ----------

export type AcquisitionOutcome =
  | "SUCCESS"
  | "SUCCESS_EMPTY"
  | "TRANSPORT_ERROR"
  | "AUTH_ERROR"
  | "ANTI_BOT"
  | "TIMEOUT"
  | "PARSE_ERROR"
  | "SOURCE_REDIRECT"
  | "EXTRACTION_FAILURE";

export type ContentQualityTier = "VALID" | "SPARSE" | "NON_JOB";

export interface ContentQualityResult {
  tier: ContentQualityTier;
  confidence: number;
  wordCount: number;
  characterCount: number;
  codeRatio: number;
  hasJobTitle: boolean;
  hasJobDescription: boolean;
  boilerplateDetected?: string[];
  reasons: string[];
}

export interface AcquisitionAttempt {
  method: string;
  url: string;
  timestamp: string;
  httpStatus?: number;
  outcome: AcquisitionOutcome;
  qualityTier?: ContentQualityTier;
  extractionMethod?: "JSON_LD" | "TARGETED_DOM" | "SANITIZED_DOM" | "FALLBACK_CARD";
  details?: string;
}
