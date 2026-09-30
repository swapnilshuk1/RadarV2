/**
 * src/pursuit/approval.ts
 *
 * Ledger-backed approval check. Structural completeness (approvalBlockers) is
 * not enough: an edited "$8M" → "$80M" is well-formed but false. Before an
 * artifact is APPROVED, every quantified figure it asserts must be traceable
 * to the candidate's own evidence ledger, and every claim-linked bullet must
 * still point at a live claim whose numbers it has not altered.
 *
 * Pure and portable: no RADAR or database imports.
 */

import { approvalBlockers, type ArtifactContent, type CandidateClaim } from "./types";
import { DIRECT_ONLY_PHRASES } from "./semantic/phrasing";
import type { EvidenceRelationship } from "./semantic/types";

/**
 * Quantified figures that carry factual weight: currency, percentages,
 * multipliers and scale counts. Plain years and small ordinals are ignored.
 */
const FIGURE =
  /(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|mn|bn|b|million|billion|crore|cr|lakh)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:%|x\b|k\b|m\b|mn\b|bn\b|b\b|million|billion|crore|cr\b|lakh|\+))|(?:\b\d{2,}[\d,]*\b)/gi;

export function normalizeFigure(raw: string): string | null {
  const t = raw.toLowerCase().replace(/[\s,]/g, "");
  const m = t.match(/^([$€£₹]?)(\d+(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const [, cur, num, unitRaw] = m;
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  const unit = unitRaw
    .replace(/^(mn|million)$/, "m")
    .replace(/^(bn|billion)$/, "b")
    .replace(/^cr$/, "crore");
  // Four-digit bare numbers between 1950–2100 are almost always years.
  if (!cur && !unit && n >= 1950 && n <= 2100 && Number.isInteger(n)) return null;
  if (!cur && !unit && n < 10) return null;
  return `${cur}${n}${unit}`;
}

export function extractFigures(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(FIGURE) ?? []) {
    const f = normalizeFigure(raw);
    if (f) out.push(f);
  }
  return out;
}

function claimFigures(claim: CandidateClaim): Set<string> {
  const text = [claim.statement, claim.sourceLocator, claim.metricBaseline, claim.metricResult]
    .filter(Boolean)
    .join(" ");
  return new Set(extractFigures(text));
}

export interface LedgerCheckContext {
  claims: CandidateClaim[];
  /** Figures the role/company context legitimately supplies (e.g. team size in the JD). */
  contextText?: string;
  proofRelationships?: Record<string, EvidenceRelationship>;
}

export interface ArtifactApprovalBlocker {
  code: string;
  message: string;
  location?: string;
}

/** The same structural and evidence rules serve preflight and final approval. */
export function evaluateArtifactApproval(content: ArtifactContent, ctx: LedgerCheckContext): {
  approvable: boolean;
  blockers: ArtifactApprovalBlocker[];
} {
  const reasons = [...approvalBlockers(content), ...ledgerApprovalBlockers(content, ctx)];
  const blockers = reasons.map((message): ArtifactApprovalBlocker => {
    const code = /figure|\b\d+[kmb%]|\$|€|£|₹|number/i.test(message)
      ? "UNSUPPORTED_FIGURE"
      : /no longer in your ledger|missing candidate evidence|not linked|cites evidence/i.test(message)
        ? "MISSING_CLAIM"
        : /placeholder/i.test(message)
          ? "UNRESOLVED_PLACEHOLDER"
          : /direct experience wording/i.test(message)
            ? "DIRECT_EVIDENCE_REQUIRED"
            : "INCOMPLETE_CONTENT";
    const location = message.startsWith("The executive summary")
      ? "Resume · executive summary"
      : message.startsWith("The headline")
        ? "Resume · headline"
        : message.startsWith("An impact anchor")
          ? "Resume · selected impact"
          : message.startsWith("A ") && message.includes(" bullet")
            ? `Resume · ${message.slice(2, message.indexOf(" bullet"))} bullet`
            : undefined;
    return { code, message, ...(location ? { location } : {}) };
  });
  return { approvable: blockers.length === 0, blockers };
}

/**
 * Returns blocking reasons when the artifact asserts figures or claim links
 * the ledger does not support. Empty array → approval permitted.
 */
export function ledgerApprovalBlockers(
  content: ArtifactContent,
  ctx: LedgerCheckContext,
): string[] {
  const blockers: string[] = [];
  const byId = new Map(ctx.claims.map((c) => [c.id, c]));
  const ledgerFigures = new Set<string>();
  for (const c of ctx.claims) for (const f of claimFigures(c)) ledgerFigures.add(f);
  const contextFigures = new Set(extractFigures(ctx.contextText ?? ""));

  const checkFreeText = (label: string, text: string, allowContext: boolean) => {
    const unsupported = extractFigures(text).filter((f) => {
      return !ledgerFigures.has(f) && !(allowContext && contextFigures.has(f));
    });
    if (unsupported.length > 0)
      blockers.push(
        `${label} states ${[...new Set(unsupported)].join(", ")}, which your CV evidence does not contain.`,
      );
  };

  if (content.kind === "RESUME") {
    const r = content.resume;
    const bullets = [
      ...r.impactAnchors.map((b) => ({ b, where: "An impact anchor" })),
      ...r.roles.flatMap((role) =>
        role.bullets.map((b) => ({ b, where: `A ${role.employer} bullet` })),
      ),
    ];
    for (const { b, where } of bullets) {
      if (b.claimId) {
        const claim = byId.get(b.claimId);
        if (!claim) {
          blockers.push(`${where} is linked to evidence that is no longer in your ledger.`);
          continue;
        }
        const allowed = claimFigures(claim);
        // Selected-impact lines may include a second claim verbatim. License its
        // figures only while that full source assertion remains in this line.
        for (const companion of ctx.claims) {
          if (
            companion.id !== claim.id &&
            [companion.statement, companion.sourceLocator]
              .filter((value): value is string => Boolean(value))
              .some((value) => b.text.toLowerCase().includes(value.toLowerCase()))
          ) {
            for (const figure of claimFigures(companion)) allowed.add(figure);
          }
        }
        const drift = extractFigures(b.text).filter((f) => !allowed.has(f));
        if (drift.length > 0)
          blockers.push(
            `${where} says ${[...new Set(drift)].join(", ")} but its source evidence says "${claim.statement.slice(0, 140)}".`,
          );
      } else if (b.provenance === "SOURCE_BACKED") {
        blockers.push(`${where} is marked as CV-backed but is not linked to any evidence.`);
      } else {
        checkFreeText(where, b.text, false);
      }
    }
    checkFreeText("The executive summary", r.executiveSummary, false);
    checkFreeText("The headline", r.headline, false);
  }
  if (content.kind === "MESSAGE") {
    checkFreeText("The message", `${content.message.subject ?? ""} ${content.message.body}`, true);
    const message = content.message;
    const assertions = message.proofAssertions ?? [];
    for (const assertion of assertions) {
      if (!message.body.includes(assertion.text)) {
        blockers.push("A message proof link no longer matches its assertion.");
        continue;
      }
      if (assertion.claimIds.length === 0 || assertion.claimIds.some((id) => !byId.has(id)))
        blockers.push("A message assertion cites missing candidate evidence.");
      const allowed = new Set(
        assertion.claimIds.flatMap((id) => (byId.get(id) ? [...claimFigures(byId.get(id)!)] : [])),
      );
      if (extractFigures(assertion.text).some((f) => !allowed.has(f)))
        blockers.push("A message assertion changes a figure from its cited evidence.");
    }
    for (const phrase of DIRECT_ONLY_PHRASES) {
      for (const match of message.body.matchAll(new RegExp(phrase.source, "gi"))) {
        const licensed = assertions.some((assertion) => {
          const start = message.body.indexOf(assertion.text);
          return (
            start >= 0 &&
            match.index >= start &&
            match.index < start + assertion.text.length &&
            assertion.claimIds.some(
              (id) => ctx.proofRelationships?.[id] === "DIRECT" && byId.has(id),
            )
          );
        });
        if (!licensed)
          blockers.push("Direct experience wording needs a DIRECT claim linked to that assertion.");
      }
    }
  }
  if (content.kind === "INTERVIEW_BRIEF") {
    for (const story of content.brief.proofStories) {
      for (const id of story.claimIds)
        if (!byId.has(id))
          blockers.push(`Proof story "${story.title}" cites evidence no longer in your ledger.`);
      const allowed = new Set(
        story.claimIds.flatMap((id) => (byId.get(id) ? [...claimFigures(byId.get(id)!)] : [])),
      );
      if (extractFigures(`${story.scale} ${story.result}`).some((f) => !allowed.has(f)))
        blockers.push(`Proof story "${story.title}" changes a figure from its cited evidence.`);
    }
  }
  return blockers;
}
