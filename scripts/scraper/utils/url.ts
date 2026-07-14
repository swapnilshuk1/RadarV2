export function normalizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    url.hash = ""; // Strip fragments like #apply

    // Strip common tracking and session parameters
    const paramsToStrip = [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "sid", "session_id", "refId", "trackingId", "trk"
    ];

    for (const param of paramsToStrip) {
      url.searchParams.delete(param);
    }

    return url.toString();
  } catch {
    // If it's not a valid URL (e.g. relative path), just strip fragments manually
    return urlStr.split("#")[0];
  }
}
