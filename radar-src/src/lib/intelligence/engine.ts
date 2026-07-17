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
    return raw ? JSON.parse(raw) : baseOpportunities;
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
  // Ingest the new jobs and clear out the previous samples entirely
  if (liveScraped && liveScraped.length > 0) {
    writeOpportunities(liveScraped as OpportunitySource[]);
  } else {
    writeOpportunities(extraOpportunities);
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