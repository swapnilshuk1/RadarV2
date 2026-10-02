import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getDatabaseAdapter, getDatabaseTargetIdentity } from "../../src/data/database";
import type { DatabaseAdapter } from "../../src/data/database/adapter";
import { loadUnifiedEnvironment } from "../../src/lib/env";

export const PRESERVED_TABLES = ["tenants", "users", "memberships", "people", "career_profiles",
 "candidate_projection", "candidate_documents", "document_contents", "evidence_graphs", "candidate_claims",
 "career_intents", "candidate_archetypes", "search_plans", "search_plan_snapshots", "evaluation_contexts",
 "source_credentials", "canonical_opportunities", "_migrations"] as const;

// Exact allowlist. Everything outside it is protected by a content fingerprint.
export const CORPUS_TABLES = [
 "recovery_queue", "materialized_evaluations", "evaluation_jobs", "search_plan_candidates",
 "acquisition_ingestion_lineage", "opportunity_versions", "canonical_decisions", "decisions",
 "fact_evidence", "claim_facts", "match_claims", "evidence", "facts", "claims", "matches", "assessments",
 "assessment_records", "recommendations", "recommendation_snapshots", "candidate_evaluations", "dossier_views",
 "evaluation_signatures", "opportunity_discoveries", "documents", "opportunities", "acquisition_ledger",
 "enrichment_events", "enrichment_jobs", "scrape_run_events", "scrape_runs", "evaluation_requirements",
 "scrape_run_evaluation_requirements", "scrape_run_enrichment_requirements", "materialized_dossier_presentations",
 "staged_evaluations", "dossier_model_checkpoints", "dossier_review_jobs", "dossier_review_lane",
 "staged_frozen_inputs", "staged_model_checkpoints", "dossier_composition_jobs", "acquisition_ingress_submissions",
 "staged_source_evidence_cache", "corpus_regeneration_jobs", "opportunity_pursuits", "pursuit_theses",
 "pursuit_artifacts", "pursuit_activities", "candidate_learning_signals", "pursuit_preparation_jobs",
 "pursuit_stage_checkpoints", "pursuit_ledger_projection_state", "model_invocations", "timeline_events",
 "intelligence_claim_edges", "intelligence_claims", "intelligence_source_documents", "intelligence_sources",
 "intelligence_company_entities",
] as const;

const quoted = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const fingerprint = (rows: unknown[]) => createHash("sha256").update(serialize(rows.map(serialize).sort())).digest("hex");
export async function getTableCount(db: DatabaseAdapter, tableName: string): Promise<number | null> {
 try { return (await db.one<{cnt: number}>(`SELECT COUNT(*) AS cnt FROM ${quoted(tableName)}`))?.cnt ?? 0; }
 catch (error) {
  if ((error as Error).message.includes("no such table")) return null;
  throw new Error(`Failed to query table count for "${tableName}": ${(error as Error).message}`);
 }
}

