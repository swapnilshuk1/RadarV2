/** Deterministic, source-backed metric selection for résumé presentation. */
import { extractFigures } from "./approval";
import type { CandidateClaim, ResumeContent, ResumeMetric } from "./types";

const clean = (value: string) =>
  value.replace(/^\s*(?:[•·▪◼■]|[-–—]|\d+[.)])\s+/, "").replace(/\s+/g, " ").trim();

const displayFigure = (text: string, normalized: string): string => {
  const tokens = text.match(/(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|mn|bn|b|million|billion|crore|cr|lakh)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:%|x\b|k\b|m\b|mn\b|bn\b|b\b|million|billion|crore|cr\b|lakh|\+))|(?:\b\d{2,}[\d,]*\b)/gi) ?? [];
  return tokens.find((token) => extractFigures(token).includes(normalized))?.trim() ?? normalized;
};

const captionFor = (claim: CandidateClaim, value: string): string => {
  const source = clean(claim.statement || claim.sourceLocator || "");
  const escaped = value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const without = clean(source.replace(new RegExp(escaped, "i"), "").replace(/^[-–—:;,\s]+|[-–—:;,\s]+$/g, ""));
  return (without || source).slice(0, 96);
};

export function metricsFromClaims(
  claims: readonly CandidateClaim[],
  limit = 4,
): ResumeMetric[] {
  const out: ResumeMetric[] = [];
  const seenFigures = new Set<string>();
  const seenClaims = new Set<string>();

  for (const claim of claims) {
    if (claim.provenance === "TARGET_CONTEXT" || seenClaims.has(claim.id)) continue;
    seenClaims.add(claim.id);
    const evidence = [claim.metricResult, claim.statement, claim.sourceLocator].filter(Boolean).join(" ");
    for (const normalized of extractFigures(evidence)) {
      if (seenFigures.has(normalized)) continue;
      seenFigures.add(normalized);
      const value = displayFigure(evidence, normalized);
      out.push({ value, caption: captionFor(claim, value), claimId: claim.id });
      if (out.length >= limit) return out;
      break;
    }
  }
  return out;
}

export function metricsFromResume(resume: ResumeContent, limit = 4): ResumeMetric[] {
  const out: ResumeMetric[] = [];
  const seen = new Set<string>();
  for (const bullet of [...resume.impactAnchors, ...resume.roles.flatMap((role) => role.bullets)]) {
    for (const normalized of extractFigures(bullet.text)) {
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const value = displayFigure(bullet.text, normalized);
      const caption = clean(bullet.text.replace(value, "")).replace(/^[-–—:;,\s]+|[-–—:;,\s]+$/g, "").slice(0, 96);
      out.push({ value, caption: caption || bullet.text.slice(0, 96), claimId: bullet.claimId });
      if (out.length >= limit) return out;
      break;
    }
  }
  return out;
}

export function resumeMetrics(resume: ResumeContent, limit = 4): ResumeMetric[] {
  return (resume.metricHighlights?.length ? resume.metricHighlights : metricsFromResume(resume, limit)).slice(0, limit);
}
