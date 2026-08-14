import fs from 'fs';
import path from 'path';
import { readOpportunities } from '../src/lib/intelligence/engine';

function run() {
  const ops = readOpportunities();
  if (!ops || ops.length === 0) {
    console.log('No opportunities returned by readOpportunities() — runEngine or live corpus may be empty.');
    return;
  }
  const results: any[] = [];
  for (const o of ops) {
    const rawText: string = String((o as any).rawText || (o as any).description || '');
    const dims = (o as any).dimensions || [];
    for (const d of dims) {
      const evs = d?.jdEvidence?.evidence || [];
      for (const ev of evs) {
        const quote = String(ev?.quote || '').trim();
        if (!quote) continue;
        const foundInRaw = rawText.toLowerCase().includes(quote.toLowerCase());
        const hasProv = !!ev?.provenance;
        if (!foundInRaw && !hasProv) {
          results.push({ jobHash: o.jobHash, dimension: d.key, quote, rawSnippet: rawText.slice(0, 200), provenance: ev?.provenance });
        }
      }
    }
  }
  if (results.length === 0) {
    console.log('No ungrounded evidence quotes found (all quotes are either in rawText or have explicit provenance).');
  } else {
    console.log(`Found ${results.length} ungrounded evidence quotes:`);
    for (const r of results) console.log(JSON.stringify(r));
  }
}

run();
