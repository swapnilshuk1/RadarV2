/**
 * Artifact validators. Generation may synthesise language; validators decide
 * whether that synthesis is licensed by evidence.
 */

import type {
  CandidateClaim,
  InterviewBriefContent,
  MessageContent,
  ProofStory,
  ResumeContent,
} from "../types";
import { DIRECT_ONLY_PHRASES } from "./phrasing";
import type { EvidenceRelationship } from "./types";

export const LEAKAGE_PATTERNS: RegExp[] = [
  /\bpresent through\b/i,
  /\blead with \d*\s*(quantified|precedent)/i,
  /\bmost relevant precedent\b/i,
  /\bcandidate should\b/i,
  /\bavoid saying\b/i,
  /\bthis lens\b/i,
  /\byour [a-z ]+ lens\b/i,
  /\banchor on what is driving the hire\b/i,
  /\bthen scope, then capability\b/i,
  /\bpositioning:\s/i,
  /\bas the honest gap\b/i,
  /\banchor the answer\b/i,
  /\bname the .* gap yourself\b/i,
  /\bdo not imply\b/i,
];

const PLACEHOLDER = /(reconstruct the situation|state the scope you owned|\[[^\]]+\]|\bTBD\b|\bunknown\b|to be confirmed|lorem)/i;

export interface ValidationIssue {
  code: "LEAKAGE" | "OVERCLAIM" | "PLACEHOLDER" | "ACTION_EQUALS_RESULT" | "TARGET_TITLE_HEADLINE" | "ROLE_TITLE_BULLET" | "SKELETAL_COPY";
  detail: string;
}

export function findLeakage(text: string): string[] {
  return LEAKAGE_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}

export function hasOverclaim(text: string, strongest: EvidenceRelationship): boolean {
  if (strongest === "DIRECT") return false;
  return DIRECT_ONLY_PHRASES.some((p) => p.test(text));
}

const QUANTIFIED_TOKEN =
  /(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|mn|bn|b|million|billion|crore|cr|lakh)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:%|x\b|k\b|m\b|mn\b|bn\b|b\b|million|billion|crore|cr\b|lakh|\+))/gi;
const PROJECTION_WORD = /\b(?:projected|forecast|forecasted|pipeline|target(?:ed)?|expected|potential)\b/i;
const COMPLETION_WORD = /\b(?:secured|closed|won|landed|converted|delivered|generated|achieved|booked)\b/i;

function normalizeMetricToken(value: string): string {
  return value.toLowerCase().replace(/[\s,]/g, "");
}

function quantifiedTokens(value: string): string[] {
  return (value.match(QUANTIFIED_TOKEN) ?? []).map(normalizeMetricToken);
}

/**
 * High-precision semantic inflation checks for generated candidate-facing prose.
 * These deliberately cover only transformations we can prove from the ledger:
 * a projected figure becoming an achieved result, and P&L ownership appearing
 * without any source-backed P&L/profitability fact.
 */
export function findSemanticInflation(
  text: string,
  claims: readonly CandidateClaim[],
): string[] {
  const issues: string[] = [];
  const claimText = claims
    .map((claim) => [claim.statement, claim.sourceLocator, claim.metricBaseline, claim.metricResult]
      .filter(Boolean)
      .join(" "))
    .join("\n");

  const hasSourcePnl = /\b(?:p\s*&\s*l|profit\s+and\s+loss|profitability)\b/i.test(claimText);
  const mentionsPnl = /\bp\s*&\s*l\b/i.test(text);
  const negatedPnl =
    /\b(?:no|not|without|lacks?|lacking|gap\s+in|unproven)\b[^.\n]{0,60}\bp\s*&\s*l\b/i.test(text) ||
    /\bp\s*&\s*l\b[^.\n]{0,60}\b(?:is\s+not|isn't|not\s+evidenced|not\s+source-backed|unproven|remains?\s+a\s+gap|not\s+established)\b/i.test(text);
  if (mentionsPnl && !negatedPnl && !hasSourcePnl)
    issues.push("Positive P&L experience is not source-backed.");

  const projectedMetrics = new Set(
    claims
      .filter((claim) =>
        PROJECTION_WORD.test(
          [claim.statement, claim.sourceLocator, claim.metricBaseline, claim.metricResult]
            .filter(Boolean)
            .join(" "),
        ),
      )
      .flatMap((claim) =>
        quantifiedTokens(
          [claim.statement, claim.sourceLocator, claim.metricBaseline, claim.metricResult]
            .filter(Boolean)
            .join(" "),
        ),
      ),
  );
  if (projectedMetrics.size > 0) {
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      if (!COMPLETION_WORD.test(sentence) || PROJECTION_WORD.test(sentence)) continue;
      const tokens = quantifiedTokens(sentence);
      const inflated = tokens.find((token) => projectedMetrics.has(token));
      if (inflated) issues.push(`Projected metric ${inflated} is stated as an achieved result.`);
    }
  }

  return [...new Set(issues)];
}

export function validateResume(
  resume: ResumeContent,
  targetRoleTitle: string,
  roleTitleClaimIds: ReadonlySet<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of [resume.headline, resume.executiveSummary]) {
    for (const hit of findLeakage(field)) issues.push({ code: "LEAKAGE", detail: hit });
  }
  const title = targetRoleTitle.trim().toLowerCase();
  if (title && resume.headline.toLowerCase().includes(title))
    issues.push({ code: "TARGET_TITLE_HEADLINE", detail: resume.headline });
  for (const anchor of resume.impactAnchors)
    if (anchor.claimId && roleTitleClaimIds.has(anchor.claimId))
      issues.push({ code: "ROLE_TITLE_BULLET", detail: anchor.text });
  const bullets = [...resume.impactAnchors, ...resume.roles.flatMap((role) => role.bullets)];
  const skeletal = bullets.filter((bullet) => bullet.text.trim().split(/\s+/).length < 7);
  if (bullets.length >= 3 && skeletal.length > bullets.length / 2)
    issues.push({ code: "SKELETAL_COPY", detail: "Most résumé bullets are fragments." });
  return issues;
}

export function validateMessage(
  message: MessageContent,
  strongest: EvidenceRelationship,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const text = `${message.subject ?? ""}\n${message.body}`;
  for (const hit of findLeakage(text)) issues.push({ code: "LEAKAGE", detail: hit });
  if (hasOverclaim(text, strongest))
    issues.push({ code: "OVERCLAIM", detail: "DIRECT-only phrasing without DIRECT evidence" });
  return issues;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Stamp READY/INCOMPLETE. READY never carries placeholders or Action == Result. */
export function gradeStory(story: ProofStory): ProofStory {
  const missing = new Set(story.missingFields ?? []);
  const fields: Array<[keyof ProofStory, string]> = [
    ["challenge", "situation / challenge"],
    ["action", "personal intervention"],
    ["result", "attributable result"],
  ];
  for (const [key, label] of fields) {
    const value = String(story[key] ?? "").trim();
    if (!value || PLACEHOLDER.test(value)) missing.add(label);
  }
  if (story.action && story.result && norm(story.action) === norm(story.result))
    missing.add("attributable result (distinct from the action)");
  return {
    ...story,
    status: missing.size === 0 ? "READY" : "INCOMPLETE",
    missingFields: [...missing],
  };
}

export function interviewReady(brief: InterviewBriefContent): boolean {
  return brief.proofStories.length > 0 && brief.proofStories.every((s) => s.status === "READY");
}
