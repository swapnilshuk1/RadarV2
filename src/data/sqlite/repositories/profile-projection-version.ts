import crypto from "node:crypto";
import type { DatabaseAdapter } from "../../database/adapter";
import { validateCandidateProjection, type CandidateProjection } from "../../../lib/domain/candidate_projection";

export interface ExactCandidateProjectionScope {
  tenantId: string;
  personId: string;
}

/**
 * Attach a content-addressed version to the authoritative projection.
 * The version is derived from every projection field except the version itself,
 * so a meaningful evidence change necessarily produces a new profile version.
 */
export function versionCandidateProjection(projection: CandidateProjection): CandidateProjection {
  const profileVersion = projection.profileVersion?.trim() || deriveCandidateProjectionVersion(projection);
  return { ...projection, profileVersion };
}

/** Derives the content-addressed version without trusting a supplied version. */
export function deriveCandidateProjectionVersion(projection: CandidateProjection): string {
  const serialized = canonicalCandidateProjectionContent(projection);
  return `projection-${crypto.createHash("sha256").update(serialized, "utf8").digest("hex")}`;
}

export function canonicalCandidateProjectionContent(projection: CandidateProjection): string {
  const { profileVersion: _ignored, ...versionedContent } = projection;
  return JSON.stringify(sortKeys(versionedContent));
}

/**
 * Resolves only an exact projection pinned by an immutable context.
 *
 * A stored profileVersion is explicit provenance and therefore wins over a
 * derivation. Legacy rows without one are recovered from their canonical
 * content. This deliberately has no chronological/latest fallback.
 */
export function resolveExactCandidateProjection(
  serializedRows: readonly string[],
  expectedProfileVersion: string,
): CandidateProjection | undefined {
  const matches: Array<{ projection: CandidateProjection; canonical: string }> = [];
  for (const serialized of serializedRows) {
    try {
      const projection = JSON.parse(serialized) as CandidateProjection;
      if (!validateCandidateProjection(projection).valid) continue;
      const profileVersion = projection.profileVersion?.trim() || deriveCandidateProjectionVersion(projection);
      if (profileVersion === expectedProfileVersion) {
        matches.push({ projection: { ...projection, profileVersion }, canonical: canonicalCandidateProjectionContent(projection) });
      }
    } catch { /* malformed historical rows are not candidates */ }
  }
  if (matches.length === 0 || matches.some((entry) => entry.canonical !== matches[0].canonical)) return undefined;
  return matches[0].projection;
}

/**
 * Loads an exact immutable projection only after proving the person belongs to
 * the supplied tenant scope. It never selects a newest profile as a fallback.
 */
export async function resolveExactCandidateProjectionForScope(
  db: DatabaseAdapter,
  scope: ExactCandidateProjectionScope,
  expectedProfileVersion: string,
): Promise<CandidateProjection | undefined> {
  const ownedPerson = await db.one<{ id: string }>(
    "SELECT id FROM people WHERE id = ? AND tenant_id = ?",
    [scope.personId, scope.tenantId],
  );
  if (!ownedPerson) return undefined;

  const rows = await db.many<{ projection_json: string }>(
    "SELECT projection_json FROM career_profiles WHERE person_id = ?",
    [scope.personId],
  );
  return resolveExactCandidateProjection(rows.map((row) => row.projection_json), expectedProfileVersion);
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
