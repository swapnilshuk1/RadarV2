import fs from "fs";
import path from "path";

interface FileEntry {
  relPath: string;
  lines: number;
  sizeKb: number;
  hasTurso: boolean;
  hasBetterSqlite: boolean;
  hasMocks: boolean;
  describeBlocks: string[];
}

function scanDir(dir: string, extFilter: (f: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  let files: string[] = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files = files.concat(scanDir(full, extFilter));
    } else if (extFilter(item)) {
      files.push(full);
    }
  }
  return files;
}

function analyzeTestFile(filePath: string): FileEntry {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const sizeKb = Math.round(fs.statSync(filePath).size / 1024);
  const hasTurso = content.includes("RADAR_USE_TURSO") || content.includes("Turso") || content.includes("libsql");
  const hasBetterSqlite = content.includes("better-sqlite3");
  const hasMocks = content.includes("vi.mock") || content.includes("vi.fn") || content.includes("mock");
  
  const describeMatches = content.match(/describe\s*\(\s*["'`](.*?)["'`]/g) || [];
  const describeBlocks = describeMatches.map(m => m.replace(/^describe\s*\(\s*["'`]/, "").replace(/["'`]$/, ""));

  return {
    relPath: path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
    lines: lines.length,
    sizeKb,
    hasTurso,
    hasBetterSqlite,
    hasMocks,
    describeBlocks,
  };
}

function main() {
  const testFiles = scanDir("tests", f => f.endsWith(".test.ts") || f.endsWith(".spec.ts"));
  const scriptFiles = scanDir("scripts", f => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".ps1") || f.endsWith(".sh"));
  const rootScripts = fs.readdirSync(".").filter(f => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".ps1") || f.endsWith(".sh")).map(f => path.join(".", f));

  const testAnalysis = testFiles.map(analyzeTestFile);
  const scriptAnalysis = [...scriptFiles, ...rootScripts].map(f => {
    const content = fs.readFileSync(f, "utf-8");
    return {
      relPath: path.relative(process.cwd(), f).replace(/\\/g, "/"),
      lines: content.split("\n").length,
      sizeKb: Math.round(fs.statSync(f).size / 1024),
    };
  });

  const out = {
    totalTests: testAnalysis.length,
    testCategories: {
      archive: testAnalysis.filter(t => t.relPath.startsWith("tests/archive")),
      editorial: testAnalysis.filter(t => t.relPath.startsWith("tests/editorial")),
      intelligence: testAnalysis.filter(t => t.relPath.startsWith("tests/intelligence")),
      acquisition: testAnalysis.filter(t => t.relPath.startsWith("tests/acquisition")),
      other: testAnalysis.filter(t => !t.relPath.startsWith("tests/archive") && !t.relPath.startsWith("tests/editorial") && !t.relPath.startsWith("tests/intelligence") && !t.relPath.startsWith("tests/acquisition")),
    },
    totalScripts: scriptAnalysis.length,
    scripts: scriptAnalysis,
  };

  fs.writeFileSync("scripts-and-tests-inventory.json", JSON.stringify(out, null, 2));
  console.log("Analyzed", testAnalysis.length, "tests and", scriptAnalysis.length, "scripts. Written to scripts-and-tests-inventory.json");
}

main();
