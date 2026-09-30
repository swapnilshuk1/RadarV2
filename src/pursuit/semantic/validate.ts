/**
 * Artifact validators. Generation may synthesise language; validators decide
 * whether that synthesis is licensed by evidence.
 */

import type { InterviewBriefContent, MessageContent, ProofStory, ResumeContent } from "../types";
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
