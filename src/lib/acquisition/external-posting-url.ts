/**
 * A canonical URL is user-facing application evidence, not a persistence
 * placeholder. Internal addresses must never be promoted into that field.
 */
export function isExternalPostingUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname !== "radar.internal" &&
      !url.hostname.endsWith(".internal");
  } catch {
    return false;
  }
}

/** Returns a direct posting URL retained in a structured historical payload. */
export function extractExternalPostingUrl(rawContent: string): string | undefined {
  try {
    const payload = JSON.parse(rawContent) as Record<string, unknown>;
    for (const candidate of [payload.applyUrl, payload.url, payload.detailUrl]) {
      if (isExternalPostingUrl(candidate)) return candidate.trim();
    }
  } catch {
    // Non-JSON job descriptions cannot prove a source URL.
  }
  return undefined;
}
