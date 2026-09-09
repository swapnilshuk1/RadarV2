/**
 * scripts/db/reset-corpus.ts
 *
 * RADAR v2 — Safe Corpus Reset Utility
 *
 * Resets the runtime opportunity corpus, queues, and evaluations to a clean zero-state
 * while preserving all tenant configuration, users, candidate profiles, search plans,
 * criteria snapshots, and evaluation contexts.
 *
 * Usage:
 *   npx tsx scripts/db/reset-corpus.ts --confirm
 *   npm run db:reset-corpus
 */

import { getDatabaseAdapter } from "@/data/database";

export const PRESERVED_TABLES = [
  "tenants",
  "users",
  "memberships",
  "people",
  "career_profiles",
  "candidate_projection",
  "search_plans",
  "search_plan_snapshots",
  "evaluation_contexts",
  "source_credentials",
  "_migrations",
] as const;

export const CORPUS_TABLES = [
  "recovery_queue",
  "materialized_evaluations",
  "evaluation_jobs",
  "search_plan_candidates",
  "acquisition_ingestion_lineage",
  "opportunity_versions",
  "canonical_decisions",
  "decisions",
  "fact_evidence",
  "claim_facts",
  "match_claims",
  "evidence",
  "facts",
  "claims",
  "matches",
  "assessments",
  "assessment_records",
  "recommendations",
  "recommendation_snapshots",
  "candidate_evaluations",
  "dossier_views",
  "opportunity_discoveries",
  "document_contents",
  "documents",
  "opportunities",
  "canonical_opportunities",
  "acquisition_ledger",
  "enrichment_events",
  "enrichment_jobs",
  "scrape_run_events",
  "scrape_runs",
] as const;

export async function getTableCount(db: ReturnType<typeof getDatabaseAdapter>, tableName: string): Promise<number | null> {
  try {
    const row = await db.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
    return row?.cnt ?? 0;
  } catch (err: any) {
    if (err?.message?.includes("no such table")) {
      return null; // Table does not exist in this schema version
    }
    throw new Error(`Failed to query table count for "${tableName}": ${err?.message || err}`);
  }
}

