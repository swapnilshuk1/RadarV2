// Layer 3 — the ENGINE'S PUBLIC CONTRACT.
//
// Every downstream consumer (Layer 4 Narrative Formatter, Presenter, future
// email / PDF / API renderers) receives exactly one immutable
// RecommendationRecord per opportunity. Everything before it is internal;
// everything after it is presentation.

import type { DecisionVerb } from "@/data/opportunity-fixtures";
import type { PriorityResult } from "./priority";
import type { Stability } from "./stability";
import type { ComparativeAnalysis } from "./comparative";
import type { ExplanationObject } from "./explain";
import type { DecisionTrace } from "./trace";
import type { HeadspaceOutcome } from "./headspace-filter";
import type { DecisionDriver, PipelineStage } from "./policy/DecisionPolicyEngine";
import type { EvidenceMatch, CareerValueBreakdown } from "../domain/semantic";

export const ENGINE_VERSION = "1.0.0";

export type RecommendationRecord = Readonly<{
  jobHash: string;
  engineVersion: string;
  recommendationVersion: string; // fingerprint of inputs + engine
  verb: DecisionVerb;
  priority: number;
  decisionSummary: {
    careerValue: number;
    shortlistingPotential: number;
    pursuitFriction: number;
  };
  decisionDrivers: DecisionDriver[];
  decisionRisks: DecisionDriver[];
  confidences: {
    parsing: number;
    matching: number;
    recommendation: number;
  };
  stability: Stability;
  headspace: HeadspaceOutcome;
  comparison: ComparativeAnalysis;
  explanation: ExplanationObject;
  trace: DecisionTrace & {
    pipeline: PipelineStage[];
    evidenceMapping: EvidenceMatch[];
    careerValueBreakdown: CareerValueBreakdown;
  };
  esi?: number;
  diligenceStatus?: "READY" | "INSUFFICIENT" | "STALE" | "FAILED" | "UNKNOWN";
}>;

/** Deterministic fingerprint of engine + priority + verb so that different
 *  engine versions or scoring changes produce comparable audit trails. */
export function fingerprint(input: {
  jobHash: string;
  priority: number;
  verb: DecisionVerb;
}): string {
  const priorityBucket = Math.round(input.priority * 1000);
  return `${ENGINE_VERSION}:${input.jobHash}:${input.verb}:${priorityBucket}`;
}