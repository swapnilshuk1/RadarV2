/**
 * SqliteEvaluationContextStore.ts
 *
 * Phase M3: Tenant-Scoped Evaluation Context Repository.
 *
 * Invariants:
 * 1. Scope Enforcement: All operations require AuthorizedPersonScope.
 * 2. SQL Boundary: Queries enforce `tenant_id = scope.tenantId AND person_id = scope.personId`.
 * 3. Immutability: EvaluationContext and SearchPlanSnapshot are strictly immutable — NO UPDATE/PATCH API.
 */

import type { DatabaseAdapter } from "@/data/database/adapter";
import type { AuthorizedPersonScope } from "../../../lib/security/auth";
import type {
  SearchPlan,
  SearchPlanSnapshot,
  SearchCriteriaPayload,
  EvaluationContext,
} from "@/lib/domain/evaluation_context";
import {
  computeSearchPlanSnapshotHash,
  computeEvaluationContextFingerprint,
} from "@/lib/domain/evaluation_fingerprint";
import crypto from "node:crypto";

export interface SearchPlanActivationInput {
  title: string;
  criteria: SearchCriteriaPayload;
  ontologyVersion: string;
  ontologyFingerprint: string;
  policyVersion: string;
  profileVersion: string;
  activatedBy: string;
}

export interface ActivatedSearchPlan {
  plan: SearchPlan;
  snapshot: SearchPlanSnapshot;
  context: EvaluationContext;
}

export class SqliteEvaluationContextStore {
  constructor(private db: DatabaseAdapter) {}

  /**
   * Replaces the active search plan for one authorized person as one durable
   * transaction.  A reader can therefore observe either the prior active
   * lineage or the complete replacement lineage, never a partial plan.
   */
  async replaceActiveSearchPlan(
    scope: AuthorizedPersonScope,
    input: SearchPlanActivationInput
  ): Promise<ActivatedSearchPlan> {
    const now = new Date().toISOString();
    const planId = `sp_${crypto.randomUUID()}`;
    const snapshotHash = computeSearchPlanSnapshotHash(input.criteria);
    // Snapshot hashes describe content, not identity. Two successive plans can
    // intentionally have identical criteria, so the row id must remain unique.
    const snapshotId = `sps_${crypto.randomUUID()}`;
    const contextFingerprint = computeEvaluationContextFingerprint({
      tenantId: scope.tenantId,
      personId: scope.personId,
      searchPlanSnapshotId: snapshotId,
      ontologyVersion: input.ontologyVersion,
      ontologyFingerprint: input.ontologyFingerprint,
      policyVersion: input.policyVersion,
      profileVersion: input.profileVersion,
    });
    const criteriaJson = JSON.stringify(input.criteria);

    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
        [planId, scope.tenantId, scope.personId, input.title, criteriaJson, now, now]
      );

      await tx.execute(
        `INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [snapshotId, planId, scope.tenantId, scope.personId, snapshotHash, criteriaJson, now]
      );

      await tx.execute(
        `INSERT INTO evaluation_contexts (
           context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
           ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          contextFingerprint,
          scope.tenantId,
          scope.personId,
          snapshotId,
          input.ontologyVersion,
          input.ontologyFingerprint,
          input.policyVersion,
          input.profileVersion,
          now,
        ]
      );

      // The INSERT ... SELECT is deliberate: it keeps the database trigger as
      // the final authority for context-to-plan lineage.
      await tx.execute(
        `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id)
         SELECT ec.context_fingerprint, ec.tenant_id, ec.person_id, sps.search_plan_id
         FROM evaluation_contexts ec
         JOIN search_plan_snapshots sps ON sps.id = ec.search_plan_snapshot_id
         WHERE ec.context_fingerprint = ?
           AND ec.tenant_id = ?
           AND ec.person_id = ?
           AND sps.search_plan_id = ?`,
        [contextFingerprint, scope.tenantId, scope.personId, planId]
      );

      await tx.execute(
        `INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, person_id, search_plan_id)
         DO UPDATE SET context_fingerprint = excluded.context_fingerprint,
                       activated_at = CURRENT_TIMESTAMP,
                       activated_by = excluded.activated_by`,
        [scope.tenantId, scope.personId, planId, contextFingerprint, input.activatedBy]
      );

