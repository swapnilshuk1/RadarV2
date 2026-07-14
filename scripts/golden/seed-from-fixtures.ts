// Seeds data/golden/cases/* from the hand-authored fixtures in
// src/data/opportunity-fixtures.ts. Each case gets:
//   jd.txt         — synthesized JD text (role/company/location + all quotes)
//   snapshot.json  — minimal JobSnapshot compatible with the extractor
//   expected.json  — the golden DimensionResult[] to grade against
// Also writes data/golden/index.json listing every case.
import fs from "fs";
import path from "path";
import { rawOpportunities } from "../../src/data/opportunity-fixtures";
import { SCRAPER_VERSION, SNAPSHOT_SCHEMA_VERSION } from "../scraper/versions";
import { jobHash } from "../scraper/utils/hash";

const ROOT = path.resolve(process.cwd(), "data", "golden");
const CASES_DIR = path.join(ROOT, "cases");

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function synthesizeJDText(opp: (typeof rawOpportunities)[number]): string {
  const lines: string[] = [];
  lines.push(`${opp.role}`);
  lines.push(`${opp.company} — ${opp.location}`);
  lines.push(opp.postedRelative);
  lines.push("");
  for (const d of opp.dimensions) {
    for (const e of d.jdEvidence.evidence || []) {
      // Verbatim quote must survive into rawText for anchor.ts to fire.
      lines.push(e.quote);
    }
  }
  return lines.filter(Boolean).join("\n");
}

function toSnapshot(opp: (typeof rawOpportunities)[number], jdText: string) {
  return {
    snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    scraperVersion: SCRAPER_VERSION,
    cardHash: jobHash(opp.role, opp.company),
    portal: opp.scrapedFrom,
    keyword: "golden-seed",
    discoveredAt: new Date(0).toISOString(),
    searchUrl: "about:golden",
    detailUrl: `about:golden/${opp.jobHash}`,
    card: {
      rawHtml: `<pre>${jdText}</pre>`,
      rawText: jdText,
      title: opp.role,
      company: opp.company,
      location: opp.location,
    },
    detail: {
      fetched: true,
      rawHtml: `<pre>${jdText}</pre>`,
      rawText: jdText,
    },
    telemetry: { cardExtractMs: 0, detailExtractMs: 0, totalMs: 0 },
  };
}

function main() {
  fs.mkdirSync(CASES_DIR, { recursive: true });
  const index: { id: string; role: string; company: string; source: string }[] = [];

  for (const opp of rawOpportunities) {
    const id = slugify(`${opp.company}-${opp.role}`);
    const dir = path.join(CASES_DIR, id);
    fs.mkdirSync(dir, { recursive: true });

    const jdText = synthesizeJDText(opp);
    const snapshot = toSnapshot(opp, jdText);
    const expected = {
      jobHash: opp.jobHash,
      role: opp.role,
      company: opp.company,
      location: opp.location,
      scrapedFrom: opp.scrapedFrom,
      dimensions: opp.dimensions,
    };

    fs.writeFileSync(path.join(dir, "jd.txt"), jdText, "utf-8");
    fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
    fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify(expected, null, 2));
    index.push({ id, role: opp.role, company: opp.company, source: opp.scrapedFrom });
    console.log(`seeded  ${id}`);
  }

  fs.writeFileSync(
    path.join(ROOT, "index.json"),
    JSON.stringify(
      {
        seededAt: new Date().toISOString(),
        totalCases: index.length,
        tierWeights: { Core: 3, Supporting: 2, Context: 1 },
        cases: index,
      },
      null,
      2,
    ),
  );
  console.log(`\n${index.length} cases written under ${ROOT}`);
}

main();
