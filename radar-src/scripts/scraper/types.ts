// Shared type contracts across the four pipeline layers:
//   Acquisition  -> JobSnapshot          (raw evidence, portal-native)
//   Extraction   -> ExtractionResult     (deterministic + LLM enrichment)
//   Assembly     -> RecommendationRecord (schema the app consumes)
//   Persistence  -> live-scraped.json    (approved system-of-record view)

export type PortalName = "LinkedIn" | "Indeed" | "Naukri";

export type UnitStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped_gated"
  | "skipped_empty";

// ---------- Manifest / Journal ----------

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
  cardIds: string[];         // list of card work-unit ids discovered on this page
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
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed" | "aborted";
  scraperVersion: string;
  snapshotSchemaVersion: string;
  extractorVersion: string;
  recommendationSchemaVersion: string;
  keywords: string[];
  portals: PortalName[];
  maxPages: number;
  maxCardsPerPage: number;
  units: WorkUnit[];
  cards: CardUnit[];
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
  keyword: string;
  page: number;
  searchUrl: string;
  browserContext: any;   // playwright BrowserContext
  logger: (msg: string) => void;
}

export interface CardHandle {
  cardHash: string;
  detailUrl: string;
  extractSnapshot: () => Promise<JobSnapshot>;
}

export interface PortalHandler {
  name: PortalName;
  buildSearchUrl(keyword: string, page: number): string;
  ensureSession(ctx: PortalContext): Promise<"ready" | "gated" | "error">;
  listCards(ctx: PortalContext): Promise<CardHandle[]>;
}
