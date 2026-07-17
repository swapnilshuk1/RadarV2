// Runs every golden case through the extractor registry, grades the results,
// writes a timestamped report, and gates against baseline Core F1.
import fs from "fs";
import path from "path";
import { getExtractorRegistry } from "../scraper/extract/registry";
import type { JobSnapshot, DimensionResult } from "../scraper/types";
import { EXTRACTOR_VERSION } from "../scraper/versions";
import { gradeCase, summarize, type CaseGrade, type Report } from "./metrics";
import { resolveMode } from "../scraper/enrich/policy";

const ROOT = path.resolve(process.cwd(), "data", "golden");
const CASES_DIR = path.join(ROOT, "cases");
const REPORTS_DIR = path.join(ROOT, "reports");
const BASELINE_PATH = path.join(ROOT, "baseline.json");
const LATEST_PATH = path.join(REPORTS_DIR, "latest.json");

interface Expected {
  role: string;
  company: string;
  dimensions: DimensionResult[];
}

function listCases(): string[] {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => fs.statSync(path.join(CASES_DIR, f)).isDirectory())
    .sort();
}

function runExtractors(snapshot: JobSnapshot) {
  const registry = getExtractorRegistry();
  return { dimensions: registry.map((ex) => ex.extract(snapshot)) };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  const cases = listCases();
  if (cases.length === 0) {
    console.error("No golden cases found. Run: npm run eval:seed");
    process.exit(2);
  }

  const graded: CaseGrade[] = [];
  for (const id of cases) {
    const dir = path.join(CASES_DIR, id);
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir, "snapshot.json"), "utf-8")) as JobSnapshot;
    const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8")) as Expected;
    const candidate = runExtractors(snapshot);
    const rawText = [snapshot.card.rawText, snapshot.detail.rawText].filter(Boolean).join("\n");
    graded.push(gradeCase(id, expected, candidate, rawText));
  }

  const report: Report = summarize(graded, {
    runAt: new Date().toISOString(),
    extractorVersion: EXTRACTOR_VERSION,
    mode: resolveMode(),
    provider: "deterministic-only (eval)",
  });

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const ts = report.runAt.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, `${ts}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(LATEST_PATH, JSON.stringify(report, null, 2));

  console.log("\n=== Extraction QA Report ===");
  console.log(`Cases: ${graded.length}  Dimensions: ${report.totalDimensions}  Anchor violations: ${report.anchorViolations}`);
  for (const tier of ["Core", "Supporting", "Context"] as const) {
    const s = report.perTier[tier];
    console.log(`  ${tier.padEnd(11)}  P=${pct(s.precision)}  R=${pct(s.recall)}  F1=${pct(s.f1)}  (tp=${s.tp} fp=${s.fp} fn=${s.fn})`);
  }
  console.log(`  Overall      P=${pct(report.overall.precision)}  R=${pct(report.overall.recall)}  F1=${pct(report.overall.f1)}`);
  console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);

  // Regression gate against baseline.
  if (fs.existsSync(BASELINE_PATH)) {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as { coreF1: number };
    if (report.perTier.Core.f1 + 1e-9 < baseline.coreF1) {
      console.error(`\nREGRESSION: Core F1 dropped from ${pct(baseline.coreF1)} to ${pct(report.perTier.Core.f1)}`);
      process.exit(1);
    }
    console.log(`Baseline Core F1: ${pct(baseline.coreF1)} (ok)`);
  } else {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({ coreF1: report.perTier.Core.f1, setAt: report.runAt }, null, 2));
    console.log(`Baseline set at Core F1 = ${pct(report.perTier.Core.f1)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
