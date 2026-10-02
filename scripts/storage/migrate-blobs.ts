import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadUnifiedEnvironment } from "../../src/lib/env";
import { getDatabaseAdapter } from "../../src/data/database";
import { OciObjectBlobStore, ociOptionsFromEnv } from "../../src/lib/storage/oci-blob-store";
import { byteHash } from "../../src/acquisition/handoff";

loadUnifiedEnvironment();
const argument = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length+3);
const root = path.resolve(argument("source") || ".radar/artifacts/blobs");
const manifestPath = path.resolve(argument("manifest") || ".radar/oci-transfer.json");
const copy = process.argv.includes("--copy");
const db = getDatabaseAdapter();
const references = await db.many<{ key: string; category: string }>(`
  SELECT DISTINCT source_payload_key AS key, 'canonical_source' AS category FROM opportunity_versions WHERE source_payload_key IS NOT NULL AND source_payload_key!=''
  UNION SELECT DISTINCT payload_key AS key, CASE WHEN status IN ('COMPLETE','FAILED') THEN 'terminal_processing' ELSE 'active_processing' END AS category
  FROM enrichment_jobs WHERE payload_key IS NOT NULL AND payload_key!=''`);
const byKey = new Map<string,string[]>();
for (const r of references) byKey.set(r.key,[...new Set([...(byKey.get(r.key)||[]),r.category])]);
const files: string[] = [];
function visit(directory: string) {
  for (const entry of fs.readdirSync(directory,{ withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Migration does not follow symlinks");
    const absolute = path.join(directory,entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile() && !entry.name.endsWith(".tmp")) files.push(path.relative(root,absolute).replaceAll("\\","/"));
  }
}
if (fs.existsSync(root)) visit(root);
const target = copy ? new OciObjectBlobStore(ociOptionsFromEnv()) : null;
const records: Array<Record<string,unknown>> = [];
function save() {
  fs.mkdirSync(path.dirname(manifestPath),{ recursive:true });
  const temporary = `${manifestPath}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify({ source: root, copied: copy, records },null,2));
  fs.renameSync(temporary,manifestPath);
}
for (const key of files) {
  const absolute = path.join(root,...key.split("/"));
  const bytes = fs.readFileSync(absolute);
  const record: Record<string,unknown> = { key, sizeBytes: bytes.length, sha256: byteHash(bytes), categories: byKey.get(key)||["unreferenced"], status: "INVENTORIED" };
  records.push(record);
  if (target && byKey.has(key)) {
    try {
      await target.put(key,bytes,"application/octet-stream");
      if (!(await target.get(key))?.equals(bytes)) throw new Error("Migration readback mismatch");
      record.status="VERIFIED";
    } catch (error) { record.status="FAILED"; record.error=(error as Error).name; }
    save();
  }
}
const available = new Set(files);
for (const [key,categories] of byKey) if (!available.has(key)) records.push({ key, categories, status:"MISSING_ON_THIS_HOST" });
save();
console.log(JSON.stringify({ source:root,copy,files:files.length,bytes:records.reduce((n,r)=>n+Number(r.sizeBytes||0),0),
  verified:records.filter(r=>r.status==='VERIFIED').length,failed:records.filter(r=>r.status==='FAILED').length,
  missingOnThisHost:records.filter(r=>r.status==='MISSING_ON_THIS_HOST').length,manifest:manifestPath }));
await db.close?.();
if (records.some(r=>r.status==='FAILED')) process.exitCode=1;
