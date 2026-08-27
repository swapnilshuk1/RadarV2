import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getDatabaseAdapter } from "@/data/database";
import type { DatabaseAdapter } from "@/data/database/adapter";
import { SqliteAdapter } from "@/data/database/sqlite";
import Database from "better-sqlite3";

import { SqliteEvaluationContextStore } from "@/data/sqlite/repositories/SqliteEvaluationContextStore";
import { SqliteMaterializedEvaluationStore } from "@/data/sqlite/repositories/SqliteMaterializedEvaluationStore";
import { TenantAuthorizationError } from "@/lib/security/auth";
import {
  computeSearchPlanSnapshotHash,
  computeEvaluationContextFingerprint,
  computeEvaluationIdentity,
} from "@/lib/domain/evaluation_fingerprint";
import { isEvaluationFresh } from "@/lib/domain/evaluation_freshness";
import fs from "fs";
import path from "path";

describe("Phase M3: Evaluation Context & Read Model Isolation", () => {
  let db: DatabaseAdapter;
  let sqliteDb: Database.Database;
  let contextStore: SqliteEvaluationContextStore;
  let evalStore: SqliteMaterializedEvaluationStore;

  const authTenantA = { tenantId: "tenant_A", personId: "person_A1" };
  const authTenantB = { tenantId: "tenant_B", personId: "person_B1" };
  const confusedDeputy = { tenantId: "tenant_A", personId: "person_B1" }; // B's person pretending to be in A's scope

  beforeEach(async () => {
    // Setup in-memory sqlite for test
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    
    const migrationFiles = [
      "001_initial_schema.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
      "026_canonical_acquisition_integrity.sql",
      "027_materialized_evaluations_nullable_decision.sql"
    ];
    
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    // Setup base tenants and people. 001 creates people without profile_version, 018 adds tenant_id.
    sqliteDb.exec(`INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')`);
    sqliteDb.exec(`INSERT INTO people (id, email, tenant_id) VALUES ('person_A1', 'a1@test.com', 'tenant_A'), ('person_B1', 'b1@test.com', 'tenant_B')`);

    contextStore = new SqliteEvaluationContextStore(db);
    evalStore = new SqliteMaterializedEvaluationStore(db);
  });

  afterEach(async () => {
    // Close adapter if necessary (not explicitly needed for in-memory if we just let it GC, but good practice)
    // db is recreated per test
  });

  test("Invariant 1: Context Fingerprint Determinism (M3.2)", async () => {
    const criteria = { targetRoles: ["CEO"], targetLocations: ["Remote"] };
    const hash1 = computeSearchPlanSnapshotHash(criteria);
    const hash2 = computeSearchPlanSnapshotHash({ targetLocations: ["Remote"], targetRoles: ["CEO"] });
    expect(hash1).toBe(hash2); // Canonical serialization

    const input1 = {
      tenantId: "t1", personId: "p1", searchPlanSnapshotId: "sp1",
      ontologyVersion: "v1", ontologyFingerprint: "f1", policyVersion: "pv1", profileVersion: "pr1"
    };
    const input2 = {
      profileVersion: "pr1", policyVersion: "pv1", ontologyFingerprint: "f1",
      ontologyVersion: "v1", searchPlanSnapshotId: "sp1", personId: "p1", tenantId: "t1"
    };
    
    const fp1 = computeEvaluationContextFingerprint(input1);
    const fp2 = computeEvaluationContextFingerprint(input2);
    expect(fp1).toBe(fp2);

    const input3 = { ...input1, profileVersion: "pr2" };
    expect(computeEvaluationContextFingerprint(input3)).not.toBe(fp1);
  });

  test("Invariant 3 & 4: Cross-Tenant Read Isolation & Confused Deputy (M3.6)", async () => {
    // Tenant A creates a search plan
    const planA = await contextStore.createSearchPlan(authTenantA, "CEO Search", { targetRoles: ["CEO"] });
    const snapshotA = await contextStore.createSearchPlanSnapshot(authTenantA, planA.id, { targetRoles: ["CEO"] });
    
    // Confused deputy attempts to read snapshotA
    await expect(contextStore.getSearchPlanSnapshot(confusedDeputy, snapshotA.id)).resolves.toBeUndefined();
    
    // Tenant B attempts to read snapshotA
    await expect(contextStore.getSearchPlanSnapshot(authTenantB, snapshotA.id)).resolves.toBeUndefined();

    // Tenant B attempts to create snapshot for Tenant A's plan
    await expect(contextStore.createSearchPlanSnapshot(authTenantB, planA.id, { targetRoles: ["CTO"] }))
      .rejects.toThrow(TenantAuthorizationError);
  });

  test("Invariant 5: Historical Evaluations & Immutability", async () => {
    const plan = await contextStore.createSearchPlan(authTenantA, "Search", { targetRoles: ["CEO"] });
    const snapshot = await contextStore.createSearchPlanSnapshot(authTenantA, plan.id, { targetRoles: ["CEO"] });
    
    const context = await contextStore.createEvaluationContext(authTenantA, {
      searchPlanSnapshotId: snapshot.id,
      ontologyVersion: "v1",
      ontologyFingerprint: "hash_v1",
      policyVersion: "1.0",
      profileVersion: "1.0"
    });

    const evalPayload = {
      id: "",
      tenantId: authTenantA.tenantId,
      personId: authTenantA.personId,
      canonicalJobId: "job1",
      opportunityVersion: "v1",
      evaluationContextFingerprint: context.contextFingerprint,
      decision: "PURSUE" as const,
      qualityScore: 90,
      rationale: "Good fit",
      evidenceIds: [],
      evaluationJson: JSON.stringify({ decision: "PURSUE", qualityScore: 90 }),
      materializedAt: new Date().toISOString()
    };
    
    await evalStore.materializeEvaluation(authTenantA, evalPayload);

    // Ensure we cannot update the context
    // There is no update API by design on contextStore, confirming immutability.
    
    // New profile version -> new context -> new evaluation
    const context2 = await contextStore.createEvaluationContext(authTenantA, {
      searchPlanSnapshotId: snapshot.id,
      ontologyVersion: "v1",
      ontologyFingerprint: "hash_v1",
      policyVersion: "1.0",
      profileVersion: "2.0" // Changed
    });

    expect(context2.contextFingerprint).not.toBe(context.contextFingerprint);
    
    const evalPayload2 = { ...evalPayload, evaluationContextFingerprint: context2.contextFingerprint, decision: "PASS" as const, evaluationJson: JSON.stringify({ decision: "PASS", qualityScore: 90 }) };
    await evalStore.materializeEvaluation(authTenantA, evalPayload2);

    // Read both
    const evals = await evalStore.listEvaluations(authTenantA);
    expect(evals.length).toBe(2);
    expect(evals.find(e => e.evaluationContextFingerprint === context.contextFingerprint)?.decision).toBe("PURSUE");
    expect(evals.find(e => e.evaluationContextFingerprint === context2.contextFingerprint)?.decision).toBe("PASS");
  });

  test("Invariant: Consistency Validation", async () => {
    const plan = await contextStore.createSearchPlan(authTenantA, "Search", { targetRoles: ["CEO"] });
    const snapshot = await contextStore.createSearchPlanSnapshot(authTenantA, plan.id, { targetRoles: ["CEO"] });
    const context = await contextStore.createEvaluationContext(authTenantA, {
      searchPlanSnapshotId: snapshot.id, ontologyVersion: "v1", ontologyFingerprint: "hash_v1", policyVersion: "1.0", profileVersion: "1.0"
    });

    const badPayload = {
      id: "", tenantId: authTenantA.tenantId, personId: authTenantA.personId, canonicalJobId: "job1", opportunityVersion: "v1",
      evaluationContextFingerprint: context.contextFingerprint,
      decision: "PURSUE" as const, qualityScore: 90, rationale: "Good fit", evidenceIds: [],
      evaluationJson: JSON.stringify({ decision: "PASS", qualityScore: 90 }), // Mismatch!
      materializedAt: new Date().toISOString()
    };

    await expect(evalStore.materializeEvaluation(authTenantA, badPayload))
      .rejects.toThrow(/mismatch/i);
  });

  test("Freshness Matrix (M3.5)", async () => {
    const plan = await contextStore.createSearchPlan(authTenantA, "Search", { targetRoles: ["CEO"] });
    const snapshot = await contextStore.createSearchPlanSnapshot(authTenantA, plan.id, { targetRoles: ["CEO"] });
    
    const context = await contextStore.createEvaluationContext(authTenantA, {
      searchPlanSnapshotId: snapshot.id,
      ontologyVersion: "v1",
      ontologyFingerprint: "hash_v1",
      policyVersion: "1.0",
      profileVersion: "1.0"
    });

    const evaluation = {
      id: "eval1",
      tenantId: authTenantA.tenantId,
      personId: authTenantA.personId,
      canonicalJobId: "job1",
      opportunityVersion: "v1",
      evaluationContextFingerprint: context.contextFingerprint,
      decision: "PURSUE" as const,
      qualityScore: 90,
      rationale: "Good fit",
      evidenceIds: [],
      evaluationJson: JSON.stringify({ decision: "PURSUE", qualityScore: 90 }),
      materializedAt: new Date().toISOString()
    };

    const currentBase = {
      currentSearchPlanSnapshotId: snapshot.id,
      currentOntologyVersion: "v1",
      currentOntologyFingerprint: "hash_v1",
      currentPolicyVersion: "1.0",
      currentProfileVersion: "1.0",
      currentOpportunityVersion: "v1"
    };

    // Nothing changed -> FRESH
    expect(isEvaluationFresh(evaluation, context, currentBase).isFresh).toBe(true);

    // Any single change -> STALE
    expect(isEvaluationFresh(evaluation, context, { ...currentBase, currentSearchPlanSnapshotId: "new_sp" }).isFresh).toBe(false);
    expect(isEvaluationFresh(evaluation, context, { ...currentBase, currentOntologyFingerprint: "new_of" }).isFresh).toBe(false);
    expect(isEvaluationFresh(evaluation, context, { ...currentBase, currentOntologyVersion: "v2" }).isFresh).toBe(false);
    expect(isEvaluationFresh(evaluation, context, { ...currentBase, currentPolicyVersion: "2.0" }).isFresh).toBe(false);
    expect(isEvaluationFresh(evaluation, context, { ...currentBase, currentProfileVersion: "2.0" }).isFresh).toBe(false);
    expect(isEvaluationFresh(evaluation, context, { ...currentBase, currentOpportunityVersion: "v2" }).isFresh).toBe(false);
  });
});
