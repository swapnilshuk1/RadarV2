import * as fs from "fs";
import * as path from "path";

interface TestFileInfo {
  filePath: string;
  relativePath: string;
  testCount: number;
  assertionCount: number;
  dbType: "PURE_TS" | "IN_MEMORY_SQLITE" | "TURSO_CLOUD";
  canonicalDomain: string;
  status: "KEEP" | "MODERNIZE" | "MERGE" | "ARCHIVE" | "DELETE" | "REVIEW";
  productionModules: string[];
  invariants: string[];
  inCertificationGate: boolean;
  notes: string;
}

function classifyDomain(relPath: string, content: string): string {
  if (relPath.includes("certification/")) return "Certification Integrity";
  if (relPath.includes("editorial/") || relPath.includes("editorial")) return "Editorial / Verdict Governance";
  if (relPath.includes("security/") || relPath.includes("tenant") || relPath.includes("scope-resolver")) return "Security & Tenant Isolation";
  if (relPath.includes("serving/") || relPath.includes("cursor") || relPath.includes("keyset")) return "Serving & Pagination";
  if (relPath.includes("metric") || relPath.includes("portal-breakdown")) return "Metrics & Aggregation";
  if (relPath.includes("decision") || relPath.includes("decisions")) return "Decision Persistence";
  if (relPath.includes("identity") || relPath.includes("candidate-profile") || relPath.includes("candidate_projection")) return "Identity & Candidate Projection";
  if (relPath.includes("semantic") || relPath.includes("ontology") || relPath.includes("grounding") || relPath.includes("normalization")) return "Semantic Grounding";
  if (relPath.includes("ingestion") || relPath.includes("acquisition") || relPath.includes("scraper") || relPath.includes("portal")) return "Ingestion & Lineage";
  if (relPath.includes("policy") || relPath.includes("evaluation") || relPath.includes("scorer") || relPath.includes("veto")) return "Evaluation & Policy";
  if (relPath.includes("journey") || relPath.includes("ui") || relPath.includes("routes")) return "UI / User Journeys";
  return "Evaluation & Policy";
}

function scanTestFiles(): TestFileInfo[] {
  const testsDir = path.resolve(process.cwd(), "tests");
  const testFiles: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        testFiles.push(full);
      }
    }
  }

  walk(testsDir);

  const certifyScript = fs.readFileSync(path.resolve(process.cwd(), "scripts/certify.ts"), "utf-8");

  const results: TestFileInfo[] = [];

  for (const file of testFiles) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf-8");

    // Match both it(...) and test(...)
    const itMatches = content.match(/\b(it|test)\s*\(/g) || [];
    const expectMatches = content.match(/\bexpect\s*\(/g) || [];

    let dbType: "PURE_TS" | "IN_MEMORY_SQLITE" | "TURSO_CLOUD" = "PURE_TS";
    if (content.includes("getDatabaseAdapter") || content.includes("@/data/database") || content.includes("better-sqlite3") || content.includes("sqlite3")) {
      if (content.includes(":memory:") || content.includes("new Database(") || content.includes("TestSqliteAdapter")) {
        dbType = "IN_MEMORY_SQLITE";
      } else {
        dbType = "TURSO_CLOUD";
      }
    }

    const inCert = certifyScript.includes(path.basename(file)) || (rel.startsWith("tests/certification/") && certifyScript.includes("tests/certification/")) || (rel.startsWith("tests/serving/") && certifyScript.includes("tests/serving/")) || (rel.startsWith("tests/editorial/") && certifyScript.includes("tests/editorial/"));

    const domain = classifyDomain(rel, content);

    // Extract describe blocks and test names as invariants
    const testNames: string[] = [];
    const testNameRegex = /\b(it|test)\s*\(\s*["'`](.*?)["'`]/g;
    let match;
    while ((match = testNameRegex.exec(content)) !== null) {
      testNames.push(match[2]);
    }

    // Extract imported production modules
    const importRegex = /from\s+["'`](@\/.*|\.\.\/src\/.*)["'`]/g;
    const modules: string[] = [];
    let impMatch;
    while ((impMatch = importRegex.exec(content)) !== null) {
      modules.push(impMatch[1]);
    }

    let status: "KEEP" | "MODERNIZE" | "MERGE" | "ARCHIVE" | "DELETE" | "REVIEW" = "KEEP";
    let notes = "Active domain test";

    if (rel.startsWith("tests/archive/")) {
      status = "ARCHIVE";
      notes = "Already archived historical test";
    } else if (itMatches.length === 0 || expectMatches.length === 0) {
      status = "DELETE";
      notes = "Zero active test blocks or assertions";
    } else if (inCert) {
      status = "KEEP";
      notes = "Permanent continuous certification gate test";
    } else if (rel.includes("/regression/p") || rel.includes("for4")) {
      status = "REVIEW";
      notes = "Historical milestone test; review for active invariant overlap";
    }

    results.push({
      filePath: file,
      relativePath: rel,
      testCount: itMatches.length,
      assertionCount: expectMatches.length,
      dbType,
      canonicalDomain: domain,
      status,
      productionModules: Array.from(new Set(modules)),
      invariants: testNames.slice(0, 5),
      inCertificationGate: inCert,
      notes,
    });
  }

  return results;
}

const inventory = scanTestFiles();
console.log(`Total test files: ${inventory.length}`);
console.log(`Total active tests: ${inventory.reduce((acc, i) => acc + i.testCount, 0)}`);
console.log(`Total assertions: ${inventory.reduce((acc, i) => acc + i.assertionCount, 0)}`);

const byDomain: Record<string, number> = {};
inventory.forEach((i) => {
  byDomain[i.canonicalDomain] = (byDomain[i.canonicalDomain] || 0) + 1;
});
console.log("\nBy Domain:", JSON.stringify(byDomain, null, 2));

const byStatus: Record<string, number> = {};
inventory.forEach((i) => {
  byStatus[i.status] = (byStatus[i.status] || 0) + 1;
});
console.log("\nBy Status:", JSON.stringify(byStatus, null, 2));

fs.writeFileSync(
  path.resolve(process.cwd(), "tests_inventory_raw.json"),
  JSON.stringify(inventory, null, 2)
);
