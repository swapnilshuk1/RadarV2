import { migratedFixtureDatabase } from "../persistence/migrated-fixture";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { SqliteEvaluationContextStore } from "../../src/data/sqlite/repositories/SqliteEvaluationContextStore";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import { setupLineageTestFixture, activateLineageTestContext } from "../persistence/lineage_fixture";
import { CanonicalIngestionService } from "@/acquisition/ingestion-service";
import { materializeExistingCanonicalPool } from "@/evaluation/context-materialization";
import { STAGED_POLICY_VERSION } from "@/evaluation/policy";

const scope = { tenantId: "tenant_A", personId: "person_A", roles: [] };
const criteria = {
  targetSeniority: ["VP"],
  targetRoles: ["VP Growth"],
  targetLocations: ["Bengaluru"],
};

function activationInput(profileVersion: string) {
  return {
    title: "Executive Career Search Plan",
    criteria,
    ontologyVersion: "1.1.0",
    ontologyFingerprint: "ontology-hash-1.1.0",
    policyVersion: STAGED_POLICY_VERSION,
    profileVersion,
    activatedBy: "intent-update",
  };
}

function makeEnrichmentDispatch(cardHash: string, title: string, company: string, location: string, description: string, portal: "LinkedIn" | "Naukri" = "LinkedIn") {
  return {
    pipelineVersion: "1.0.0",
    detailedCard: {
      cardHash,
      title,
      company,
      location,
      portal,
      rawText: description,
      description,
      summary: description.slice(0, 100),
      directUrl: "https://example.com/job",
      applyUrl: "https://example.com/apply",
      dimensions: [],
      timestamp: new Date().toISOString(),
      enrichmentStatus: "UNENRICHED" as const,
      detailFetchStatus: "SUCCESS" as const,
      contentOrigin: "DETAIL_DOCUMENT" as const,
    },
  };
}

