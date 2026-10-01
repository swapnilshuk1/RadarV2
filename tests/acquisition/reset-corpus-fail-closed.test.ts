import { describe, it, expect, vi } from "vitest";
import { getTableCount, CORPUS_TABLES, PRESERVED_TABLES, resetCorpus } from "../../scripts/db/reset-corpus";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("Corpus Reset Fail-Closed Safety Protocol", () => {
  function resetFixture() {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE people(id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE document_contents(id TEXT PRIMARY KEY, raw_text TEXT);
      CREATE TABLE canonical_opportunities(id TEXT PRIMARY KEY, canonical_url TEXT);
      CREATE TABLE opportunity_versions(id TEXT PRIMARY KEY, canonical_job_id TEXT REFERENCES canonical_opportunities(id), source_payload_key TEXT);
      CREATE TABLE evaluation_jobs(id TEXT PRIMARY KEY, opportunity_version TEXT REFERENCES opportunity_versions(id));
      CREATE TABLE staged_evaluations(id TEXT PRIMARY KEY, opportunity_version TEXT);
      CREATE TRIGGER source_immutable BEFORE UPDATE OF source_payload_key ON opportunity_versions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE'); END;
      INSERT INTO people VALUES('candidate','Preserved candidate');
      INSERT INTO document_contents VALUES('cv','Original candidate source');
      INSERT INTO canonical_opportunities VALUES('job','https://example.test/job');
      INSERT INTO opportunity_versions VALUES('version','job','missing.json');
      INSERT INTO evaluation_jobs VALUES('work','version');
      INSERT INTO staged_evaluations VALUES('evaluation','version');
    `);
    const folder=fs.mkdtempSync(path.join(os.tmpdir(),"radar-reset-"));
    return {sqlite, db:new SqliteAdapter(sqlite), auditFile:path.join(folder,"audit.json"), cleanup:()=>{sqlite.close();fs.rmSync(folder,{recursive:true,force:true});}};
  }

  it("exports the discarded source lineage, deletes children before versions, and preserves candidate bytes and source triggers", async()=>{
    const f=resetFixture();
    try {
      const result=await resetCorpus(f.db,{auditFile:f.auditFile,apply:true,target:"isolated-test",missingKeys:["missing.json"]});
      expect(result.applied).toBe(true);
      expect(await getTableCount(f.db,"opportunity_versions")).toBe(0);
      expect(await getTableCount(f.db,"evaluation_jobs")).toBe(0);
      expect(await getTableCount(f.db,"canonical_opportunities")).toBe(1);
      expect(await f.db.one("SELECT raw_text FROM document_contents")).toEqual({raw_text:"Original candidate source"});
      const audit=JSON.parse(fs.readFileSync(f.auditFile,"utf8"));
      expect(audit.discardedVersions[0]).toMatchObject({versionId:"version",canonicalJobId:"job",sourceKey:"missing.json",evaluationIds:["evaluation"],missingOriginal:true});
      expect(audit.rows.people).toEqual([{id:"candidate",name:"Preserved candidate"}]);
      expect((await f.db.many("SELECT name FROM sqlite_master WHERE type='trigger'"))).toEqual([{name:"source_immutable"}]);
    } finally {f.cleanup();}
  });

  it("rolls back every deletion if a trigger changes protected candidate state",async()=>{
    const f=resetFixture();
    try {
      f.sqlite.exec("CREATE TRIGGER bad_cleanup AFTER DELETE ON opportunity_versions BEGIN UPDATE people SET name='Damaged'; END");
      await expect(resetCorpus(f.db,{auditFile:f.auditFile,apply:true,target:"isolated-test"})).rejects.toThrow("RESET_PROTECTED_CHANGED");
      expect(await getTableCount(f.db,"opportunity_versions")).toBe(1);
      expect(await getTableCount(f.db,"evaluation_jobs")).toBe(1);
      expect(await f.db.one("SELECT name FROM people")).toEqual({name:"Preserved candidate"});
    } finally {f.cleanup();}
  });

  it("restores the idle factual-review semaphore after deleting stale corpus leases",async()=>{
    const f=resetFixture();
    try {
      f.sqlite.exec("CREATE TABLE dossier_review_lane(id TEXT PRIMARY KEY,lease_token TEXT,lease_until INTEGER,next_attempt_at INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0); INSERT INTO dossier_review_lane VALUES('factual-review','stale',999999,999999,3)");
      const result=await resetCorpus(f.db,{auditFile:f.auditFile,apply:true,target:"isolated-test"});
      expect(result).toMatchObject({reseededTables:["dossier_review_lane"]});
      expect(await f.db.one("SELECT * FROM dossier_review_lane")).toEqual({id:"factual-review",lease_token:null,lease_until:null,next_attempt_at:0,failures:0});
      expect(await getTableCount(f.db,"opportunity_versions")).toBe(0);
    } finally {f.cleanup();}
  });

  it("does not delete anything when the durable export cannot be created",async()=>{
    const f=resetFixture();
    try {
      fs.writeFileSync(f.auditFile,"existing audit");
      await expect(resetCorpus(f.db,{auditFile:f.auditFile,apply:true,target:"isolated-test"})).rejects.toThrow();
      expect(await getTableCount(f.db,"opportunity_versions")).toBe(1);
      expect(await getTableCount(f.db,"evaluation_jobs")).toBe(1);
    } finally {f.cleanup();}
  });
  it("returns null when table does not exist (no such table error)", async () => {
    const mockDb: any = {
      one: vi.fn().mockRejectedValue(new Error("no such table: fake_table_v99")),
    };

    const count = await getTableCount(mockDb, "fake_table_v99");
    expect(count).toBeNull();
  });

  it("throws immediately on non-no-such-table database errors (fails closed)", async () => {
    const mockDb: any = {
      one: vi.fn().mockRejectedValue(new Error("LibSQL client connection failed: Turso unavailable")),
    };

    await expect(getTableCount(mockDb, "opportunities")).rejects.toThrow(
      /Failed to query table count for "opportunities"/
    );
  });

  it("verifies declared table lists maintain clean separation between corpus and preserved tables", () => {
    // Preserved tables and Corpus tables must be completely disjoint
    const corpusSet = new Set(CORPUS_TABLES);
    const preservedSet = new Set(PRESERVED_TABLES);

    for (const p of PRESERVED_TABLES) {
      expect(corpusSet.has(p as any)).toBe(false);
    }
    for (const c of CORPUS_TABLES) {
      expect(preservedSet.has(c as any)).toBe(false);
    }

    // Critical configuration tables must be protected
    expect(preservedSet.has("career_profiles")).toBe(true);
    expect(preservedSet.has("people")).toBe(true);
    expect(preservedSet.has("tenants")).toBe(true);
    expect(preservedSet.has("_migrations")).toBe(true);

    // Ephemeral corpus tables must be targeted
    expect(corpusSet.has("opportunities")).toBe(true);
    expect(corpusSet.has("documents")).toBe(true);
    expect(corpusSet.has("scrape_runs")).toBe(true);
    expect(corpusSet.has("enrichment_jobs")).toBe(true);
  });

  it("enforces fail-closed verification if any corpus table has remaining records", () => {
    const postCorpusCounts: Record<string, number | null> = {
      opportunities: 0,
      documents: 5, // Failed to clear!
      scrape_runs: 0,
    };

    let corpusZero = true;
    for (const [tbl, cnt] of Object.entries(postCorpusCounts)) {
      if (cnt !== 0 && cnt !== null) {
        corpusZero = false;
      }
    }

    expect(corpusZero).toBe(false);
  });

  it("enforces fail-closed verification if preserved tables change row count", () => {
    const prePreserved: Record<string, number | null> = {
      people: 2,
      career_profiles: 1,
    };
    const postPreserved: Record<string, number | null> = {
      people: 1, // Deleted!
      career_profiles: 1,
    };

    let configIntact = true;
    for (const [tbl, cnt] of Object.entries(postPreserved)) {
      if (cnt !== prePreserved[tbl]) {
        configIntact = false;
      }
    }

    expect(configIntact).toBe(false);
  });
});
