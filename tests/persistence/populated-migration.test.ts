import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations, splitSqlStatements } from "../../src/data/sqlite/migrations/runner";

describe("Populated Migration Verification (042 & 043 Rebuild Under Foreign Keys)", () => {
  it("executes migrations 001-041, populates data with foreign_keys=ON, runs 042 & 043, and verifies FK checks and row identities", async () => {
    const rawDb = new Database(":memory:");
    rawDb.pragma("foreign_keys = ON");
    const db = new SqliteAdapter(rawDb);

    // 1. Run migrations 001 through 041 manually
    const migrationsDir = path.resolve(process.cwd(), "src/data/sqlite/migrations");
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
      .sort();

    const pre042Files = migrationFiles.filter(f => {
      const num = parseInt(f.slice(0, 3), 10);
      return num >= 1 && num <= 41;
    });

    // 1. Run migrations 001 through 041 using a temporary directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-mig-pre42-"));
    try {
      for (const file of pre042Files) {
        fs.copyFileSync(path.join(migrationsDir, file), path.join(tempDir, file));
      }
      await runMigrations(db, tempDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // 2. Populate test data with Foreign Keys fully enabled
    await db.execute("PRAGMA foreign_keys = ON;");
    await db.execute(`INSERT INTO tenants (id, status) VALUES ('tenant_1', 'active')`);
    await db.execute(`INSERT INTO people (id, email, tenant_id) VALUES ('person_1', 'test@test.com', 'tenant_1')`);
    await db.execute(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES ('plan_1', 'tenant_1', 'person_1', 'active', 'VP Engineering', '{}')`);
    await db.execute(`INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES ('sps_1', 'tenant_1', 'person_1', 'plan_1', 'hash_sps_1', '{}')`);
    await db.execute(`INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES ('fp_1', 'tenant_1', 'person_1', 'sps_1', 'v1', 'hash_ont', 'v1', 'v1')`);
    await db.execute(`INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES ('fp_1', 'tenant_1', 'person_1', 'plan_1')`);
    await db.execute(`INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES ('tenant_1', 'person_1', 'plan_1', 'fp_1', 'test')`);
    await db.execute(`INSERT INTO companies (id, name) VALUES ('comp_1', 'Acme Corp')`);
    await db.execute(`INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES ('can_1', 'LinkedIn', 'src_1', 'https://linkedin.com/jobs/1', 'Acme Corp')`);
    await db.execute(`INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, location, raw_content) VALUES ('ver_1', 'can_1', 'content_hash_1', 'VP Eng', 'Acme Corp', 'Bengaluru', 'Job description text')`);

    // Scrape run in pre-042 schema
    await db.execute(`INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets, started_at) VALUES ('run_pre_42', 'tenant_1', 'person_1', 'plan_1', 'running', '["LinkedIn"]', CURRENT_TIMESTAMP)`);
    await db.execute(`INSERT INTO scrape_run_events (run_id, tenant_id, person_id, stage, portal, event_type, payload_json) VALUES ('run_pre_42', 'tenant_1', 'person_1', 'RUNNING', 'LinkedIn', 'INFO', '{"unit": 1}')`);
    await db.execute(`INSERT INTO acquisition_ledger (id, canonical_job_id, source_portal, source_job_id, canonical_url, title, company_name, first_seen_at, last_seen_at, created_at, updated_at) VALUES ('acq_1', 'can_1', 'LinkedIn', 'src_1', 'https://linkedin.com/jobs/1', 'VP Eng', 'Acme Corp', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
    await db.execute(`INSERT INTO acquisition_ingestion_lineage (id, scrape_run_id, tenant_id, person_id, acquisition_ledger_id, card_id, ingestion_attempt, source_portal, source_job_id, source_url, capture_state, document_state, content_hash, canonical_job_id, opportunity_version) VALUES ('lin_1', 'run_pre_42', 'tenant_1', 'person_1', 'acq_1', 'card_1', 1, 'LinkedIn', 'src_1', 'https://linkedin.com/jobs/1', 'CAPTURED', 'PARSED', 'content_hash_1', 'can_1', 'ver_1')`);

    // Pre-043 enrichment jobs (legacy schema: job_hash UNIQUE, no canonical_job_id yet)
    await db.execute(`INSERT INTO enrichment_jobs (id, job_hash, pipeline_version, snapshot_path, run_id, status, created_at) VALUES ('ej_legacy_1', 'src_1', '1.0.0', '/payloads/1.json', 'run_pre_42', 'COMPLETE', CURRENT_TIMESTAMP)`);
    await db.execute(`INSERT INTO enrichment_events (job_id, event_type, details) VALUES ('ej_legacy_1', 'COMPLETED', 'Enriched successfully')`);

    // Search plan candidate projection
    await db.execute(`INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES ('tenant_1', 'person_1', 'plan_1', 'can_1', 'ver_1', 'CANDIDATE')`);

    // Evaluation jobs and materialized evaluation
    await db.execute(`INSERT INTO evaluation_jobs (id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, status, attempts, max_attempts) VALUES ('eval_job_1', 'tenant_1', 'person_1', 'plan_1', 'can_1', 'ver_1', 'fp_1', 'pending', 0, 3)`);
    await db.execute(`INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_state, decision, quality_score, evaluation_json) VALUES ('me_1', 'tenant_1', 'person_1', 'can_1', 'ver_1', 'fp_1', 'EVALUATED', 'PURSUE', 90, '{"fit": true}')`);

    // 3. Run remaining migrations (042, 043) via the official migration runner
    const result = await runMigrations(db);
    expect(result.applied).toContain("042_scrape_runs_distributed_lifecycle.sql");
    expect(result.applied).toContain("043_distributed_work_identity.sql");

    // 4. Verify ZERO foreign key violations
    const fkViolations = rawDb.pragma("foreign_key_check");
    expect(fkViolations).toEqual([]);

    // 5. Verify row identities and contents
    // A. scrape_runs
    const runs = await db.many<any>(`SELECT * FROM scrape_runs WHERE id = 'run_pre_42'`);
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe("run_pre_42");
    expect(runs[0].tenant_id).toBe("tenant_1");
    expect(runs[0].person_id).toBe("person_1");
    expect(runs[0].search_plan_id).toBe("plan_1");
    expect(runs[0].status).toBe("running");

    // B. scrape_run_events
    const runEvents = await db.many<any>(`SELECT * FROM scrape_run_events WHERE run_id = 'run_pre_42'`);
    expect(runEvents.length).toBe(1);
    expect(runEvents[0].run_id).toBe("run_pre_42");
    expect(runEvents[0].event_type).toBe("INFO");

    // C. acquisition_ingestion_lineage
    const lineage = await db.many<any>(`SELECT * FROM acquisition_ingestion_lineage WHERE id = 'lin_1'`);
    expect(lineage.length).toBe(1);
    expect(lineage[0].scrape_run_id).toBe("run_pre_42");
    expect(lineage[0].canonical_job_id).toBe("can_1");
    expect(lineage[0].opportunity_version).toBe("ver_1");

    // D. enrichment_jobs (backfilled from acquisition_ingestion_lineage in 043)
    const enrichJobs = await db.many<any>(`SELECT * FROM enrichment_jobs WHERE id = 'ej_legacy_1'`);
    expect(enrichJobs.length).toBe(1);
    expect(enrichJobs[0].canonical_job_id).toBe("can_1");
    expect(enrichJobs[0].opportunity_version).toBe("ver_1");
    expect(enrichJobs[0].pipeline_version).toBe("1.0.0");
    expect(enrichJobs[0].status).toBe("COMPLETE");

    // E. enrichment_events
    const enrichEvents = await db.many<any>(`SELECT * FROM enrichment_events WHERE job_id = 'ej_legacy_1'`);
    expect(enrichEvents.length).toBe(1);
    expect(enrichEvents[0].job_id).toBe("ej_legacy_1");
    expect(enrichEvents[0].event_type).toBe("COMPLETED");

    // F. evaluation_requirements (created & repaired in 043)
    const reqs = await db.many<any>(`SELECT * FROM evaluation_requirements WHERE canonical_job_id = 'can_1'`);
    expect(reqs.length).toBe(1);
    expect(reqs[0].status).toBe("SATISFIED"); // Materialization already existed!
    expect(reqs[0].required_enrichment_pipeline_version).toBe("1.0.0");

    // G. evaluation_jobs
    const evalJobs = await db.many<any>(`SELECT * FROM evaluation_jobs WHERE id = 'eval_job_1'`);
    expect(evalJobs.length).toBe(1);
    expect(evalJobs[0].status).toBe("completed"); // Synchronized with satisfied requirement!

    // H. materialized_evaluations
    const mats = await db.many<any>(`SELECT * FROM materialized_evaluations WHERE id = 'me_1'`);
    expect(mats.length).toBe(1);
    expect(mats[0].decision).toBe("PURSUE");
    expect(mats[0].quality_score).toBe(90);
  });
});
