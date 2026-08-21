export type PostingDatePrecision = "EXACT" | "RELATIVE_ESTIMATE" | "LOWER_BOUND" | "UNKNOWN";

export interface NormalizedPostingDate {
  date?: string;
  precision: PostingDatePrecision;
}

/**
 * Date normalization utility for scrapers.
 * Converts relative strings ("2 days ago", "30+ days ago") and standard ISO dates 
 * to absolute UTC ISO strings, while maintaining provenance precision.
 */
export function normalizePostingDate(rawDateStr: string | null | undefined, scrapedAt: string): NormalizedPostingDate {
  if (!rawDateStr) return { precision: "UNKNOWN" };
  const str = rawDateStr.trim().toLowerCase();
  if (str.length === 0) return { precision: "UNKNOWN" };

  const baseTime = new Date(scrapedAt).getTime();
  if (isNaN(baseTime)) return { precision: "UNKNOWN" };

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return { date: d.toISOString(), precision: "EXACT" };
  }

  if (str.includes("just now") || str.includes("today")) {
    return { date: new Date(baseTime).toISOString(), precision: "RELATIVE_ESTIMATE" };
  }

  if (str.includes("yesterday")) {
    return { date: new Date(baseTime - 24 * 60 * 60 * 1000).toISOString(), precision: "RELATIVE_ESTIMATE" };
  }

  const isLowerBound = str.includes("+");

  let match = str.match(/(\d+)\+?\s*(day|hour|minute|week|month|year)s?\s*ago/);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2];
    let offsetMs = 0;
    
    switch (unit) {
      case "minute": offsetMs = val * 60 * 1000; break;
      case "hour": offsetMs = val * 60 * 60 * 1000; break;
      case "day": offsetMs = val * 24 * 60 * 60 * 1000; break;
      case "week": offsetMs = val * 7 * 24 * 60 * 60 * 1000; break;
      case "month": offsetMs = val * 30 * 24 * 60 * 60 * 1000; break;
      case "year": offsetMs = val * 365 * 24 * 60 * 60 * 1000; break;
    }
    
    return { 
      date: new Date(baseTime - offsetMs).toISOString(), 
      precision: isLowerBound ? "LOWER_BOUND" : "RELATIVE_ESTIMATE" 
    };
  }
  
  match = str.match(/(?:posted\s*)?([a-z]{3}\s*\d{1,2}(?:,\s*\d{4})?)/i);
  if (match) {
      const d = new Date(match[1]);
      if (!isNaN(d.getTime())) {
          if (d.getTime() > baseTime) {
             d.setFullYear(d.getFullYear() - 1);
          }
          return { date: d.toISOString(), precision: "EXACT" };
      }
  }

  return { precision: "UNKNOWN" };
}
