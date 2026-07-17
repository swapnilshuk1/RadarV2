/**
 * Operational Data Model
 * Sprint 2: Separating application/operational state from the Domain Knowledge Graph
 */

import type { Provenance } from "./entities";

export interface OperationalEntityBase {
  id: string;
  createdAt: string; // ISO-8601
  provenance: Provenance;
}

// ============================================================================
// Scraper / Runs
// ============================================================================
export interface Run extends OperationalEntityBase {
  type: "Acquisition" | "Extraction" | "Reasoning";
  status: "Started" | "Completed" | "Failed";
  completedAt?: string;
  configSnapshot: any; // The state of the config at the time of the run
  itemsProcessed: number;
  errors: string[];
}

export interface Metric extends OperationalEntityBase {
  runId: string;
  portal: string;
  keyword: string;
  page: number;
  resultsFound: number;
  newOpportunities: number;
  llmCallsMade: number;
}

// ============================================================================
// Benchmarks & QA
// ============================================================================
export interface BenchmarkRun extends OperationalEntityBase {
  datasetVersion: string;
  opportunitiesEvaluated: number;
  overallPrecision: number;
  overallRecall: number;
  hallucinationsDetected: number;
}

// ============================================================================
// Planner (Future-proofing for Sprint 4)
// ============================================================================
export interface PlannerTask extends OperationalEntityBase {
  targetCompanyId?: string;
  targetUrl?: string;
  intent: "Acquire Canonical Listing" | "Search Specific Role" | "Monitor Hiring Velocity";
  status: "Pending" | "Executing" | "Completed" | "Failed";
  scheduledFor: string;
}
