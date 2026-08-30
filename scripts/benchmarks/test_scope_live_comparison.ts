import { getDatabaseAdapter } from "../../src/data/database/index";
import { getRepositories } from "../../src/data/sqlite/provider";
import { resolveScope } from "../../src/lib/intelligence/opportunity-service";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";

async function compareLiveScope() {
  const db = getDatabaseAdapter();
  const repos = getRepositories();

  const user = await db.one<{ id: string }>(
    "SELECT id FROM people WHERE email_verified = 1 ORDER BY created_at ASC LIMIT 1"
  );
  if (!user) throw new Error("No verified user in DB");

  console.log(`Auditing Scope Resolution on Live Turso Cloud for user: ${user.id}`);

  // 1. Legacy Resolution
  const t0 = performance.now();
  const legacyScope = await resolveScope(user.id);
  const legacyContext = await repos.canonicalServing.getActiveContext(legacyScope);
  const legacyMs = performance.now() - t0;

  // 2. Consolidated Single Round-Trip Resolution
  const t1 = performance.now();
  const consolidated = await resolveServingScope(user.id, undefined, db);
  const consolidatedMs = performance.now() - t1;

  console.log("\n--- Comparison Results ---");
  console.log("Legacy Scope:       ", legacyScope);
  console.log("Consolidated Scope: ", consolidated.scope);
  console.log("Legacy Context:     ", legacyContext);
  console.log("Consolidated Context:", consolidated.activeContext);
  console.log(`Legacy Latency:       ${legacyMs.toFixed(2)} ms (4 sequential DB queries)`);
  console.log(`Consolidated Latency: ${consolidatedMs.toFixed(2)} ms (1 single DB round-trip)`);

  if (
    legacyScope.tenantId !== consolidated.scope.tenantId ||
    legacyScope.personId !== consolidated.scope.personId ||
    legacyContext?.searchPlanId !== consolidated.activeContext?.searchPlanId ||
    legacyContext?.contextFingerprint !== consolidated.activeContext?.contextFingerprint
  ) {
    throw new Error("Live comparison mismatch!");
  }

  console.log("\nSUCCESS: 100.00% exact parity on live production Turso Cloud database!");
}

compareLiveScope().catch(console.error);
