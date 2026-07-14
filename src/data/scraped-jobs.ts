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
  return [
    ...current.map((o: OpportunitySource) => ({
      id: o.jobHash,
      role: o.role,
      company: o.company,
      location: o.location,
      source: o.scrapedFrom,
      scrapedRelative: o.postedRelative,
      shortlistedAs: o.jobHash,
    })),
    { id: "s-01", role: "Head of Digital Marketing", company: "Maruti Suzuki", location: "Gurugram · India", source: "Naukri", scrapedRelative: "Scraped 1 day ago", filteredReason: "Head-of scope below VP+ threshold" },
    { id: "s-02", role: "Growth Marketing Manager", company: "Zomato", location: "Gurugram · India", source: "LinkedIn", scrapedRelative: "Scraped 2 days ago", filteredReason: "Manager level — target list starts at VP" },
    { id: "s-03", role: "Regional CMO, MENA", company: "Landmark Group", location: "Dubai · UAE", source: "LinkedIn", scrapedRelative: "Scraped 3 days ago", filteredReason: "Geography outside preferred India set" },
    { id: "s-04", role: "SVP Brand & Communications", company: "Times Network", location: "Delhi NCR · India", source: "Naukri", scrapedRelative: "Scraped 4 days ago", filteredReason: "Brand-only remit; no growth / CRM anchor" },
    { id: "s-05", role: "VP Product Marketing", company: "Freshworks", location: "Bengaluru · India", source: "Indeed", scrapedRelative: "Scraped 5 days ago", filteredReason: "Product marketing, not growth ownership" },
    { id: "s-06", role: "Regional Marketing Lead, SEA", company: "Byju's International", location: "Singapore", source: "LinkedIn", scrapedRelative: "Scraped 5 days ago", filteredReason: "Geography outside preferred India set" },
    { id: "s-07", role: "Chief Marketing Officer", company: "LinkedIn Guest Area", location: "Bengaluru · India", source: "Naukri", scrapedRelative: "Scraped 6 days ago", filteredReason: "Company name unresolved — sanitizer discarded listing" },
    { id: "s-08", role: "Head of Performance Marketing", company: "Nykaa", location: "Mumbai · India", source: "Indeed", scrapedRelative: "Scraped 7 days ago", filteredReason: "Functional depth match but level below VP" },
    { id: "s-09", role: "Marketing Director, EMEA", company: "Wipro", location: "London · UK", source: "LinkedIn", scrapedRelative: "Scraped 9 days ago", filteredReason: "Level and geography both out of scope" },
  ];
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