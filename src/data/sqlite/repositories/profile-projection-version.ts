import crypto from "node:crypto";
import type { CandidateProjection } from "../../../lib/domain/candidate_projection";

/**
 * Attach a content-addressed version to the authoritative projection.
 * The version is derived from every projection field except the version itself,
 * so a meaningful evidence change necessarily produces a new profile version.
 */
export function versionCandidateProjection(projection: CandidateProjection): CandidateProjection {
  const { profileVersion: _ignored, ...versionedContent } = projection;
  const serialized = JSON.stringify(sortKeys(versionedContent));
  const profileVersion = projection.profileVersion?.trim() ||
    `projection-${crypto.createHash("sha256").update(serialized, "utf8").digest("hex")}`;
  return { ...projection, profileVersion };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortKeys(entry)])
  );
}
