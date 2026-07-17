/**
 * Diagnostic: What text is actually available per document?
 * Answers the question before any recognition report design decisions.
 */
import Database from "better-sqlite3";

const db = new Database("radar.sqlite", { readonly: true });

const rows = db.prepare(
  "SELECT content FROM documents WHERE payload_type = 'Structured'"
).all() as { content: string }[];

let total = 0;
let hasDetailText = 0;
let hasSnippet = 0;
let hasRawText = 0;
let hasTechSnippets = 0;  // stored canonicalValue.snippets in tech dimension
let hasAnyEvidence = 0;   // any jdEvidence.evidence[0].quote
let hasNothing = 0;

const detailTextLengths: number[] = [];
const snippetLengths: number[] = [];

for (const row of rows) {
  let c: any;
  try { c = JSON.parse(row.content); } catch { continue; }
  total++;

  // Check top-level raw text fields
  const dt = c.detailText ?? c.detail_text ?? c.rawText ?? c.raw_text ?? null;
  const sn = c.snippet ?? c.rawSnippet ?? null;
  const rt = c.rawText ?? c.raw_text ?? null;

  if (dt && dt.length > 50)  { hasDetailText++; detailTextLengths.push(dt.length); }
  if (sn && sn.length > 20)  { hasSnippet++; snippetLengths.push(sn.length); }
  if (rt && rt.length > 20)  hasRawText++;

  // Check tech dimension stored snippets
  const dims = Array.isArray(c.dimensions) ? c.dimensions : Object.values(c.dimensions ?? {}) as any[];
  const tech = dims.find((d: any) => d.key === "technologyStack");
  const techSnips = tech?.jdEvidence?.value?.canonicalValue?.snippets;
  if (techSnips?.length > 0 && techSnips[0].length > 10) hasTechSnippets++;

  // Check ANY dimension's evidence quotes (all dimensions, not just tech)
  let foundQuote = false;
  for (const dim of dims) {
    const evs = (dim as any).jdEvidence?.evidence ?? [];
    for (const ev of evs) {
      if (ev.quote && ev.quote.length > 20) { foundQuote = true; break; }
    }
    if (foundQuote) break;
  }
  if (foundQuote) hasAnyEvidence++;

  // No usable text at all?
  if (!dt && !sn && !rt && !techSnips?.length && !foundQuote) hasNothing++;
}

db.close();

const avg = (arr: number[]) => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(0) : "n/a";
const med = (arr: number[]) => {
  if (!arr.length) return "n/a";
  const s = [...arr].sort((a,b)=>a-b);
  return String(s[Math.floor(s.length/2)]);
};

console.log("\n══════════════════════════════════════════════════════════");
console.log("         TEXT AVAILABILITY DIAGNOSTIC");
console.log("══════════════════════════════════════════════════════════");
console.log(`  Total structured documents   : ${total}`);
console.log("");
console.log("  Text source availability:");
console.log(`  ✦ detail_text / detailText   : ${hasDetailText} / ${total}  (${(hasDetailText/total*100).toFixed(1)}%)`);
console.log(`    avg length: ${avg(detailTextLengths)} chars | median: ${med(detailTextLengths)} chars`);
console.log(`  ✦ snippet / rawSnippet       : ${hasSnippet}  / ${total}  (${(hasSnippet/total*100).toFixed(1)}%)`);
console.log(`    avg length: ${avg(snippetLengths)} chars`);
console.log(`  ✦ rawText / raw_text         : ${hasRawText}  / ${total}  (${(hasRawText/total*100).toFixed(1)}%)`);
console.log(`  ✦ tech dimension snippets    : ${hasTechSnippets} / ${total}  (${(hasTechSnippets/total*100).toFixed(1)}%)`);
console.log(`  ✦ any dimension evidence     : ${hasAnyEvidence} / ${total}  (${(hasAnyEvidence/total*100).toFixed(1)}%)`);
console.log(`  ✦ no usable text at all      : ${hasNothing} / ${total}  (${(hasNothing/total*100).toFixed(1)}%)`);
console.log("");

// Sample a document that has any text to see what field names actually exist
const sample = db.prepare("SELECT content FROM documents WHERE payload_type = 'Structured' LIMIT 1").get() as {content:string}|undefined;
if (sample) {
  const c = JSON.parse(sample.content);
  const topLevelKeys = Object.keys(c);
  console.log(`  Top-level content keys: ${topLevelKeys.join(", ")}`);
  const dims = Array.isArray(c.dimensions) ? c.dimensions : Object.values(c.dimensions ?? {}) as any[];
  console.log(`  Dimensions present: ${dims.map((d:any)=>d.key).join(", ")}`);
}

console.log("══════════════════════════════════════════════════════════\n");
