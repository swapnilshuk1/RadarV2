/**
 * scripts/scraper/run/cheap-filter.ts
 * 
 * Conservative Cheap Pre-Detail Qualification Filter.
 * 
 * GOLDEN RULE:
 * Cheap Filter eliminates unambiguous non-job garbage before queuing for acquisition.
 * It MUST NEVER evaluate candidate fit, capabilities, P&L scale, or strategic suitability—
 * candidate evaluation belongs strictly to RADAR's Evaluation Engine.
 */

export interface CheapFilterInput {
  title: string;
  companyName: string;
  location?: string;
  rawUrl?: string;
}

export interface CheapFilterResult {
  shouldAcquire: boolean;
  reason?: string;
}

export class CheapFilter {
  static evaluate(input: CheapFilterInput): CheapFilterResult {
    const title = (input.title || "").trim();
    const company = (input.companyName || "").trim();

    // 1. Missing Core Metadata Check
    if (!title && !company) {
      return { shouldAcquire: false, reason: "Missing title and company name" };
    }
    if (!title) {
      return { shouldAcquire: false, reason: "Missing title" };
    }
    if (!company) {
      return { shouldAcquire: false, reason: "Missing company name" };
    }

    const normTitle = title.toLowerCase();

    // 2. Unambiguous Non-Executive / Entry-Level / Internship Roles
    const garbageTitleKeywords = [
      "intern",
      "internship",
      "trainee",
      "student",
      "apprentice",
      "junior developer",
      "junior accountant",
      "call center executive",
      "telecaller",
      "data entry operator",
      "fresher"
    ];

    for (const kw of garbageTitleKeywords) {
      if (normTitle.includes(kw)) {
        return { shouldAcquire: false, reason: `Unambiguous non-executive title keyword: "${kw}"` };
      }
    }

    // 3. Unambiguous Non-Job Content Pages
    if (
      normTitle === "job search" ||
      normTitle === "career portal" ||
      normTitle.includes("privacy policy") ||
      normTitle.includes("terms of service")
    ) {
      return { shouldAcquire: false, reason: `Non-job page title: "${title}"` };
    }

    // Default: If in doubt, pass to Acquisition Ledger!
    return { shouldAcquire: true };
  }
}
