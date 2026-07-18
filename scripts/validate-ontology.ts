/**
 * validate-ontology.ts
 *
 * Ontology Linter — Stage 2 of the EQE pipeline.
 * Runs structural and semantic checks against config/ontologies/technology.json.
 *
 * Exit codes:
 *   0 — No errors (warnings may exist)
 *   1 — One or more errors found (pipeline should halt)
 *
 * Checks (ERRORS halt pipeline):
 *   E1. Duplicate aliases (same alias maps to two different products)
 *   E2. Unknown categories (not listed in meta file)
 *   E3. Canonical name collision (two products with same name, case-insensitive)
 *
 * Checks (WARNINGS do not halt pipeline):
 *   W1. Low reachability (product has zero aliases — only findable by exact canonical name)
 *   W2. Ambiguous single-word alias (alias is a short generic English word ≤ 8 chars
 *       that could shadow real prose — e.g. "Teams", "Cloud", "Go")
 *   W3. Alias shadows common English word (alias appears in a curated blocklist)
 *   W4. Metadata mismatch (meta.json counts differ from actual ontology)
 */
import fs from "fs";
import path from "path";

const ONTOLOGY_PATH = path.resolve(process.cwd(), "config", "ontologies", "technology.json");
const META_PATH     = path.resolve(process.cwd(), "config", "ontologies", "technology.meta.json");

// Common English words that should never be registered as product aliases.
// Registering any of these would cause false positives across general job descriptions.
const SHADOWING_BLOCKLIST = new Set([
  "teams", "cloud", "go", "spark", "swift", "kotlin", "ruby", "rails",
  "spring", "flow", "wave", "vision", "hub", "core", "base", "link",
  "connect", "stream", "edge", "studio", "fusion", "one", "now",
  "platform", "suite", "data", "analytics", "insight", "canvas",
  "board", "portal", "center", "service", "services", "engine",
]);

interface OntologyProduct {
  category: string;
  aliases: string[];
  vendor: string;
}

interface OntologyMeta {
  version: string;
  productCount: number;
  aliasCount: number;
  categoryCount: number;
  categories: string[];
}

interface LintIssue {
  level: "ERROR" | "WARN" | "INFO";
  code: string;
  message: string;
}

