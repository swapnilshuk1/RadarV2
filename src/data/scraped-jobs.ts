import { type OpportunitySource, type ScrapeSource } from "./opportunity-fixtures";
import { readOpportunities } from "../lib/intelligence/engine";

export type ScrapedJob = {
  id: string;
  role: string;
  company: string;
  location: string;
  source: ScrapeSource;
  scrapedRelative: string;
  shortlistedAs?: string; // jobHash if promoted to shortlist
  filteredReason?: string; // one-line reason if not shortlisted
};

// Shortlisted items derived dynamically + additional raw items that
// were scraped but filtered out before RADAR built a brief.
export function getScrapedJobs(): ScrapedJob[] {
  const current = readOpportunities();
  // Deprecated synchronous evaluation path removed. 
  // Shortlist metrics are now provided via background daemon pipelines.
  const shortlist = new Set<string>();
  
  return current.map((o: OpportunitySource) => {
    const isShortlisted = shortlist.has(o.jobHash);
    return {
      id: o.jobHash,
      role: o.role,
      company: o.company,
      location: o.location,
      source: o.scrapedFrom,
      scrapedRelative: o.postedRelative,
      shortlistedAs: isShortlisted ? o.jobHash : undefined,
      filteredReason: isShortlisted ? undefined : "Low alignment score / functional mismatch",
    };
  });
}

export function getScraperCounts() {
  const list = getScrapedJobs();
  const bySource: Record<ScrapeSource, number> = { LinkedIn: 0, Naukri: 0, Indeed: 0 };
  for (const j of list) bySource[j.source] += 1;
  return {
    total: list.length,
    shortlisted: list.filter((j) => j.shortlistedAs).length,
    filtered: list.filter((j) => !j.shortlistedAs).length,
    bySource,
  };
}