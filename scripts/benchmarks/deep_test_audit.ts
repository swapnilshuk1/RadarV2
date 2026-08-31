import fs from "fs";

interface TestMeta {
  path: string;
  lines: number;
  describes: string[];
  itCount: number;
  usesTurso: boolean;
  usesBetterSqlite: boolean;
  usesMocks: boolean;
}

const raw = JSON.parse(fs.readFileSync("scripts-and-tests-inventory.json", "utf-8"));
const allTests: TestMeta[] = [];

for (const group of Object.values(raw.testCategories) as any[]) {
  for (const t of group) {
    const content = fs.readFileSync(t.relPath, "utf-8");
    const itMatches = content.match(/\bit\s*\(/g) || [];
    allTests.push({
      path: t.relPath,
      lines: t.lines,
      describes: t.describeBlocks,
      itCount: itMatches.length,
      usesTurso: t.hasTurso,
      usesBetterSqlite: t.hasBetterSqlite,
      usesMocks: t.hasMocks,
    });
  }
}

console.log("Extracted detailed metadata for", allTests.length, "tests.");

// Group tests into logical subsystems
const subsystems: Record<string, TestMeta[]> = {
  "1. Canonical Ingestion & Acquisition Pipeline": [],
  "2. Identity, Career Intent & Capability Ontology": [],
  "3. Recommendation Engine, Gates & Policy Calibration": [],
  "4. Serving Store, Feed Queries & Keyset Pagination": [],
  "5. Editorial Briefs, Explanations & Badges": [],
  "6. Multi-Tenant Security & Scope Resolution": [],
  "7. Milestone & Phase-Specific Historical Tests (FOR-4*, M*, Phase*)": [],
  "8. Tests in tests/archive/": [],
};

for (const t of allTests) {
  const p = t.path;
  if (p.startsWith("tests/archive/")) {
    subsystems["8. Tests in tests/archive/"].push(t);
  } else if (p.includes("for4") || p.includes("/m") && /\/m\d+/.test(p) || p.includes("phase") || p.includes("p1") || p.includes("p2") || p.includes("p3")) {
    subsystems["7. Milestone & Phase-Specific Historical Tests (FOR-4*, M*, Phase*)"].push(t);
  } else if (p.includes("acquisition") || p.includes("ingestion") || p.includes("payload") || p.includes("recovery")) {
    subsystems["1. Canonical Ingestion & Acquisition Pipeline"].push(t);
  } else if (p.includes("identity") || p.includes("capability") || p.includes("career") || p.includes("intent") || p.includes("candidate")) {
    subsystems["2. Identity, Career Intent & Capability Ontology"].push(t);
  } else if (p.includes("editorial") || p.includes("explanation") || p.includes("brief") || p.includes("badge") || p.includes("verdict")) {
    subsystems["5. Editorial Briefs, Explanations & Badges"].push(t);
  } else if (p.includes("tenant") || p.includes("scope") || p.includes("security") || p.includes("auth")) {
    subsystems["6. Multi-Tenant Security & Scope Resolution"].push(t);
  } else if (p.includes("serving") || p.includes("query") || p.includes("feed") || p.includes("read") || p.includes("metrics")) {
    subsystems["4. Serving Store, Feed Queries & Keyset Pagination"].push(t);
  } else {
    subsystems["3. Recommendation Engine, Gates & Policy Calibration"].push(t);
  }
}

for (const [name, list] of Object.entries(subsystems)) {
  console.log(`\n================ ${name} (${list.length} files, ${list.reduce((acc, t) => acc + t.itCount, 0)} tests) ================`);
  for (const t of list) {
    console.log(`- [${t.usesTurso ? "TURSO" : t.usesBetterSqlite ? "SQLITE" : "PURE_TS"}] ${t.path} (${t.itCount} tests, ${t.lines} lines)`);
  }
}
