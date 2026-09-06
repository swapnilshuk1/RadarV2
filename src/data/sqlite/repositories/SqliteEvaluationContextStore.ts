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

/** Immutable preflight evidence supplied by the operational-reset runner. */
export interface OperationalMarketResetInput {
  resetEventId: string;
  previousSearchPlanId: string;
  previousContextFingerprint: string;
  successorSearchPlanId: string;
  successorContextFingerprint: string;
  preResetManifestJson: string;
  preResetManifestSha256: string;
  candidateProfileHash: string;
  candidateProjectionHash: string;
  locationPolicy: string;
  releaseCommit: string;
  activatedBy: string;
}

export class SqliteEvaluationContextStore {
  constructor(private db: DatabaseAdapter) {}

  /**
   * Binds a context to an authorized immutable plan lineage. This is control
   * plane state, deliberately separate from the serving read model.
   */
  async bindEvaluationContextScope(
    contextFingerprint: string,
    tenantId: string,
    personId: string,
    searchPlanId: string,
  ): Promise<boolean> {
    const result = await this.db.execute(
      `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id)
       SELECT ec.context_fingerprint, ec.tenant_id, ec.person_id, sps.search_plan_id
       FROM evaluation_contexts ec
       JOIN search_plan_snapshots sps ON sps.id = ec.search_plan_snapshot_id
       WHERE ec.context_fingerprint = ? AND ec.tenant_id = ? AND ec.person_id = ? AND sps.search_plan_id = ?
       ON CONFLICT DO NOTHING`,
      [contextFingerprint, tenantId, personId, searchPlanId],
    );
    return result.rowsAffected > 0;
  }

