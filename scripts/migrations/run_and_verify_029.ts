import { getDatabaseAdapter } from "../../src/data/database/index";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import path from "path";

export async function verifyVetoBackfill() {
  const db = getDatabaseAdapter();

  console.log("=================================================");
  console.log("   Migration 029: Execution & Backfill Audit     ");
  console.log("=================================================\n");

  // 1. Run migrations
  console.log("1. Applying migration 029_materialized_evaluations_vetoed.sql...");
  const migrationsDir = path.resolve(process.cwd(), "src/data/sqlite/migrations");
  const result = await runMigrations(db, migrationsDir);
  console.log("Migration Result:", result);

  // 2. Audit Column Existence
  const cols = await db.many<any>("PRAGMA table_info(materialized_evaluations)");
  const hasVetoed = cols.some((c: any) => c.name === "vetoed");
  console.log(`\n2. 'vetoed' column present in schema: ${hasVetoed}`);
  if (!hasVetoed) {
    throw new Error("Migration failed: 'vetoed' column not found in materialized_evaluations!");
  }

  // 3. Count Evaluations and Compare JSON vs Scalar
  console.log("\n3. Comparing JSON Truth vs Scalar Column across entire table...");
  const rows = await db.many<any>(`
    SELECT 
      id,
      vetoed,
      evaluation_json
    FROM materialized_evaluations
  `);

  const totalEvaluations = rows.length;
  let jsonVetoTrueCount = 0;
  let jsonVetoFalseOrNullCount = 0;
  let scalarVeto1Count = 0;
  let scalarVeto0Count = 0;
  let scalarNullCount = 0;
  let mismatches: Array<{ id: string; scalar: any; jsonVeto: boolean }> = [];

  for (const r of rows) {
    let jsonVeto = false;
    if (r.evaluation_json) {
      try {
        const p = JSON.parse(r.evaluation_json);
        const rec = p.record || p.engineRecommendation || p;
        jsonVeto = Boolean(p.vetoed ?? rec.vetoed);
      } catch {}
    }

    if (jsonVeto) {
      jsonVetoTrueCount++;
    } else {
      jsonVetoFalseOrNullCount++;
    }

    if (r.vetoed === 1) {
      scalarVeto1Count++;
    } else if (r.vetoed === 0) {
      scalarVeto0Count++;
    } else if (r.vetoed === null || r.vetoed === undefined) {
      scalarNullCount++;
    }

    const scalarBool = r.vetoed === 1;
    if (scalarBool !== jsonVeto) {
      mismatches.push({
        id: r.id,
        scalar: r.vetoed,
        jsonVeto,
      });
    }
  }

  console.log("--- Backfill Completeness Audit ---");
  console.log(`  - Total Evaluations:              ${totalEvaluations}`);
  console.log(`  - JSON veto = true count:         ${jsonVetoTrueCount}`);
  console.log(`  - JSON veto = false/missing:      ${jsonVetoFalseOrNullCount}`);
  console.log(`  - Scalar veto = 1 count:          ${scalarVeto1Count}`);
  console.log(`  - Scalar veto = 0 count:          ${scalarVeto0Count}`);
  console.log(`  - Scalar veto = NULL count:        ${scalarNullCount}`);
  console.log(`  - Parity Mismatches:              ${mismatches.length}`);

  if (mismatches.length > 0) {
    console.error("FAILED: Parity mismatches found!", mismatches.slice(0, 10));
    throw new Error(`Migration 029 validation failed: ${mismatches.length} mismatches!`);
  } else {
    console.log("\nSUCCESS: 100.00% exact parity between JSON truth and scalar vetoed column!");
  }

  return {
    totalEvaluations,
    jsonVetoTrueCount,
    scalarVeto1Count,
    scalarNullCount,
    mismatchCount: mismatches.length,
  };
}

if (process.argv[1]?.includes("run_and_verify_029")) {
  verifyVetoBackfill().catch(console.error);
}
