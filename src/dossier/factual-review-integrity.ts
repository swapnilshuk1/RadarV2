import { createHash } from "node:crypto";
import {
  compositionSchema,
  factualReviewReceiptSchema,
  type Dossier,
  type FactualReviewReceipt,
} from "./contracts";
import { allPassages } from "./grounding";

export const FACTUAL_REVIEW_POLICY_VERSION = "memo-facts-v4";
export const DOSSIER_COMPOSITION_RECIPE = "staged-memo-v4.1";
export function reviewFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item,
      ),
    )
    .digest("hex");
}
export function reviewPassages(value: unknown) {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return allPassages(value).flatMap(({ confidence: _confidence, ...passage }, index) =>
    [...segmenter.segment(passage.text)].map(({ segment }, sentence) => ({
      ...passage,
      passageId: `P${index + 1}:S${sentence + 1}`,
      text: segment.trim(),
    })),
  );
}
export function reviewEvidenceFingerprint(
  evidence: unknown[],
  sources: unknown[],
  conflicts: unknown[],
): string {
  return reviewFingerprint({ evidence, sources, conflicts });
}
/** Every current presentation must carry complete, exact-content review receipts.
 * Optional fields on historical DTOs do not relax the current storage boundary.
 */
export function assertFactualReviewProvenance(dossier: Dossier): void {
  const reviewer = dossier.generation.factualReviewer;
  if (!reviewer?.model || reviewer.policyVersion !== FACTUAL_REVIEW_POLICY_VERSION)
    throw new Error("DOSSIER_FACTUAL_REVIEW_REQUIRED");
  const receipts = dossier.generation.factualReviews;
  const keys = Object.keys(compositionSchema.shape) as Array<keyof typeof compositionSchema.shape>;
  if (!receipts || receipts.length !== keys.length)
    throw new Error("DOSSIER_FACTUAL_REVIEW_INCOMPLETE");
  const evidence = [
    ...dossier.evidence.roleClaims,
    ...dossier.evidence.candidateClaims,
    ...dossier.evidence.contextualClaims,
    ...dossier.evidence.relationalClaims,
  ];
  const evidenceFingerprint = reviewEvidenceFingerprint(
    evidence,
    dossier.evidence.lineage,
    dossier.candidateConflicts,
  );
  const seen = new Set<string>();
  for (const raw of receipts) {
    const receipt: FactualReviewReceipt = factualReviewReceiptSchema.parse(raw);
    const key = receipt.section as keyof typeof compositionSchema.shape;
    if (!keys.includes(key) || seen.has(key))
      throw new Error("DOSSIER_FACTUAL_REVIEW_IDENTITY_INVALID");
    seen.add(key);
    const points = dossier.narrativePlan.memoPoints?.filter((p) => p.section === key);
    if (
      !points ||
      receipt.planFingerprint !== reviewFingerprint(points) ||
      JSON.stringify(receipt.coveredPointIds) !== JSON.stringify(points.map((p) => p.id))
    )
      throw new Error("MEMO_COVERAGE_REVIEW_REQUIRED");
    const value = { [key]: dossier[key] };
    if (
      receipt.contentFingerprint !== reviewFingerprint(value) ||
      receipt.evidenceFingerprint !== evidenceFingerprint ||
      receipt.inputFingerprint !== dossier.sourceInputFingerprint ||
      receipt.reviewer !== reviewer.model ||
      receipt.policyVersion !== reviewer.policyVersion ||
      JSON.stringify(receipt.passageIds) !==
        JSON.stringify(reviewPassages(value).map((p) => p.passageId))
    )
      throw new Error("DOSSIER_FACTUAL_REVIEW_BINDING_MISMATCH");
  }
}
