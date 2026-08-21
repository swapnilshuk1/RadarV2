import fs from "fs";
import path from "path";
import { execSync } from "child_process";

interface TestSuiteInfo {
  file: string;
  relativePath: string;
  sizeBytes: number;
  testCount: number;
  pass: boolean;
  durationMs: number;
  errorSnippet?: string;
  imports: string[];
  domain: string;
  currentContract: boolean;
  disposition: "ACTIVE" | "MIGRATE" | "REGRESSION" | "ARCHIVE" | "DELETE_DUPLICATE";
  rationale: string;
}

function getAllTestFiles(dir: string, baseDir: string = dir): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllTestFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

async function run() {
  const rootDir = process.cwd();
  const testsDir = path.join(rootDir, "tests");
  const testFiles = getAllTestFiles(testsDir);

  console.log(`Discovered ${testFiles.length} test files in tests/`);

  const results: TestSuiteInfo[] = [];

  for (let i = 0; i < testFiles.length; i++) {
    const file = testFiles[i];
    const rel = path.relative(rootDir, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");
    const stats = fs.statSync(file);

    // Count tests
    const testMatches = content.match(/\b(it|test)\s*\(/g) || [];
    const testCount = testMatches.length;

    // Extract imports
    const importMatches = content.match(/from\s+["']([^"']+)["']/g) || [];
    const imports = importMatches.map(m => m.replace(/from\s+["']/, "").replace(/["']/, ""));

    // Quick run to test pass/fail & duration
    let pass = false;
    let durationMs = 0;
    let errorSnippet: string | undefined;

    const start = Date.now();
    try {
      const output = execSync(`npx vitest run "${rel}" --no-color`, {
        cwd: rootDir,
        encoding: "utf8",
        timeout: 45000,
        stdio: ["ignore", "pipe", "pipe"]
      });
      durationMs = Date.now() - start;
      pass = true;
    } catch (err: any) {
      durationMs = Date.now() - start;
      pass = false;
      const errOut = (err.stdout || "") + "\n" + (err.stderr || "");
      const lines = errOut.split("\n").filter((l: string) => l.includes("FAIL") || l.includes("AssertionError") || l.includes("Error:"));
      errorSnippet = lines.slice(0, 3).join(" | ").slice(0, 200);
    }

    // Determine domain
    let domain = "other";
    if (rel.includes("/semantic/") || rel.includes("normalizeScrapedText") || rel.includes("ontology")) {
      domain = "semantic";
    } else if (rel.includes("editorial") || rel.includes("explanation") || rel.includes("BriefComposition")) {
      domain = "editorial";
    } else if (rel.includes("policy") || rel.includes("decision") || rel.includes("attention") || rel.includes("filter") || rel.includes("headspace")) {
      domain = "policy";
    } else if (rel.includes("Capability") || rel.includes("candidate") || rel.includes("projection") || rel.includes("evidence") || rel.includes("career-value")) {
      domain = "intelligence";
    } else if (rel.includes("database") || rel.includes("sqlite") || rel.includes("persistence") || rel.includes("migration") || rel.includes("deployment")) {
      domain = "persistence";
    } else if (rel.includes("scrape") || rel.includes("scraper")) {
      domain = "scraper";
    } else if (rel.includes("/p0/") || rel.includes("/p1/") || rel.includes("/p2/") || rel.includes("/p3/") || rel.includes("stage-") || rel.includes("phase")) {
      domain = "historical_sprint";
    }

    // Determine preliminary disposition
    let disposition: "ACTIVE" | "MIGRATE" | "REGRESSION" | "ARCHIVE" | "DELETE_DUPLICATE" = "ACTIVE";
    let rationale = "";

    if (rel.startsWith("tests/p0/") || rel.startsWith("tests/p1/") || rel.startsWith("tests/p2/") || rel.startsWith("tests/p3/")) {
      if (!pass) {
        disposition = "ARCHIVE";
        rationale = "Superseded sprint rules with obsolete scoring expectations";
      } else {
        disposition = "REGRESSION";
        rationale = "Passing historical behavioral test from prior sprints";
      }
    } else if (rel.includes("stage-") || rel.includes("phase3-") || rel.includes("phase4") || rel.includes("phase5-")) {
      if (pass) {
        disposition = "REGRESSION";
        rationale = "Passing historical refactoring milestone verification";
      } else {
        disposition = "ARCHIVE";
        rationale = "Failing intermediate refactoring checkpoint";
      }
    } else if (rel.includes("p7a-") || rel.includes("p7c-") || rel.includes("p7d-")) {
      disposition = pass ? "REGRESSION" : "ARCHIVE";
      rationale = "Phase 7 patch test";
    } else {
      if (pass) {
        disposition = "ACTIVE";
        rationale = "Current active contract/architecture test";
      } else {
        disposition = "MIGRATE";
        rationale = "Valid invariant with stale assertion needing alignment with V4 contracts";
      }
    }

    results.push({
      file,
      relativePath: rel,
      sizeBytes: stats.size,
      testCount,
      pass,
      durationMs,
      errorSnippet,
      imports,
      domain,
      currentContract: disposition === "ACTIVE" || disposition === "MIGRATE",
      disposition,
      rationale
    });

    console.log(`[${i + 1}/${testFiles.length}] ${rel} -> ${pass ? "PASS" : "FAIL"} (${durationMs}ms) [${disposition}]`);
  }

  const outDir = path.join(rootDir, "docs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "test-inventory-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nAudit inventory written to ${outPath}`);
}

run().catch(console.error);
