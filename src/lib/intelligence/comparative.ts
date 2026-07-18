// Layer 3 — Comparative Analysis. Runs after ranking over the full sorted
// list. Produces structured comparisons, not prose.

import { dim, type OpportunityIntelligence } from "./schema";

export type TradeOff = { vs: string; gains: string[]; costs: string[] };

export type ComparativeAnalysis = Readonly<{
  higherThan: string[];       // jobHashes ranked below this one
  lowerThan: string[];        // jobHashes ranked above this one
  differentiators: string[];  // dimension keys where this record stands out
  tradeOffs: TradeOff[];
}>;

type Ranked = {
  jobHash: string;
  company: string;
  priority: number;
  oi: OpportunityIntelligence;
};

export function analyseComparatively(ranked: Ranked[]): Map<string, ComparativeAnalysis> {
  const out = new Map<string, ComparativeAnalysis>();
  for (let i = 0; i < ranked.length; i++) {
    const me = ranked[i];
    const higher = ranked.slice(i + 1).map((r) => r.jobHash);
    const lower = ranked.slice(0, i).map((r) => r.jobHash);

    const differentiators: string[] = [];
    for (const d of me.oi.dimensions) {
      if (d.importance !== "Core") continue;
      if (d.bucket !== "Matched") continue;
      // Differentiator = matched Core dimension that a neighbour lacks.
      const neighbour = ranked[i + 1] ?? ranked[i - 1];
      if (!neighbour) continue;
      const other = dim(neighbour.oi, d.key);
      if (!other || other.bucket !== "Matched") differentiators.push(d.key);
    }

    const tradeOffs: TradeOff[] = [];
    const neighbours = [ranked[i - 1], ranked[i + 1]].filter(Boolean) as Ranked[];
    for (const n of neighbours) {
      const gains: string[] = [];
      const costs: string[] = [];
      for (const d of me.oi.dimensions) {
        const other = dim(n.oi, d.key);
        if (!other) continue;
        if (d.bucket === "Matched" && other.bucket !== "Matched") gains.push(d.key);
        if (d.bucket === "Contradicted" && other.bucket !== "Contradicted") costs.push(d.key);
        if (other.bucket === "Matched" && d.bucket !== "Matched") costs.push(d.key);
      }
      if (gains.length || costs.length) {
        tradeOffs.push({ vs: n.company, gains, costs });
      }
    }

    out.set(me.jobHash, {
      higherThan: higher,
      lowerThan: lower,
      differentiators,
      tradeOffs,
    });
  }
  return out;
}