describe("Atomic career-intent plan activation", () => {
  let db: SqliteAdapter;
  let store: SqliteEvaluationContextStore;

  beforeEach(async () => {
    db = await migratedFixtureDatabase();
    await setupLineageTestFixture(db);
    await db.execute(
      `UPDATE evaluation_contexts SET policy_version = ? WHERE context_fingerprint = ?`,
      [STAGED_POLICY_VERSION, "fingerprint_A"],
    );
    await db.execute(
      `INSERT INTO users (id, email) VALUES (?, ?)`,
      ["person_A", "person-a@example.test"]
    );
    await db.execute(
      `INSERT INTO memberships (user_id, tenant_id, role, permissions, status)
       VALUES (?, ?, ?, ?, ?)` ,
      ["person_A", "tenant_A", "admin", '["*"]', "active"]
    );
    store = new SqliteEvaluationContextStore(db);
  });

  it("immediately routes the scope to the complete replacement lineage and archives prior plans", async () => {
    const first = await store.replaceActiveSearchPlan(scope, activationInput("profile-v1"));
    const second = await store.replaceActiveSearchPlan(scope, activationInput("profile-v2"));

    const oldFixturePlan = await db.one<{ status: string }>(
      `SELECT status FROM search_plans WHERE id = 'plan_A'`
    );
    const firstPlan = await db.one<{ status: string }>(
      `SELECT status FROM search_plans WHERE id = ?`,
      [first.plan.id]
    );
    const secondPlan = await db.one<{ status: string }>(
      `SELECT status FROM search_plans WHERE id = ?`,
      [second.plan.id]
    );
    const pointerCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM active_evaluation_contexts WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );
    const boundScope = await db.one<{ context_fingerprint: string }>(
      `SELECT context_fingerprint FROM evaluation_context_scopes WHERE context_fingerprint = ?`,
      [second.context.contextFingerprint]
    );
    const resolved = await resolveServingScope(scope.personId, scope.tenantId, db);

    expect(first.snapshot.snapshotHash).toBe(second.snapshot.snapshotHash);
    expect(first.snapshot.id).not.toBe(second.snapshot.id);
    expect(oldFixturePlan?.status).toBe("archived");
    expect(firstPlan?.status).toBe("archived");
    expect(secondPlan?.status).toBe("active");
    expect(pointerCount?.count).toBe(1);
    expect(boundScope?.context_fingerprint).toBe(second.context.contextFingerprint);
    expect(resolved.activeContext).toEqual({
      searchPlanId: second.plan.id,
      contextFingerprint: second.context.contextFingerprint,
    });
  });

  it("rolls back the complete replacement when pointer creation is rejected", async () => {
    await db.execute(
      `CREATE TRIGGER reject_intent_pointer
       BEFORE INSERT ON active_evaluation_contexts
       WHEN NEW.activated_by = 'intent-update'
       BEGIN
         SELECT RAISE(ABORT, 'intent pointer rejected');
       END`
    );

    await expect(store.replaceActiveSearchPlan(scope, activationInput("profile-v1")))
      .rejects.toThrow("intent pointer rejected");

    const plans = await db.many<{ id: string; status: string }>(
      `SELECT id, status FROM search_plans WHERE tenant_id = ? AND person_id = ? ORDER BY id`,
      [scope.tenantId, scope.personId]
    );
    const snapshots = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM search_plan_snapshots WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );
    const contexts = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM evaluation_contexts WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );
    const pointers = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM active_evaluation_contexts WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );

    expect(plans).toEqual([{ id: "plan_A", status: "active" }]);
    expect(snapshots?.count).toBe(1);
    expect(contexts?.count).toBe(1);
    expect(pointers?.count).toBe(0);
  });

  it("keeps the prior serving plan active while a prepared context is backfilled", async () => {
    const prepared = await store.prepareSearchPlan(scope, activationInput("profile-prepared"));
    const before = await db.one<{ status: string }>(`SELECT status FROM search_plans WHERE id = 'plan_A'`);
    const preparedStatus = await db.one<{ status: string }>(`SELECT status FROM search_plans WHERE id = ?`, [prepared.plan.id]);

    expect(before?.status).toBe("active");
    expect(preparedStatus?.status).toBe("paused");

    await store.activatePreparedSearchPlan(
      scope,
      prepared.plan.id,
      prepared.context.contextFingerprint,
      "intent-update"
    );

    const active = await db.one<{ status: string }>(`SELECT status FROM search_plans WHERE id = ?`, [prepared.plan.id]);
    const archived = await db.one<{ status: string }>(`SELECT status FROM search_plans WHERE id = 'plan_A'`);
    expect(active?.status).toBe("active");
    expect(archived?.status).toBe("archived");
  });

  it("backfills the existing canonical pool into the prepared context idempotently", async () => {
    await db.execute(
      `INSERT INTO career_profiles (
         id, person_id, timeline, skills, projection_json, projection_generated_at,
         current_title, years_experience, archetype, preferred_work_model, created_at, updated_at
       ) VALUES (?, ?, '[]', '[]', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        "profile-backfill",
        scope.personId,
        JSON.stringify({
          profileVersion: "profile-backfill",
          operatingLevel: { value: "STRATEGIC", confidence: 1, evidenceIds: [] },
          workNature: { value: "STRATEGIC_WORK", confidence: 1, evidenceIds: [] },
          decisionAuthority: { value: "ENTERPRISE", confidence: 1, evidenceIds: [] },
          commercialScope: { value: "ENTERPRISE", confidence: 1, evidenceIds: [] },
          yearsOfExperience: 20,
          coreCapabilities: ["COMMERCIAL_GROWTH"],
          preferredLocations: ["Bengaluru"],
          preferredWorkModel: "ANY",
          executiveThemes: ["growth"],
        }),
        "VP Growth",
        20,
        "Growth Executive",
        "ANY",
      ],
    );
    await activateLineageTestContext(db);
    await db.execute(
      `INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets)
       VALUES (?, ?, ?, ?, 'running', '["LinkedIn", "Naukri"]')`,
      ["run_backfill_1", scope.tenantId, scope.personId, "plan_A"]
    );
    const ingestScope = {
      mode: "SCOPED" as const,
      tenantId: scope.tenantId,
      personId: scope.personId,
      searchPlanId: "plan_A",
      runId: "run_backfill_1",
    };
    const ingestion = new CanonicalIngestionService(db);
    const firstDesc = "Executive VP Growth role leading commercial growth, enterprise demand generation, revenue strategy, and a cross-functional leadership team. Own the regional P&L, define the annual growth plan, partner with product and sales executives, set measurable acquisition and retention targets, build operating cadence for funnel performance, and present strategic outcomes to the executive committee. The role requires proven commercial leadership, executive stakeholder management, scalable go-to-market execution, and accountability for sustainable revenue growth across complex customer segments.";
    const first = await ingestion.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "context-backfill-job",
      canonicalUrl: "https://www.linkedin.com/jobs/view/context-backfill-job",
      jobTitle: "VP Growth",
      companyName: "Acme",
      location: "Bengaluru",
      rawContent: firstDesc,
      contentOrigin: "DETAIL_DOCUMENT",
      enrichmentDispatch: makeEnrichmentDispatch("cbj-1", "VP Growth", "Acme", "Bengaluru", firstDesc, "LinkedIn"),
    }, ingestScope);
    const secondDesc = "Executive VP Growth role owning regional P&L, leading commercial teams, scaling cross-functional operations, and driving repeatable enterprise revenue growth. Partner closely with functional heads and global executives to establish market entry frameworks, pipeline conversion metrics, and key partner alliances across enterprise portfolios.";
    const second = await ingestion.ingestOpportunity({
      sourcePortal: "Naukri",
      sourceJobId: "context-backfill-job-2",
      canonicalUrl: "https://www.naukri.com/job-listings/context-backfill-job-2",
      jobTitle: "VP Growth",
      companyName: "Beta",
      location: "Bengaluru",
      rawContent: secondDesc,
      contentOrigin: "DETAIL_DOCUMENT",
      enrichmentDispatch: makeEnrichmentDispatch("cbj-2", "VP Growth", "Beta", "Bengaluru", secondDesc, "Naukri"),
    }, ingestScope);
    const prepared = await store.prepareSearchPlan(scope, activationInput("profile-backfill"));
    const firstBackfill = await materializeExistingCanonicalPool(scope, prepared, {
      sourceSearchPlanId: "plan_A",
    }, db);
    const secondBackfill = await materializeExistingCanonicalPool(scope, prepared, {
      sourceSearchPlanId: "plan_A",
    }, db);

    expect(firstBackfill.examined).toBeGreaterThanOrEqual(2);
    expect(firstBackfill.candidates).toBeGreaterThanOrEqual(2);
    expect(firstBackfill.materialized).toBeGreaterThanOrEqual(2);
    expect(secondBackfill.materialized).toBe(firstBackfill.materialized);
    const candidateCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM search_plan_candidates WHERE search_plan_id = ? AND canonical_job_id = ?`,
      [prepared.plan.id, first.canonicalJobId]
    );
    const candidateAudit = await db.one<{ eligibility: string; reason_codes: string }>(
      `SELECT eligibility, eligibility_reason_codes_json AS reason_codes
       FROM search_plan_candidates
       WHERE search_plan_id = ? AND canonical_job_id = ?`,
      [prepared.plan.id, first.canonicalJobId]
    );
    const requirementCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM evaluation_requirements
       WHERE evaluation_context_fingerprint = ? AND canonical_job_id = ?`,
      [prepared.context.contextFingerprint, first.canonicalJobId],
    );
    const jobCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM evaluation_jobs
       WHERE evaluation_context_fingerprint = ? AND canonical_job_id = ?`,
      [prepared.context.contextFingerprint, first.canonicalJobId],
    );
    const evaluationCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM materialized_evaluations
       WHERE evaluation_context_fingerprint = ? AND canonical_job_id = ?`,
      [prepared.context.contextFingerprint, first.canonicalJobId],
    );
    expect(candidateCount?.count).toBe(1);
    expect(candidateAudit).toEqual({
      eligibility: "ELIGIBLE",
      reason_codes: JSON.stringify(["ROLE_FAMILY_MATCH"]),
    });
    // Context materialization owns durable scheduling, not synchronous evaluation.
    expect(requirementCount?.count).toBe(1);
    expect(jobCount?.count).toBe(1);
    expect(evaluationCount?.count).toBe(0);
    const secondPoolCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM canonical_opportunities WHERE id = ?`,
      [second.canonicalJobId]
    );
    expect(secondPoolCount?.count).toBe(1);
  });

  it("materializes only the explicit source plan when the same scope has multiple plans", async () => {
    await activateLineageTestContext(db);
    await db.execute(
      `INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets)
       VALUES (?, ?, ?, ?, 'running', '["LinkedIn", "Naukri"]')`,
      ["run_backfill_2", scope.tenantId, scope.personId, "plan_A"]
    );
    const ingestScope = {
      mode: "SCOPED" as const,
      tenantId: scope.tenantId,
      personId: scope.personId,
      searchPlanId: "plan_A",
      runId: "run_backfill_2",
    };
    const ingestion = new CanonicalIngestionService(db);
    const sourceADesc = "Executive VP Growth role leading commercial growth, enterprise demand generation, and cross-functional leadership teams across India and APAC. Own strategic planning, executive governance, and multi-market commercial expansion to deliver sustainable revenue and market share.";
    const sourceA = await ingestion.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "source-plan-a",
      canonicalUrl: "https://www.linkedin.com/jobs/view/source-plan-a",
      jobTitle: "VP Growth",
      companyName: "Plan A Co",
      location: "Bengaluru",
      rawContent: sourceADesc,
      contentOrigin: "DETAIL_DOCUMENT",
      enrichmentDispatch: makeEnrichmentDispatch("spa-1", "VP Growth", "Plan A Co", "Bengaluru", sourceADesc, "LinkedIn"),
    }, ingestScope);
    await db.execute(
      `INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["plan_same_scope_B", scope.tenantId, scope.personId, "archived", "Plan B", JSON.stringify(criteria)],
    );
    const sourceBDesc = "Executive VP Growth role owning a regional P&L and commercial team, driving strategic business partnerships and executive customer acquisitions. Coordinate marketing, sales operations, and senior stakeholder engagement across all regional business units.";
    const sourceB = await ingestion.ingestOpportunity({
      sourcePortal: "Naukri",
      sourceJobId: "source-plan-b",
      canonicalUrl: "https://www.naukri.com/job-listings/source-plan-b",
      jobTitle: "VP Growth",
      companyName: "Plan B Co",
      location: "Bengaluru",
      rawContent: sourceBDesc,
      contentOrigin: "DETAIL_DOCUMENT",
      enrichmentDispatch: makeEnrichmentDispatch("spb-1", "VP Growth", "Plan B Co", "Bengaluru", sourceBDesc, "Naukri"),
    }, ingestScope);
    // Ingestion projects into the fixture's active plan. Move this record to
    // the second plan so the two source cohorts are genuinely disjoint. The
    // production ingestion path now creates its durable worker job immediately,
    // so remove the fixture-only obligation before moving the association.
    await db.execute(
      `DELETE FROM evaluation_jobs
       WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ? AND canonical_job_id = ? AND opportunity_version = ?`,
      [scope.tenantId, scope.personId, "plan_A", sourceB.canonicalJobId, sourceB.opportunityVersion],
    );
    await db.execute(
      `DELETE FROM evaluation_requirements
       WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ? AND canonical_job_id = ? AND opportunity_version = ?`,
      [scope.tenantId, scope.personId, "plan_A", sourceB.canonicalJobId, sourceB.opportunityVersion],
    );
    await db.execute(
      `DELETE FROM search_plan_candidates
       WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ? AND canonical_job_id = ? AND opportunity_version = ?`,
      [scope.tenantId, scope.personId, "plan_A", sourceB.canonicalJobId, sourceB.opportunityVersion],
    );
    await db.execute(
      `INSERT INTO search_plan_candidates (
         tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version,
         attention_decision, eligibility, eligibility_reason_codes_json
       ) VALUES (?, ?, ?, ?, ?, 'CANDIDATE', 'ELIGIBLE', '[]')`,
      [scope.tenantId, scope.personId, "plan_same_scope_B", sourceB.canonicalJobId, sourceB.opportunityVersion],
    );
    const prepared = await store.prepareSearchPlan(scope, activationInput("profile-source-boundary"));

    const result = await materializeExistingCanonicalPool(scope, prepared, {
      sourceSearchPlanId: "plan_A",
    }, db);

    expect(result.examined).toBe(1);
    const materialized = await db.many<{ canonical_job_id: string }>(
      `SELECT canonical_job_id FROM search_plan_candidates
       WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ?`,
      [scope.tenantId, scope.personId, prepared.plan.id],
    );
    expect(materialized).toEqual([{ canonical_job_id: sourceA.canonicalJobId }]);
    expect(materialized.map((row) => row.canonical_job_id)).not.toContain(sourceB.canonicalJobId);
  });
});