async function main() {
  const isConfirmed = process.argv.includes("--confirm");

  if (!isConfirmed) {
    console.error(`
============================================================
              RADAR v2 — CORPUS RESET SAFETY GUARD
============================================================
CAUTION: This command clears all acquired opportunities, versions,
evaluation jobs, materialized evaluations, and raw documents.

Preserved:
  - Tenants, Users, Memberships, People
  - Authoritative Career Profiles & Candidate Projections
  - Search Plans, Criteria Snapshots & Evaluation Contexts
  - Source Credentials & Schema Migrations

To execute the reset, run:
  npx tsx scripts/db/reset-corpus.ts --confirm
  or
  npm run db:reset-corpus
============================================================
`);
    process.exit(1);
  }

  const db = getDatabaseAdapter();

  console.log(`\n============================================================`);
  console.log(`             RADAR v2 CORPUS RESET PROTOCOL`);
  console.log(`============================================================\n`);

  // 1. Audit Pre-Reset State...
  console.log(`[1/4] Auditing Pre-Reset State...`);
  const preCorpusCounts: Record<string, number | null> = {};
  const prePreservedCounts: Record<string, number | null> = {};

  for (const t of CORPUS_TABLES) {
    preCorpusCounts[t] = await getTableCount(db, t);
  }
  for (const t of PRESERVED_TABLES) {
    prePreservedCounts[t] = await getTableCount(db, t);
  }

  console.log(`\nPreserved Configuration Rows (Pre-Reset):`);
  for (const [tbl, cnt] of Object.entries(prePreservedCounts)) {
    if (cnt !== null) console.log(`  - ${tbl.padEnd(28)} : ${cnt}`);
  }

  console.log(`\nCorpus & Queue Rows to Clear (Pre-Reset):`);
  let totalCorpusRows = 0;
  for (const [tbl, cnt] of Object.entries(preCorpusCounts)) {
    if (cnt !== null && cnt > 0) {
      console.log(`  - ${tbl.padEnd(28)} : ${cnt}`);
      totalCorpusRows += cnt;
    }
  }
  console.log(`Total corpus records targeted: ${totalCorpusRows}\n`);

  // 2. Execute FK-Ordered Deletions
  console.log(`[2/4] Executing Database Corpus Wipe...`);
  for (const table of CORPUS_TABLES) {
    try {
      const res = await db.execute(`DELETE FROM "${table}"`);
      if (res.rowsAffected > 0) {
        console.log(`  ✓ Cleared ${table} (${res.rowsAffected} rows deleted)`);
      }
    } catch (err: any) {
      if (err?.message?.includes("no such table")) {
        // Table not present in this schema migration level; safe to continue
        continue;
      }
      throw new Error(`Failed to clear table "${table}": ${err?.message || err}`);
    }
  }

  // Clear local file artifacts caches
  try {
    const fs = await import("fs");
    const path = await import("path");
    const root = process.cwd();
    const dirsToClear = [
      path.join(root, ".scraper-artifacts", "snapshots"),
      path.join(root, ".scraper-artifacts", "extractions"),
      path.join(root, ".scraper-artifacts", "enrichment-cache"),
    ];
    for (const d of dirsToClear) {
      if (fs.existsSync(d)) {
        fs.rmSync(d, { recursive: true, force: true });
        fs.mkdirSync(d, { recursive: true });
        console.log(`  ✓ Cleared artifact cache: ${path.basename(d)}`);
      }
    }
  } catch (err: any) {
    console.warn(`  ! Warning clearing local caches: ${err.message}`);
  }

  // 3. Audit Post-Reset Counts
  console.log(`\n[3/4] Verifying Post-Reset Integrity...`);
  const postCorpusCounts: Record<string, number | null> = {};
  const postPreservedCounts: Record<string, number | null> = {};

  for (const t of CORPUS_TABLES) {
    postCorpusCounts[t] = await getTableCount(db, t);
  }
  for (const t of PRESERVED_TABLES) {
    postPreservedCounts[t] = await getTableCount(db, t);
  }

  // 4. Print Clean-State Manifest
  console.log(`\n[4/4] CLEAN-STATE MANIFEST:`);
  console.log(`============================================================`);
  console.log(`PRESERVED CONFIGURATION TABLES:`);
  let configIntact = true;
  for (const [tbl, cnt] of Object.entries(postPreservedCounts)) {
    const preCnt = prePreservedCounts[tbl];
    if (cnt === null) {
      console.log(`  ${tbl.padEnd(28)} : [NOT IN SCHEMA]`);
      continue;
    }
    const match = cnt === preCnt ? "✅ INTACT" : "❌ CHANGED";
    console.log(`  ${tbl.padEnd(28)} : ${cnt.toString().padStart(5)} [${match}]`);
    if (cnt !== preCnt) configIntact = false;
  }

  console.log(`\nCORPUS & RUNTIME TABLES (Zero-State Required):`);
  let corpusZero = true;
  for (const [tbl, cnt] of Object.entries(postCorpusCounts)) {
    if (cnt === null) {
      console.log(`  ${tbl.padEnd(28)} : [NOT IN SCHEMA]`);
      continue;
    }
    const status = cnt === 0 ? "✅ ZERO" : "❌ NON-ZERO";
    console.log(`  ${tbl.padEnd(28)} : ${cnt.toString().padStart(5)} [${status}]`);
    if (cnt !== 0) corpusZero = false;
  }
  console.log(`============================================================`);

  if (configIntact && corpusZero) {
    console.log(`\n✨ CORPUS RESET COMPLETE: Clean zero-state verified successfully.\n`);
  } else {
    console.error(`\n❌ CORPUS RESET FAILED: Some tables did not meet verification invariants (configIntact=${configIntact}, corpusZero=${corpusZero}).\n`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  main().catch((err) => {
    console.error("Corpus reset failed with error:", err);
    process.exit(1);
  });
}