      // Retain immutable plan/context history while making the replacement the
      // sole routeable plan and pointer for this person.
      await tx.execute(
        `DELETE FROM active_evaluation_contexts
         WHERE tenant_id = ? AND person_id = ? AND search_plan_id <> ?`,
        [scope.tenantId, scope.personId, planId]
      );
      await tx.execute(
        `UPDATE search_plans
         SET status = 'archived', updated_at = ?
         WHERE tenant_id = ? AND person_id = ? AND status = 'active' AND id <> ?`,
        [now, scope.tenantId, scope.personId, planId]
      );
    });

    return {
      plan: {
        id: planId,
        tenantId: scope.tenantId,
        personId: scope.personId,
        title: input.title,
        status: "active",
        criteria: input.criteria,
        createdAt: now,
        updatedAt: now,
      },
      snapshot: {
        id: snapshotId,
        searchPlanId: planId,
        tenantId: scope.tenantId,
        personId: scope.personId,
        snapshotHash,
        payload: input.criteria,
        createdAt: now,
      },
      context: {
        contextFingerprint,
        tenantId: scope.tenantId,
        personId: scope.personId,
        searchPlanSnapshotId: snapshotId,
        ontologyVersion: input.ontologyVersion,
        ontologyFingerprint: input.ontologyFingerprint,
        policyVersion: input.policyVersion,
        profileVersion: input.profileVersion,
        createdAt: now,
      },
    };
  }

  /**
   * Creates a new search plan scoped to the authorized tenant and person.
   */
  async createSearchPlan(
    scope: AuthorizedPersonScope,
    title: string,
    criteria: SearchCriteriaPayload,
    id?: string
  ): Promise<SearchPlan> {
    const planId = id || `sp_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const criteriaJson = JSON.stringify(criteria);

    await this.db.execute(
      `INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      [planId, scope.tenantId, scope.personId, title, criteriaJson, now, now]
    );

    return {
      id: planId,
      tenantId: scope.tenantId,
      personId: scope.personId,
      title,
      status: "active",
      criteria,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Retrieves a search plan by ID within the authorized tenant scope.
   */
  async getSearchPlan(
    scope: AuthorizedPersonScope,
    id: string
  ): Promise<SearchPlan | undefined> {
    const row = await this.db.one<any>(
      `SELECT id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at
       FROM search_plans
       WHERE id = ? AND tenant_id = ? AND person_id = ?`,
      [id, scope.tenantId, scope.personId]
    );

    if (!row) return undefined;

    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      title: row.title,
      status: row.status,
      criteria: JSON.parse(row.criteria_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Creates an immutable snapshot of search plan criteria.
   * snapshotHash is computed via deterministic canonical serialization of criteria.
   */
  async createSearchPlanSnapshot(
    scope: AuthorizedPersonScope,
    searchPlanId: string,
    criteria: SearchCriteriaPayload
  ): Promise<SearchPlanSnapshot> {
    // Verify search plan ownership first
    const plan = await this.getSearchPlan(scope, searchPlanId);
    if (!plan) {
      throw new Error(
        `SearchPlan '${searchPlanId}' not found for tenant '${scope.tenantId}' and person '${scope.personId}'`
      );
    }

    const snapshotHash = computeSearchPlanSnapshotHash(criteria);
    // The content hash is unique only within a plan. Keep the row identity
    // independent so two plans with identical criteria remain valid lineage.
    const snapshotId = `sps_${crypto.randomUUID()}`;
    const payloadJson = JSON.stringify(criteria);
    const now = new Date().toISOString();

    // Idempotent insertion on (search_plan_id, snapshot_hash)
    await this.db.execute(
      `INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(search_plan_id, snapshot_hash) DO NOTHING`,
      [snapshotId, searchPlanId, scope.tenantId, scope.personId, snapshotHash, payloadJson, now]
    );

    const existing = await this.getSearchPlanSnapshotByHash(scope, searchPlanId, snapshotHash);
    return existing!;
  }

  /**
   * Retrieves a search plan snapshot by ID within authorized scope.
   */
  async getSearchPlanSnapshot(
    scope: AuthorizedPersonScope,
    snapshotId: string
  ): Promise<SearchPlanSnapshot | undefined> {
    const row = await this.db.one<any>(
      `SELECT id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at
       FROM search_plan_snapshots
       WHERE id = ? AND tenant_id = ? AND person_id = ?`,
      [snapshotId, scope.tenantId, scope.personId]
    );

    if (!row) return undefined;

    return {
      id: row.id,
      searchPlanId: row.search_plan_id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      snapshotHash: row.snapshot_hash,
      payload: JSON.parse(row.payload_json),
      createdAt: row.created_at,
    };
  }

  private async getSearchPlanSnapshotByHash(
    scope: AuthorizedPersonScope,
    searchPlanId: string,
    snapshotHash: string
  ): Promise<SearchPlanSnapshot | undefined> {
    const row = await this.db.one<any>(
      `SELECT id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at
       FROM search_plan_snapshots
       WHERE search_plan_id = ? AND snapshot_hash = ? AND tenant_id = ? AND person_id = ?`,
      [searchPlanId, snapshotHash, scope.tenantId, scope.personId]
    );

    if (!row) return undefined;

    return {
      id: row.id,
      searchPlanId: row.search_plan_id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      snapshotHash: row.snapshot_hash,
      payload: JSON.parse(row.payload_json),
      createdAt: row.created_at,
    };
  }

  /**
   * Creates an immutable EvaluationContext.
   * Generates deterministic contextFingerprint.
   * If identical context exists, returns it idempotently without mutating.
   */
  async createEvaluationContext(
    scope: AuthorizedPersonScope,
    params: {
      searchPlanSnapshotId: string;
      ontologyVersion: string;
      ontologyFingerprint: string;
      policyVersion: string;
      profileVersion: string;
    }
  ): Promise<EvaluationContext> {
    // Verify snapshot belongs to this authorized scope
    const snapshot = await this.getSearchPlanSnapshot(scope, params.searchPlanSnapshotId);
    if (!snapshot) {
      throw new Error(
        `SearchPlanSnapshot '${params.searchPlanSnapshotId}' not found for tenant '${scope.tenantId}' and person '${scope.personId}'`
      );
    }

    const contextFingerprint = computeEvaluationContextFingerprint({
      tenantId: scope.tenantId,
      personId: scope.personId,
      searchPlanSnapshotId: params.searchPlanSnapshotId,
      ontologyVersion: params.ontologyVersion,
      ontologyFingerprint: params.ontologyFingerprint,
      policyVersion: params.policyVersion,
      profileVersion: params.profileVersion,
    });

    const now = new Date().toISOString();

    await this.db.execute(
      `INSERT INTO evaluation_contexts (
         context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
         ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(context_fingerprint) DO NOTHING`,
      [
        contextFingerprint,
        scope.tenantId,
        scope.personId,
        params.searchPlanSnapshotId,
        params.ontologyVersion,
        params.ontologyFingerprint,
        params.policyVersion,
        params.profileVersion,
        now,
      ]
    );

    const existing = await this.getEvaluationContext(scope, contextFingerprint);
    return existing!;
  }

  /**
   * Retrieves an EvaluationContext by fingerprint within the authorized tenant scope.
   */
  async getEvaluationContext(
    scope: AuthorizedPersonScope,
    contextFingerprint: string
  ): Promise<EvaluationContext | undefined> {
    const row = await this.db.one<any>(
      `SELECT context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
              ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
       FROM evaluation_contexts
       WHERE context_fingerprint = ? AND tenant_id = ? AND person_id = ?`,
      [contextFingerprint, scope.tenantId, scope.personId]
    );

    if (!row) return undefined;

    return {
      contextFingerprint: row.context_fingerprint,
      tenantId: row.tenant_id,
      personId: row.person_id,
      searchPlanSnapshotId: row.search_plan_snapshot_id,
      ontologyVersion: row.ontology_version,
      ontologyFingerprint: row.ontology_fingerprint,
      policyVersion: row.policy_version,
      profileVersion: row.profile_version,
      createdAt: row.created_at,
    };
  }
}