function runLinter(): void {
  const issues: LintIssue[] = [];
  const t0 = Date.now();

  console.log("\n══════════════════════════════════════════════════════════════════════════");
  console.log("                   RADAR ONTOLOGY LINTER  v1.0");
  console.log("══════════════════════════════════════════════════════════════════════════");

  // ─── Load Files ────────────────────────────────────────────────────────────
  if (!fs.existsSync(ONTOLOGY_PATH)) {
    console.error(`\n  ✗ Ontology file not found: ${ONTOLOGY_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(ONTOLOGY_PATH, "utf8")) as Record<string, OntologyProduct>;
  const meta: OntologyMeta | null = fs.existsSync(META_PATH)
    ? JSON.parse(fs.readFileSync(META_PATH, "utf8")) as OntologyMeta
    : null;

  const products   = Object.entries(raw);
  const categories = meta?.categories ? new Set(meta.categories) : null;

  console.log(`\n  Ontology : ${ONTOLOGY_PATH}`);
  console.log(`  Meta     : ${META_PATH}`);
  console.log(`  Products : ${products.length}`);
  console.log(`  Version  : ${meta?.version ?? "unknown"}\n`);

  // ─── E1: Duplicate Aliases ─────────────────────────────────────────────────
  console.log("  Checking E1 — Duplicate aliases...");
  const aliasMap = new Map<string, string>(); // normalised alias → first product
  for (const [productName, product] of products) {
    const allTerms = [productName, ...product.aliases];
    for (const term of allTerms) {
      const key = term.toLowerCase().trim();
      if (aliasMap.has(key)) {
        issues.push({
          level: "ERROR",
          code: "E1",
          message: `Alias "${term}" (normalised: "${key}") maps to both "${aliasMap.get(key)}" and "${productName}"`,
        });
      } else {
        aliasMap.set(key, productName);
      }
    }
  }

  // ─── E2: Unknown Categories ────────────────────────────────────────────────
  console.log("  Checking E2 — Unknown categories...");
  if (categories) {
    for (const [productName, product] of products) {
      if (!categories.has(product.category)) {
        issues.push({
          level: "ERROR",
          code: "E2",
          message: `Product "${productName}" has category "${product.category}" which is not listed in technology.meta.json`,
        });
      }
    }
  } else {
    console.log("    ⚠  Skipped — technology.meta.json not found");
  }

  // ─── E3: Canonical Name Collision ──────────────────────────────────────────
  console.log("  Checking E3 — Canonical name collisions...");
  const canonicalNames = new Map<string, string>(); // lowercase → original
  for (const [productName] of products) {
    const key = productName.toLowerCase().trim();
    if (canonicalNames.has(key)) {
      issues.push({
        level: "ERROR",
        code: "E3",
        message: `Canonical name collision: "${productName}" and "${canonicalNames.get(key)}" normalise to the same key "${key}"`,
      });
    } else {
      canonicalNames.set(key, productName);
    }
  }

  // ─── W1: Low Reachability ──────────────────────────────────────────────────
  console.log("  Checking W1 — Low reachability (zero aliases)...");
  const lowReachability: string[] = [];
  for (const [productName, product] of products) {
    if (product.aliases.length === 0) {
      lowReachability.push(productName);
      issues.push({
        level: "WARN",
        code: "W1",
        message: `Product "${productName}" has zero aliases — reachability = 1 (only exact canonical name matches)`,
      });
    }
  }

  // ─── W2: Short Single-Word Alias (INFO) ─────────────────────────────────────
  // Downgraded to INFO — industry acronyms (GA4, GCP, SFDC, K8s, EKS) are intentional
  // and high-value. This is informational only and never blocks the pipeline.
  // For dangerous aliases, W3 (shadow blocklist) is the correct gate.
  console.log("  Checking W2 — Short single-word aliases (INFO)...");
  for (const [productName, product] of products) {
    for (const alias of product.aliases) {
      const words = alias.trim().split(/\s+/);
      // Flag all-lowercase aliases ≤ 4 chars as INFO (not WARN).
      // These are worth knowing about but do not require review before proceeding.
      const isAllLower = alias === alias.toLowerCase();
      if (words.length === 1 && isAllLower && alias.length <= 4) {
        issues.push({
          level: "INFO",
          code: "W2",
          message: `"${alias}" is a short all-lowercase alias for "${productName}" (${alias.length} chars)`,
        });
      }
    }
  }

  // ─── W3: Alias Shadows English Word ───────────────────────────────────────
  console.log("  Checking W3 — Shadow blocklist...");
  for (const [productName, product] of products) {
    const allTerms = [productName, ...product.aliases];
    for (const term of allTerms) {
      if (SHADOWING_BLOCKLIST.has(term.toLowerCase().trim())) {
        issues.push({
          level: "WARN",
          code: "W3",
          message: `"${term}" (for "${productName}") appears in the shadow blocklist — likely to cause false positives`,
        });
      }
    }
  }

  // ─── W4: Metadata Count Mismatch ──────────────────────────────────────────
  console.log("  Checking W4 — Metadata count integrity...");
  if (meta) {
    const actualProducts = products.length;
    const actualAliases  = products.reduce((sum, [, p]) => sum + p.aliases.length, 0);
    const actualCats     = new Set(products.map(([, p]) => p.category)).size;

    if (meta.productCount !== actualProducts) {
      issues.push({
        level: "WARN",
        code: "W4",
        message: `meta.productCount = ${meta.productCount} but actual = ${actualProducts} — run update-ontology-meta to sync`,
      });
    }
    if (meta.aliasCount !== actualAliases) {
      issues.push({
        level: "WARN",
        code: "W4",
        message: `meta.aliasCount = ${meta.aliasCount} but actual = ${actualAliases} — run update-ontology-meta to sync`,
      });
    }
    if (meta.categoryCount !== actualCats) {
      issues.push({
        level: "WARN",
        code: "W4",
        message: `meta.categoryCount = ${meta.categoryCount} but actual = ${actualCats} — run update-ontology-meta to sync`,
      });
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  const errors   = issues.filter(i => i.level === "ERROR");
  const warnings = issues.filter(i => i.level === "WARN");
  const elapsed  = Date.now() - t0;

  console.log("\n──────────────────────────────────────────────────────────────────────────");
  console.log("  RESULTS");
  console.log("──────────────────────────────────────────────────────────────────────────");

  const infos = issues.filter(i => i.level === "INFO");

  if (issues.length === 0) {
    console.log("  ✅ All checks passed — zero errors, zero warnings");
  } else {
    for (const issue of issues) {
      const icon = issue.level === "ERROR" ? "  ✗ [ERROR]" :
                   issue.level === "WARN"  ? "  ⚠  [WARN] " :
                                            "  ℹ  [INFO] ";
      console.log(`${icon} ${issue.code}: ${issue.message}`);
    }
  }

  console.log("\n──────────────────────────────────────────────────────────────────────────");
  console.log(`  Errors   : ${errors.length}   (halt pipeline)`);
  console.log(`  Warnings : ${warnings.length}   (review before proceeding)`);
  console.log(`  Info     : ${infos.length}   (informational only)`);
  console.log(`  Elapsed  : ${elapsed}ms`);

  if (errors.length > 0) {
    console.log("\n  ❌ Ontology linter FAILED — fix all errors before proceeding.");
    console.log("══════════════════════════════════════════════════════════════════════════\n");
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log("\n  ✅ Ontology linter PASSED (with warnings — review before next sprint).");
    console.log("══════════════════════════════════════════════════════════════════════════\n");
  } else {
    console.log("\n  ✅ Ontology linter PASSED.");
    console.log("══════════════════════════════════════════════════════════════════════════\n");
  }
}

runLinter();