function saveExclusive(file: string, value: unknown) {
 fs.mkdirSync(path.dirname(file), {recursive:true});
 const fd = fs.openSync(file, "wx", 0o600);
 try { fs.writeFileSync(fd, serialize(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export async function resetCorpus(db: DatabaseAdapter, options: { auditFile: string; apply: boolean; target: string; missingKeys?: string[] }) {
 return db.transaction(async tx => {
  const schema = await tx.many<{name:string; sql:string}>("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const triggers = await tx.many("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name");
  const indexes = await tx.many("SELECT name,sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name");
  const views = await tx.many("SELECT name,sql FROM sqlite_master WHERE type='view' ORDER BY name");
  const names = new Set(schema.map(t=>t.name));
  const selected = CORPUS_TABLES.filter(t=>names.has(t));
  const allRows: Record<string, unknown[]> = {};
  for(const table of schema) allRows[table.name] = await tx.many(`SELECT * FROM ${quoted(table.name)}`);
  const versions = allRows.opportunity_versions as Array<Record<string, unknown>>;
  const identities = new Map((allRows.canonical_opportunities as Array<Record<string, unknown>>).map(r=>[r.id,r]));
  const evaluations = [...(allRows.materialized_evaluations||[]), ...(allRows.staged_evaluations||[])] as Array<Record<string,unknown>>;
  const missing = new Set(options.missingKeys || []);
  const discardedVersions = versions.map(v=>({versionId:v.id, canonicalJobId:v.canonical_job_id,
   url:identities.get(v.canonical_job_id)?.canonical_url, sourceKey:v.source_payload_key,
   missingOriginal:missing.has(String(v.source_payload_key)),
   evaluationIds:evaluations.filter(e=>e.opportunity_version===v.id).map(e=>e.id)}));
  const audit = {createdAt:new Date().toISOString(),target:options.target,apply:options.apply,schema,triggers,indexes,views,
   discardedVersions, counts:Object.fromEntries(Object.entries(allRows).map(([t,r])=>[t,r.length])), rows:allRows};
  // Durable full export exists before the first DELETE; a failed export aborts.
  saveExclusive(options.auditFile,audit);
  if(!options.apply) return {applied:false,versions:versions.length,tables:selected.length,auditFile:options.auditFile};

  // Derive child-before-parent order from the actual deployed schema. Never disable FKs.
  const edges = new Map<string,string[]>();
  for(const table of selected) {
   const foreignKeys = await tx.many<{table:string}>(`PRAGMA foreign_key_list(${quoted(table)})`);
   edges.set(table, [...new Set(foreignKeys.map(f=>f.table).filter(p=>selected.includes(p as typeof selected[number]) && p!==table))]);
  }
  const order:string[]=[]; const remaining=new Set<string>(selected);
  while(remaining.size) {
   const leaves=[...remaining].filter(parent=>![...remaining].some(child=>edges.get(child)?.includes(parent)));
   if(!leaves.length) throw new Error("RESET_FOREIGN_KEY_CYCLE: refusing partial reset");
   for(const leaf of leaves){order.push(leaf);remaining.delete(leaf);}
  }
  const protectedHashes = new Map(schema.filter(t=>!selected.includes(t.name as typeof selected[number])).map(t=>[t.name,fingerprint(allRows[t.name])]));
  const deleted:Record<string,number>={};
  for(const table of order) deleted[table]=(await tx.execute(`DELETE FROM ${quoted(table)}`)).rowsAffected;
  for(const table of selected) if(await getTableCount(tx,table)!==0) throw new Error(`RESET_NOT_EMPTY: ${table}`);
  for(const [table,hash] of protectedHashes) if(fingerprint(await tx.many(`SELECT * FROM ${quoted(table)}`))!==hash) throw new Error(`RESET_PROTECTED_CHANGED: ${table}`);
  if((await tx.many("PRAGMA foreign_key_check")).length) throw new Error("RESET_FOREIGN_KEY_CHECK_FAILED");
  if(serialize(await tx.many("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name"))!==serialize(triggers)) throw new Error("RESET_TRIGGERS_CHANGED");
  // This is a migration-seeded semaphore, not a discarded dossier. Restore its
  // idle row after clearing the old lease/backoff so the review worker can claim.
  const reseededTables:string[]=[];
  if(names.has("dossier_review_lane")) {
   await tx.execute("INSERT INTO dossier_review_lane(id) VALUES('factual-review')");
   reseededTables.push("dossier_review_lane");
  }
  return {applied:true,versions:versions.length,deleted,preservedTables:protectedHashes.size,reseededTables,auditFile:options.auditFile};
 });
}

async function main() {
 loadUnifiedEnvironment();
 const db=getDatabaseAdapter();
 const target=getDatabaseTargetIdentity().fingerprint;
 const expected=process.argv.find(a=>a.startsWith("--target="))?.slice(9);
 const apply=process.argv.includes("--confirm");
 if(apply && expected!==target) throw new Error("RESET_TARGET_MISMATCH: --target=<database fingerprint> required");
 const auditFile=path.resolve(process.argv.find(a=>a.startsWith("--audit="))?.slice(8) || `.radar/reset-audit-${Date.now()}.json`);
 const manifest=process.argv.find(a=>a.startsWith("--missing-manifest="))?.slice(19);
 const missingKeys=manifest ? JSON.parse(fs.readFileSync(manifest,"utf8")).records.filter((r:{status:string})=>r.status==="MISSING_ON_THIS_HOST").map((r:{key:string})=>r.key) : [];
 try {
  const result=await resetCorpus(db,{auditFile,apply,target,missingKeys});
  saveExclusive(`${auditFile}.result.json`,result);
  console.log(serialize(result));
 } finally { await db.close?.(); }
}
if(process.env.NODE_ENV!=="test" && !process.env.VITEST) main().catch(error=>{console.error(error);process.exitCode=1;});
