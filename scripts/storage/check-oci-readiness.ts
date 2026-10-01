import { loadUnifiedEnvironment } from "../../src/lib/env";
import { getDatabaseAdapter } from "../../src/data/database";
import { OciObjectBlobStore, ociOptionsFromEnv } from "../../src/lib/storage/oci-blob-store";

loadUnifiedEnvironment();
const database = getDatabaseAdapter();
const store = new OciObjectBlobStore(ociOptionsFromEnv());
const references = await database.many<{ key: string; category: string }>(`
 SELECT DISTINCT source_payload_key AS key, 'canonical_source' AS category
 FROM opportunity_versions WHERE source_payload_key IS NOT NULL AND source_payload_key!=''
 UNION SELECT DISTINCT payload_key AS key, 'active_processing' AS category
 FROM enrichment_jobs WHERE status NOT IN ('COMPLETE','FAILED') AND payload_key IS NOT NULL AND payload_key!=''`);
const keys = new Map<string, string[]>();
for (const reference of references) keys.set(reference.key, [...new Set([...(keys.get(reference.key) || []), reference.category])]);
const missing: Array<{ key: string; categories: string[] }> = [];
let verified = 0;
try {
 await store.healthCheck();
 for (const [key, categories] of keys) {
  // GET validates persisted checksums, not merely the existence of a named object.
  if (await store.get(key) === null) missing.push({ key, categories });
  else verified++;
 }
 console.log(JSON.stringify({ ready: missing.length === 0, references: keys.size, verified,
   missingCanonical: missing.filter(r => r.categories.includes('canonical_source')).length,
   missingActive: missing.filter(r => r.categories.includes('active_processing')).length,
   missing }, null, 2));
 if (missing.length) process.exitCode = 1;
} finally { await database.close?.(); }
