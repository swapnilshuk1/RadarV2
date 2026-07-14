// Convenience entry point — wires the pipeline to the current fixtures.
// Consumers (tests, future UI hooks) import from here.

import { rawOpportunities as authored, type Opportunity, type OpportunitySource } from "@/data/opportunity-fixtures";
import { extraOpportunities } from "@/data/extra-fixtures";
import liveScraped from "../../data/live-scraped.json";
import {
  buildHeadspace,
  loadIdentity,
  loadPreferences,
  loadStrategy,
} from "./candidate";
import { marketFor } from "./market-service";
import { runPipeline } from "./pipeline";
import { present, type Presented } from "./present";
import type { RecommendationRecord } from "./record";
import type { OpportunityIntelligence } from "./schema";

const KEY = "radar.opportunities.v2";

const baseOpportunities = [...authored, ...(liveScraped as OpportunitySource[])];

let memoryCache: OpportunitySource[] | null = null;

export function readOpportunities(): OpportunitySource[] {
  if (typeof window === "undefined") return memoryCache ?? baseOpportunities;
  try {
    const raw = window.localStorage.getItem(KEY);
    const cached = raw ? JSON.parse(raw) : [];
    
    // Merge local storage with freshly imported base opportunities.
    // This ensures that when live-scraped.json updates on disk and Vite reloads,
    // the new items are immediately available without being shadowed by the old cache.
    const merged = new Map<string, OpportunitySource>();
    for (const item of cached) merged.set(item.jobHash, item);
    for (const item of baseOpportunities) merged.set(item.jobHash, item);
    
    return Array.from(merged.values());
  } catch {
    return baseOpportunities;
  }
}

export function writeOpportunities(next: OpportunitySource[]) {
  if (typeof window === "undefined") {
    memoryCache = next;
    return;
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("radar:opportunities"));
  } catch {
    /* ignore */
  }
}

export function addExtraOpportunities() {
  // Fallback for mock data if nothing was scraped
  writeOpportunities(extraOpportunities);
}

export function injectFreshRecords(records: any[]) {
  if (records && records.length > 0) {
    writeOpportunities([...authored, ...(records as OpportunitySource[])]);
  }
}

function toOI(a: OpportunitySource): OpportunityIntelligence {
  return {
    jobHash: a.jobHash,
    role: a.role,
    company: a.company,
    location: a.location,
    postedRelative: a.postedRelative,
    source: a.scrapedFrom,
    applyUrl: a.applyUrl,
    dimensions: a.dimensions,
  };
}

export function runEngine(activePursuits = 0): {
  presented: Presented[];
  records: RecommendationRecord[];
} {
  const currentAuthored = readOpportunities();
  const opportunities = currentAuthored.map(toOI);
  const result = runPipeline({
    opportunities,
    identity: loadIdentity(),
    preferences: loadPreferences(),
    strategy: loadStrategy(),
    market: marketFor,
    headspace: buildHeadspace(activePursuits),
  });

  const byHash = new Map(currentAuthored.map((a) => [a.jobHash, a]));
  const presented = result.records
    .map((r) => {
      const a = byHash.get(r.jobHash);
      return a ? present(a, r) : null;
    })
    .filter((x): x is Presented => x !== null);

  return { presented, records: result.records };
}