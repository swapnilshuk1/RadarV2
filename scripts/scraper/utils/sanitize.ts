// Company-name recovery: keep sanitisation at the scraper boundary so downstream
// enrichment can assume clean rows (per docs/scraper-quick-wins §3, §5).

const INVALID_WORDS = new Set([
  "linkedin", "indeed", "naukri", "guest", "area", "jobs", "job", "hiring",
  "seeking", "recruiting", "recruitment", "careers", "career", "india", "work",
  "office", "remote", "apply", "apply now", "opportunity", "position", "role",
  "team", "company", "employer", "view", "view/job", "the", "an", "a", "search",
  "job listing", "full time", "part time", "join us", "we're hiring",
]);

const KNOWN_CITIES = new Set([
  "bangalore", "bengaluru", "mumbai", "gurgaon", "gurugram", "pune",
  "hyderabad", "chennai", "delhi", "noida", "kolkata", "ahmedabad",
]);

export function isValidExtractedCompany(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (normalized.length < 2 || normalized.length > 60) return false;
  if (INVALID_WORDS.has(normalized)) return false;
  if (KNOWN_CITIES.has(normalized)) return false;
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("?")) return false;
  if (/^\d+$/.test(normalized)) return false;
  return true;
}

function capitalizeWords(str: string): string {
  return str.split(" ").map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

export function sanitizeCompanyName(
  company: string | null | undefined,
  _title: string,
  snippet: string,
  url: string
): string | null {
  let name = (company || "").trim().replace(/\s+/g, " ");
  const lower = name.toLowerCase();
  const invalid =
    !name ||
    lower === "linkedin guest area" ||
    lower === "linkedin" ||
    lower === "linkedin guest" ||
    lower === "indeed guest area" ||
    lower === "naukri guest area";
  if (!invalid && isValidExtractedCompany(name)) return name;

  // URL-based recovery (LinkedIn slug pattern).
  try {
    const decoded = decodeURIComponent(url);
    const m = decoded.match(/-at-([a-zA-Z0-9-]+?)(?:-\d+|\?|$)/i);
    if (m && m[1]) {
      const parsed = m[1].replace(/-/g, " ").trim();
      if (isValidExtractedCompany(parsed)) return capitalizeWords(parsed);
    }
  } catch {
    /* ignore malformed URL */
  }

  // Snippet-based recovery ("... at COMPANY is looking for ...").
  try {
    const m = snippet.match(
      /(?:at|for)\s+([A-Z][a-zA-Z0-9\s.,&]+?)(?:\s+is|\s+in|\s+under|\s+with|\s+to|\s+for|\.|,|$)/
    );
    if (m && m[1]) {
      const parsed = m[1].trim();
      if (isValidExtractedCompany(parsed)) return parsed;
    }
  } catch {
    /* ignore */
  }

  return null;
}