  /** Activates only a previously bound context; callers cannot select a latest-context fallback. */
  async activateContextPointer(
    contextFingerprint: string,
    tenantId: string,
    personId: string,
    searchPlanId: string,
  ): Promise<boolean> {
    try {
      const bound = await this.db.one<{ context_fingerprint: string }>(
        `SELECT context_fingerprint FROM evaluation_context_scopes
         WHERE context_fingerprint = ? AND tenant_id = ? AND person_id = ? AND search_plan_id = ?`,
        [contextFingerprint, tenantId, personId, searchPlanId],
      );
      if (!bound) return false;
      await this.db.execute(
        `INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
         VALUES (?, ?, ?, ?, 'system')
         ON CONFLICT (tenant_id, person_id, search_plan_id)
         DO UPDATE SET context_fingerprint = excluded.context_fingerprint,
                       activated_at = CURRENT_TIMESTAMP,
                       activated_by = excluded.activated_by`,
        [tenantId, personId, searchPlanId, contextFingerprint],
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Returns only a current explicit pointer. Absence is an authorization/state error, never a chronology query. */
  async getActiveContext(scope: AuthorizedPersonScope): Promise<{ searchPlanId: string; contextFingerprint: string } | undefined> {
    const pointer = await this.db.one<{ search_plan_id: string; context_fingerprint: string }>(
      `SELECT aec.search_plan_id, aec.context_fingerprint
       FROM active_evaluation_contexts aec
       JOIN search_plans sp ON sp.id = aec.search_plan_id
         AND sp.tenant_id = aec.tenant_id AND sp.person_id = aec.person_id
       WHERE aec.tenant_id = ? AND aec.person_id = ? AND sp.status = 'active'
       ORDER BY aec.activated_at DESC
       LIMIT 1`,
      [scope.tenantId, scope.personId],
    );
    return pointer ? { searchPlanId: pointer.search_plan_id, contextFingerprint: pointer.context_fingerprint } : undefined;
  }

  /** Creates an inactive immutable plan/context lineage for pre-activation backfill. */
  async prepareSearchPlan(
    scope: AuthorizedPersonScope,
    input: SearchPlanActivationInput
  ): Promise<ActivatedSearchPlan> {
    const now = new Date().toISOString();
    const planId = `sp_${crypto.randomUUID()}`;
    const snapshotHash = computeSearchPlanSnapshotHash(input.criteria);
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
         VALUES (?, ?, ?, ?, 'paused', ?, ?, ?)`,
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
      await tx.execute(
        `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id)
         SELECT ec.context_fingerprint, ec.tenant_id, ec.person_id, sps.search_plan_id
         FROM evaluation_contexts ec
         JOIN search_plan_snapshots sps ON sps.id = ec.search_plan_snapshot_id
         WHERE ec.context_fingerprint = ? AND ec.tenant_id = ? AND ec.person_id = ? AND sps.search_plan_id = ?`,
        [contextFingerprint, scope.tenantId, scope.personId, planId]
      );
    });

    return {
      plan: {
        id: planId,
        tenantId: scope.tenantId,
        personId: scope.personId,
        title: input.title,
        status: "paused",
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

  /** Activates a prepared lineage only after its caller has completed backfill. */
  async activatePreparedSearchPlan(
    scope: AuthorizedPersonScope,
    planId: string,
    contextFingerprint: string,
    activatedBy: string
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const prepared = await tx.one<{ id: string }>(
        `SELECT sp.id
         FROM search_plans sp
         JOIN search_plan_snapshots sps ON sps.search_plan_id = sp.id
         JOIN evaluation_contexts ec ON ec.search_plan_snapshot_id = sps.id
         WHERE sp.id = ? AND sp.tenant_id = ? AND sp.person_id = ?
           AND sp.status = 'paused' AND ec.context_fingerprint = ?`,
        [planId, scope.tenantId, scope.personId, contextFingerprint]
      );
      if (!prepared) {
        throw new Error(`Prepared search plan '${planId}' is missing or no longer paused.`);
      }

      await tx.execute(
        `INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, person_id, search_plan_id)
         DO UPDATE SET context_fingerprint = excluded.context_fingerprint,
                       activated_at = CURRENT_TIMESTAMP,
                       activated_by = excluded.activated_by`,
        [scope.tenantId, scope.personId, planId, contextFingerprint, activatedBy]
      );
      await tx.execute(
        `DELETE FROM active_evaluation_contexts
         WHERE tenant_id = ? AND person_id = ? AND search_plan_id <> ?`,
        [scope.tenantId, scope.personId, planId]
      );
      await tx.execute(
        `UPDATE search_plans SET status = 'active', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ? AND person_id = ?`,
        [planId, scope.tenantId, scope.personId]
      );
      await tx.execute(
        `UPDATE search_plans SET status = 'archived', updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ? AND person_id = ? AND status = 'active' AND id <> ?`,
        [scope.tenantId, scope.personId, planId]
      );
    });
  }

  /**
   * Records and activates an operational market-corpus reset as one database
   * transaction. The successor must already be paused and intentionally empty.
   * Historic market records are not touched by this operation.
   */
  async activateOperationalMarketReset(
    scope: AuthorizedPersonScope,
    input: OperationalMarketResetInput,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const prior = await tx.one<{ search_plan_id: string; context_fingerprint: string }>(
        `SELECT search_plan_id, context_fingerprint FROM active_evaluation_contexts
         WHERE tenant_id = ? AND person_id = ?`,
        [scope.tenantId, scope.personId],
      );
      if (!prior || prior.search_plan_id !== input.previousSearchPlanId || prior.context_fingerprint !== input.previousContextFingerprint) {
        throw new Error("Operational reset preflight is stale: active context no longer matches its manifest.");
      }
      const prepared = await tx.one<{ id: string }>(
        `SELECT sp.id FROM search_plans sp JOIN search_plan_snapshots sps ON sps.search_plan_id = sp.id
         JOIN evaluation_contexts ec ON ec.search_plan_snapshot_id = sps.id
         WHERE sp.id = ? AND sp.tenant_id = ? AND sp.person_id = ? AND sp.status = 'paused'
           AND ec.context_fingerprint = ?`,
        [input.successorSearchPlanId, scope.tenantId, scope.personId, input.successorContextFingerprint],
      );
      if (!prepared) throw new Error("Operational reset successor is missing or no longer paused.");
      const candidates = await tx.one<{ count: number }>(
        `SELECT COUNT(*) AS count FROM search_plan_candidates WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ?`,
        [scope.tenantId, scope.personId, input.successorSearchPlanId],
      );
      if ((candidates?.count ?? 0) !== 0) throw new Error("Operational reset successor is not empty.");

      await tx.execute(
        `INSERT INTO market_corpus_reset_events (
           id, tenant_id, person_id, previous_search_plan_id, previous_context_fingerprint,
           successor_search_plan_id, successor_context_fingerprint, pre_reset_manifest_json,
           pre_reset_manifest_sha256, candidate_profile_hash, candidate_projection_hash,
           location_policy, release_commit, status, activated_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVATED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [input.resetEventId, scope.tenantId, scope.personId, input.previousSearchPlanId,
          input.previousContextFingerprint, input.successorSearchPlanId, input.successorContextFingerprint,
          input.preResetManifestJson, input.preResetManifestSha256, input.candidateProfileHash,
          input.candidateProjectionHash, input.locationPolicy, input.releaseCommit],
      );
      await tx.execute(
        `INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
         VALUES (?, ?, ?, ?, ?)`,
        [scope.tenantId, scope.personId, input.successorSearchPlanId, input.successorContextFingerprint, input.activatedBy],
      );
      await tx.execute(`DELETE FROM active_evaluation_contexts WHERE tenant_id = ? AND person_id = ? AND search_plan_id <> ?`,
        [scope.tenantId, scope.personId, input.successorSearchPlanId]);
      await tx.execute(`UPDATE search_plans SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ? AND person_id = ?`,
        [input.successorSearchPlanId, scope.tenantId, scope.personId]);
      await tx.execute(`UPDATE search_plans SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND person_id = ? AND status = 'active' AND id <> ?`,
        [scope.tenantId, scope.personId, input.successorSearchPlanId]);
    });
  }

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

  /**
   * Authoritatively resolves the active search plan and immutable snapshot for an authorized scope.
   * Enforces strict context pointer precedence, conflict validation, and zero silent snapshot drift.
   */
  async getActiveSearchPlanWithSnapshot(
    scope: AuthorizedPersonScope,
    options?: GetActiveSearchPlanOptions
  ): Promise<ActiveSearchPlanLineage> {
    const targetPlanId = options?.searchPlanId;
    const targetFingerprint = options?.contextFingerprint;

    // 1. Conflict Check: if both searchPlanId and contextFingerprint are supplied, assert they match
    if (targetPlanId && targetFingerprint) {
      const row = await this.db.one<any>(
        `SELECT ec.context_fingerprint, sps.search_plan_id, sp.id AS plan_id, sp.title, sp.status, sp.criteria_json,
                sps.id AS snapshot_id, sps.snapshot_hash, sps.payload_json
         FROM evaluation_contexts ec
         JOIN search_plan_snapshots sps ON sps.id = ec.search_plan_snapshot_id
         JOIN search_plans sp ON sp.id = sps.search_plan_id
         WHERE ec.context_fingerprint = ?
           AND ec.tenant_id = ?
           AND ec.person_id = ?
           AND sps.tenant_id = ?
           AND sps.person_id = ?
           AND sp.tenant_id = ?
           AND sp.person_id = ?`,
        [targetFingerprint, scope.tenantId, scope.personId, scope.tenantId, scope.personId, scope.tenantId, scope.personId]
      );

      if (!row) {
        throw new NoActiveEvaluationContextError(
          `No evaluation context found for fingerprint '${targetFingerprint}' in tenant '${scope.tenantId}'`
        );
      }

      if (row.search_plan_id !== targetPlanId) {
        throw new EvaluationContextConflictError(
          `Context fingerprint '${targetFingerprint}' belongs to searchPlan '${row.search_plan_id}', but override requested '${targetPlanId}'`
        );
      }

      if (row.status !== "active") {
        throw new NoActivePlanError(`Search plan '${row.plan_id}' is not active (status: '${row.status}')`);
      }

      const rawPayload = row.payload_json || row.criteria_json;
      return {
        planId: row.plan_id,
        title: row.title,
        status: row.status,
        criteria: JSON.parse(rawPayload),
        snapshotId: row.snapshot_id,
        snapshotHash: row.snapshot_hash,
        contextFingerprint: row.context_fingerprint,
      };
    }

    // 2. Explicit contextFingerprint Resolution (Exact snapshot binding)
    if (targetFingerprint) {
      const row = await this.db.one<any>(
        `SELECT ec.context_fingerprint, sps.search_plan_id, sp.id AS plan_id, sp.title, sp.status, sp.criteria_json,
                sps.id AS snapshot_id, sps.snapshot_hash, sps.payload_json
         FROM evaluation_contexts ec
         JOIN search_plan_snapshots sps ON sps.id = ec.search_plan_snapshot_id
         JOIN search_plans sp ON sp.id = sps.search_plan_id
         WHERE ec.context_fingerprint = ?
           AND ec.tenant_id = ?
           AND ec.person_id = ?
           AND sps.tenant_id = ?
           AND sps.person_id = ?
           AND sp.tenant_id = ?
           AND sp.person_id = ?`,
        [targetFingerprint, scope.tenantId, scope.personId, scope.tenantId, scope.personId, scope.tenantId, scope.personId]
      );

      if (!row) {
        throw new NoActiveEvaluationContextError(
          `No evaluation context found for fingerprint '${targetFingerprint}' in tenant '${scope.tenantId}'`
        );
      }

      if (row.status !== "active") {
        throw new NoActivePlanError(`Search plan '${row.plan_id}' is not active (status: '${row.status}')`);
      }

      const rawPayload = row.payload_json || row.criteria_json;
      return {
        planId: row.plan_id,
        title: row.title,
        status: row.status,
        criteria: JSON.parse(rawPayload),
        snapshotId: row.snapshot_id,
        snapshotHash: row.snapshot_hash,
        contextFingerprint: row.context_fingerprint,
      };
    }

    // 3. Explicit Override Path (Authorized override without pointer)
    if (targetPlanId && options?.allowOverrideWithoutPointer) {
      const row = await this.db.one<any>(
        `SELECT sp.id AS plan_id, sp.title, sp.status, sp.criteria_json,
                sps.id AS snapshot_id, sps.snapshot_hash, sps.payload_json
         FROM search_plans sp
         LEFT JOIN search_plan_snapshots sps ON sps.search_plan_id = sp.id
           AND sps.tenant_id = sp.tenant_id
           AND sps.person_id = sp.person_id
         WHERE sp.id = ? AND sp.tenant_id = ? AND sp.person_id = ? AND sp.status = 'active'
         ORDER BY sps.created_at DESC
         LIMIT 1`,
        [targetPlanId, scope.tenantId, scope.personId]
      );

      if (!row) {
        throw new NoActivePlanError(
          `No active search plan found with ID '${targetPlanId}' for tenant '${scope.tenantId}' and person '${scope.personId}'`
        );
      }

      const rawPayload = row.payload_json || row.criteria_json;
      return {
        planId: row.plan_id,
        title: row.title,
        status: row.status,
        criteria: JSON.parse(rawPayload),
        snapshotId: row.snapshot_id || `sps_legacy_${row.plan_id}`,
        snapshotHash: row.snapshot_hash || computeSearchPlanSnapshotHash(JSON.parse(rawPayload)),
        contextFingerprint: undefined,
      };
    }

    // 4. Default Authenticated Execution: Require active pointer in active_evaluation_contexts
    const row = await this.db.one<any>(
      `SELECT aec.context_fingerprint, aec.search_plan_id, sp.id AS plan_id, sp.title, sp.status, sp.criteria_json,
              sps.id AS snapshot_id, sps.snapshot_hash, sps.payload_json
       FROM active_evaluation_contexts aec
       JOIN evaluation_contexts ec ON ec.context_fingerprint = aec.context_fingerprint
         AND ec.tenant_id = aec.tenant_id
         AND ec.person_id = aec.person_id
       JOIN search_plan_snapshots sps ON sps.id = ec.search_plan_snapshot_id
         AND sps.tenant_id = aec.tenant_id
         AND sps.person_id = aec.person_id
       JOIN search_plans sp ON sp.id = aec.search_plan_id
         AND sp.tenant_id = aec.tenant_id
         AND sp.person_id = aec.person_id
       WHERE aec.tenant_id = ? AND aec.person_id = ? AND sp.status = 'active'
       LIMIT 1`,
      [scope.tenantId, scope.personId]
    );

    if (!row) {
      throw new NoActiveEvaluationContextError(
        `No active evaluation context pointer found in Turso Cloud for tenant '${scope.tenantId}' (person: '${scope.personId}'). Authenticated scraping requires an active search plan pointer.`
      );
    }

    const rawPayload = row.payload_json || row.criteria_json;
    return {
      planId: row.plan_id,
      title: row.title,
      status: row.status,
      criteria: JSON.parse(rawPayload),
      snapshotId: row.snapshot_id,
      snapshotHash: row.snapshot_hash,
      contextFingerprint: row.context_fingerprint,
    };
  }
}

export class EvaluationContextConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationContextConflictError";
  }
}

export class NoActiveEvaluationContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoActiveEvaluationContextError";
  }
}

export class NoActivePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoActivePlanError";
  }
}

export interface ActiveSearchPlanLineage {
  planId: string;
  title: string;
  status: string;
  criteria: SearchCriteriaPayload;
  snapshotId: string;
  snapshotHash: string;
  contextFingerprint?: string;
}

export interface GetActiveSearchPlanOptions {
  searchPlanId?: string;
  contextFingerprint?: string;
  allowOverrideWithoutPointer?: boolean;
}
