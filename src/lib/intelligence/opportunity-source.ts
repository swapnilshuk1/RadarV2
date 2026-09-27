import { rawOpportunities as authored, type OpportunitySource } from "@/data/opportunity-fixtures";

const STORAGE_KEY = "radar.opportunities.v3";

export function readOpportunities(): OpportunitySource[] {
  if (typeof window === "undefined") return authored;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const cached = raw ? (JSON.parse(raw) as OpportunitySource[]) : [];
    const merged = new Map<string, OpportunitySource>();
    for (const item of cached) merged.set(item.jobHash, item);
    for (const item of authored) merged.set(item.jobHash, item);
    return [...merged.values()];
  } catch {
    return authored;
  }
}
