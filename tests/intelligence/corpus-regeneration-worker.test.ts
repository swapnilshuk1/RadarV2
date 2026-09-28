import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { processNextCorpusRegenerationJob } from "../../scripts/run-corpus-regeneration-worker";
import type { DatabaseAdapter, QueryParams } from "../../src/data/database/DatabaseAdapter";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";

class TestDb implements DatabaseAdapter {
  constructor(readonly db: Database.Database) {}
  async one<T>(sql:string, params?:QueryParams) { return (this.db.prepare(sql).get(...(params || [])) as T) || null; }
  async many<T>(sql:string, params?:QueryParams) { return this.db.prepare(sql).all(...(params || [])) as T[]; }
  async execute(sql:string, params?:QueryParams) { const r=this.db.prepare(sql).run(...(params || [])); return { rowsAffected:r.changes,lastInsertRowid:r.lastInsertRowid }; }
  async transaction<T>(fn:(tx:DatabaseAdapter)=>Promise<T>) { this.db.exec("BEGIN"); try { const value=await fn(this); this.db.exec("COMMIT"); return value; } catch(error) { this.db.exec("ROLLBACK"); throw error; } }
}
const enqueue=(db:TestDb)=>db.execute("INSERT INTO corpus_regeneration_jobs(id,status,stage,logs_json,processed_count) VALUES('corpus-regeneration','queued','INGESTING','[]',0) ON CONFLICT(id) DO UPDATE SET status='queued' WHERE corpus_regeneration_jobs.status IN ('completed','failed')");

describe("durable corpus regeneration",()=>{
  it("queues once, claims through the worker, and persists terminal success",async()=>{
    const db=new TestDb(new Database(":memory:")); await runMigrations(db); await enqueue(db); await enqueue(db);
    let called=0; await processNextCorpusRegenerationJob("worker-a",async notify=>{called++;await notify?.("normalizing","NORMALIZING");return {success:true,processedCount:7};},db);
    expect(called).toBe(1);expect(await db.one<any>("SELECT status,stage,processed_count,locked_by,lease_token FROM corpus_regeneration_jobs")).toEqual({status:"completed",stage:"COMPLETE",processed_count:7,locked_by:null,lease_token:null});
  });
  it("persists failure and does not restart a claimed job",async()=>{
    const db=new TestDb(new Database(":memory:"));await runMigrations(db);await enqueue(db);let called=0;
    await processNextCorpusRegenerationJob("worker-a",async()=>{called++;return {success:false,error:"pipeline failed"};},db);
    expect(await db.one<any>("SELECT status,stage,error,locked_by,lease_token FROM corpus_regeneration_jobs")).toEqual({status:"failed",stage:"FAILED",error:"pipeline failed",locked_by:null,lease_token:null});
    await db.execute("UPDATE corpus_regeneration_jobs SET status='processing',locked_by='other' WHERE id='corpus-regeneration'");await enqueue(db);
    expect(await processNextCorpusRegenerationJob("worker-b",async()=>{called++;return {success:true,processedCount:1};},db)).toBe(false);expect(called).toBe(1);
  });
  it("keeps pipeline execution out of web runtime",()=>{const server=fs.readFileSync(path.resolve(process.cwd(),"src/lib/intelligence/scrape-server.ts"),"utf8");expect(server).toContain("INSERT INTO corpus_regeneration_jobs");expect(server).not.toContain("runCorpusPipeline");});
});
