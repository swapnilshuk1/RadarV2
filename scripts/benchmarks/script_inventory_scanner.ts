import * as fs from "fs";
import * as path from "path";

interface ScriptInfo {
  relativePath: string;
  category:
    | "OPERATIONAL"
    | "CERTIFICATION"
    | "DEPLOYMENT"
    | "MIGRATION"
    | "BENCHMARK"
    | "DIAGNOSTIC"
    | "HISTORICAL"
    | "SCRATCH"
    | "DUPLICATE"
    | "UNKNOWN";
  purpose: string;
  inPackageJson: boolean;
  proposedAction: "KEEP" | "CONSOLIDATE" | "ARCHIVE" | "DELETE" | "REVIEW";
}

function scanScripts(): ScriptInfo[] {
  const scriptsDir = path.resolve(process.cwd(), "scripts");
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
  const pkgScripts = Object.values(pkg.scripts || {}).join(" ");

  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }

  walk(scriptsDir);

  const results: ScriptInfo[] = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    const basename = path.basename(file);
    const inPkg = pkgScripts.includes(basename) || pkgScripts.includes(rel);

    let category: ScriptInfo["category"] = "UNKNOWN";
    let purpose = "";
    let action: ScriptInfo["proposedAction"] = "KEEP";

    if (
      rel === "scripts/scrape.ts" ||
      rel.startsWith("scripts/scraper/") ||
      rel === "scripts/enrich.ts" ||
      rel.startsWith("scripts/corpus/")
    ) {
      category = "OPERATIONAL";
      purpose = "Core multi-portal scraping, anti-bot stealth, and corpus pipeline engine";
      action = "KEEP";
    } else if (rel === "scripts/certify.ts" || rel.startsWith("scripts/certification/")) {
      category = "CERTIFICATION";
      purpose = "Permanent continuous certification gate";
      action = "KEEP";
    } else if (rel === "scripts/deploy.ts" || rel === "scripts/deploy.ps1" || rel.includes("deploy")) {
      category = "DEPLOYMENT";
      purpose = "Oracle Cloud server deploy and process manager restart";
      action = "KEEP";
    } else if (rel.includes("migration") || rel.includes("migrate") || rel.startsWith("scripts/db/")) {
      category = "MIGRATION";
      purpose = "Database schema migrations and seed scripts";
      action = "KEEP";
    } else if (rel.startsWith("scripts/benchmarks/") || rel.includes("qa-eval") || rel.includes("policy-calibration")) {
      if (basename.startsWith("inspect_") || basename.startsWith("debug_") || basename.startsWith("check_") || basename.startsWith("capture_")) {
        category = "SCRATCH";
        purpose = "Ad-hoc diagnostic probe or verification artifact";
        action = "ARCHIVE";
      } else {
        category = "BENCHMARK";
        purpose = "Domain calibration, ontology evaluation, and metric benchmarking harness";
        action = "KEEP";
      }
    } else if (rel.startsWith("scripts/diagnose") || rel.includes("audit-") || rel.includes("verify-") || rel.includes("test_")) {
      category = "DIAGNOSTIC";
      purpose = "System integrity and telemetry diagnostic tooling";
      action = inPkg ? "KEEP" : "CONSOLIDATE";
    } else if (rel.includes("m") && (rel.includes("seed") || rel.includes("fixture") || rel.includes("phase") || rel.includes("for4"))) {
      category = "HISTORICAL";
      purpose = "Milestone-specific test seeding and synthetic generation scripts";
      action = "REVIEW";
    } else {
      category = "DIAGNOSTIC";
      purpose = "Repository inspection or auxiliary utility";
      action = inPkg ? "KEEP" : "REVIEW";
    }

    results.push({
      relativePath: rel,
      category,
      purpose,
      inPackageJson: inPkg,
      proposedAction: action,
    });
  }

  return results;
}

const scripts = scanScripts();
console.log(`Total scripts scanned: ${scripts.length}`);

const byCat: Record<string, number> = {};
scripts.forEach((s) => {
  byCat[s.category] = (byCat[s.category] || 0) + 1;
});
console.log("\nBy Category:", JSON.stringify(byCat, null, 2));

const byAction: Record<string, number> = {};
scripts.forEach((s) => {
  byAction[s.proposedAction] = (byAction[s.proposedAction] || 0) + 1;
});
console.log("\nBy Action:", JSON.stringify(byAction, null, 2));

fs.writeFileSync(
  path.resolve(process.cwd(), "scripts_inventory_raw.json"),
  JSON.stringify(scripts, null, 2)
);
