/**
 * tests/serving/active-context-dossier-boundary.test.ts
 *
 * RADAR v2 — Regressions for Active Context Authority & Serving Boundary.
 *
 * Invariants:
 * 1. AuthorizedPersonScope cannot override the freshly resolved active serving context.
 * 2. Active context evaluation is strictly served; archived context evaluations must never leak.
 * 3. Candidate identity resolution is deterministic (exact canonical identity first).
 * 4. Isolated ontology labels ('marketing') never render as candidate proof.
 * 5. PURSUE evaluations never degrade to INVESTIGATE_THEN_DECIDE due to keyUncertainty.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture, activateLineageTestContext } from "../persistence/lineage_fixture";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import type { AuthorizedPersonScope } from "../../src/lib/security/auth";
import type { EvaluatedOpportunity, Opportunity, UnavailableOpportunity } from "../../src/data/opportunity-fixtures";
import { PursuitStrategyResolver } from "../../src/lib/intelligence/editorial/PursuitStrategyResolver";
import { EditorialContextBuilder } from "../../src/lib/intelligence/editorial/EditorialContext";
import { PrimaryReasonResolver } from "../../src/lib/intelligence/editorial/PrimaryReasonResolver";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";
import { buildCanonicalDossierPresentation } from "../../src/lib/intelligence/dossier/CanonicalDossierBuilder";
import { DEFAULT_CANDIDATE_PROJECTION } from "../../src/lib/domain/candidate_projection";
import { substantiveCandidateEvidence } from "../../src/lib/intelligence/editorial/CandidateProofPolicy";

describe("Active Context Authority & Serving Boundary Regressions", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let queries: SqliteOpportunityQueries;
  let scope: AuthorizedPersonScope;

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    await setupLineageTestFixture(db);
    await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES ('person_A', 'a@a.com')`);
    await db.execute(
      `INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, permissions, status)
       VALUES ('person_A', 'tenant_A', 'admin', '["*"]', 'active')`
    );
    await activateLineageTestContext(db);
    queries = new SqliteOpportunityQueries(db);
    const resolved = await resolveServingScope("person_A", "tenant_A", db);
    scope = resolved.scope;
  });

  it("Regression 1: getDossier() returns NEW active-context evaluation when AuthorizedPersonScope has stale IDs", async () => {
    const oppId = "opp_shared_001";
    const verId = "ver_shared_001";
    const oldContextFingerprint = "fingerprint_old_archived";
    const oldPlanId = "plan_old_archived";

    // Seed archived plan, snapshot, and context
    await db.execute(
      `INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json)
       VALUES (?, 'tenant_A', 'person_A', 'archived', 'Old Plan', '{}')`,
      [oldPlanId]
    );
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json)
       VALUES ('sps_old', 'tenant_A', 'person_A', ?, 'hash_old', '{}')`,
      [oldPlanId]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
       VALUES (?, 'tenant_A', 'person_A', 'sps_old', 'v1', 'hash_ont', 'v1', 'v1')`,
      [oldContextFingerprint]
    );

    // Seed shared opportunity
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source_job_id, company_name, source, canonical_url)
       VALUES (?, 'src_shared_001', 'Acme Corp', 'LinkedIn', 'https://example.com/job')`,
      [oppId]
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, content_hash, raw_content, lifecycle_state)
       VALUES (?, ?, 'VP Product', 'Remote', 'hash_ver', 'Job Content', 'ACTIVE')`,
      [verId, oppId]
    );

    // Seed candidate in BOTH old plan and new active plan ('plan_A')
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', ?, ?, ?, 'CANDIDATE')`,
      [oldPlanId, oppId, verId]
    );
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', ?, ?, 'CANDIDATE')`,
      [oppId, verId]
    );

    // Old evaluation has "Investigate before investing"
    const oldPresentation = buildCanonicalDossierPresentation(
      {
        opportunity: {
          id: oppId,
          jobHash: "src_shared_001",
          role: "VP Product",
          company: "Acme Corp",
          location: "Remote",
          scrapedFrom: "LinkedIn",
          engineRecommendation: { engineVerdict: "CONSIDER", qualityScore: 65 },
        } as any,
        jobProjection: { title: "VP Product" } as any,
      } as any,
      DEFAULT_CANDIDATE_PROJECTION,
      "eval_hash_old",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    oldPresentation.brief.executiveLabel = "Investigate before investing";
    oldPresentation.brief.pursuitMode = "INVESTIGATE_THEN_DECIDE";

    const oldEvalJson = JSON.stringify({
      schemaVersion: "v4.3-intrinsic",
      evaluationContractVersion: "v4.3",
      evaluationState: "EVALUATED",
      canonicalJobId: oppId,
      opportunityVersion: verId,
      jobHash: "src_shared_001",
      tenantId: "tenant_A",
      personId: "person_A",
      evaluationInputHash: "eval_hash_old",
      contextFingerprint: oldContextFingerprint,
      policyVersion: "test",
      ontologyVersion: "test",
      ontologyFingerprint: "test-ontology",
      profileVersion: "test-profile",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      decision: "CONSIDER",
      score: 65,
      diligenceStatus: "UNKNOWN",
      jobProjection: { title: "VP Product" },
      engineVerdict: "CONSIDER",
      qualityScore: 65,
      dossierPresentation: oldPresentation,
    });
    await db.execute(
      `INSERT INTO materialized_evaluations (
        id, canonical_job_id, opportunity_version, tenant_id, person_id,
        evaluation_context_fingerprint, evaluation_fingerprint,
        decision, quality_score, evaluation_state, evaluation_json
      ) VALUES ('eval_row_old', ?, ?, 'tenant_A', 'person_A', ?, 'eval_hash_old', 'CONSIDER', 65, 'COMPLETE', ?)`,
      [oppId, verId, oldContextFingerprint, oldEvalJson]
    );

    // New evaluation has "Proceed with focused outreach"
    const newPresentation = buildCanonicalDossierPresentation(
      {
        opportunity: {
          id: oppId,
          jobHash: "src_shared_001",
          role: "VP Product",
          company: "Acme Corp",
          location: "Remote",
          scrapedFrom: "LinkedIn",
          engineRecommendation: { engineVerdict: "PURSUE", qualityScore: 88 },
        } as any,
        jobProjection: { title: "VP Product" } as any,
      } as any,
      DEFAULT_CANDIDATE_PROJECTION,
      "eval_hash_new",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    newPresentation.brief.executiveLabel = "Proceed with focused outreach";
    newPresentation.brief.pursuitMode = "CLARIFY_SCOPE";

    const newEvalJson = JSON.stringify({
      schemaVersion: "v4.3-intrinsic",
      evaluationContractVersion: "v4.3",
      evaluationState: "EVALUATED",
      canonicalJobId: oppId,
      opportunityVersion: verId,
      jobHash: "src_shared_001",
      tenantId: "tenant_A",
      personId: "person_A",
      evaluationInputHash: "eval_hash_new",
      contextFingerprint: "fingerprint_A",
      policyVersion: "test",
      ontologyVersion: "test",
      ontologyFingerprint: "test-ontology",
      profileVersion: "test-profile",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      decision: "PURSUE",
      score: 88,
      diligenceStatus: "UNKNOWN",
      jobProjection: { title: "VP Product" },
      engineVerdict: "PURSUE",
      qualityScore: 88,
      dossierPresentation: newPresentation,
    });
    await db.execute(
      `INSERT INTO materialized_evaluations (
        id, canonical_job_id, opportunity_version, tenant_id, person_id,
        evaluation_context_fingerprint, evaluation_fingerprint,
        decision, quality_score, evaluation_state, evaluation_json
      ) VALUES ('eval_row_new', ?, ?, 'tenant_A', 'person_A', 'fingerprint_A', 'eval_hash_new', 'PURSUE', 88, 'COMPLETE', ?)`,
      [oppId, verId, newEvalJson]
    );

    // Construct a stale scope pointing to OLD context and search plan
    const staleScope: AuthorizedPersonScope = {
      ...scope,
      activeSearchPlanId: oldPlanId,
      activeEvaluationContextId: oldContextFingerprint,
    };

    // getDossier() must ignore staleScope overrides and serve NEW active evaluation
    const served = await queries.getDossier(staleScope, "src_shared_001") as EvaluatedOpportunity;
    expect(served).not.toBeNull();
    expect(served.evaluationState).toBe("EVALUATED");
    expect(served.evaluationContextFingerprint).toBe("fingerprint_A");
    expect(served.evaluationFingerprint).toBe("eval_hash_new");
    expect(served.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(served.engineRecommendation?.qualityScore).toBe(88);

    const brief = served.dossierPresentation?.brief as Record<string, unknown> | undefined;
    expect(brief?.executiveLabel).toBe("Proceed with focused outreach");
    expect(brief?.pursuitMode).toBe("CLARIFY_SCOPE");
    expect(JSON.stringify(served)).not.toContain("Investigate before investing");
  });

  it("Regression 2: Archived evaluation is never served when active context has no matching evaluation", async () => {
    const oppId = "opp_archived_only";
    const verId = "ver_archived_only";
    const oldContextFingerprint = "fingerprint_old_only";
    const oldPlanId = "plan_old_only";

    // Seed archived plan and context
    await db.execute(
      `INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json)
       VALUES (?, 'tenant_A', 'person_A', 'archived', 'Old Plan', '{}')`,
      [oldPlanId]
    );
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json)
       VALUES ('sps_old_2', 'tenant_A', 'person_A', ?, 'hash_old_2', '{}')`,
      [oldPlanId]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
       VALUES (?, 'tenant_A', 'person_A', 'sps_old_2', 'v1', 'hash_ont', 'v1', 'v1')`,
      [oldContextFingerprint]
    );

    // Seed opportunity
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source_job_id, company_name, source, canonical_url)
       VALUES (?, 'src_archived_only', 'Legacy Corp', 'LinkedIn', 'https://example.com/job')`,
      [oppId]
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, content_hash, raw_content, lifecycle_state)
       VALUES (?, ?, 'Director of Ops', 'Remote', 'hash_ver_2', 'Job Content', 'ACTIVE')`,
      [verId, oppId]
    );

    // Candidate in active plan 'plan_A', but evaluation exists ONLY in oldContextFingerprint
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', ?, ?, 'CANDIDATE')`,
      [oppId, verId]
    );

    const oldEvalJson = JSON.stringify({
      schemaVersion: "v4.3-intrinsic",
      evaluationContractVersion: "v4.3",
      evaluationState: "EVALUATED",
      canonicalJobId: oppId,
      opportunityVersion: verId,
      jobHash: "src_archived_only",
      tenantId: "tenant_A",
      personId: "person_A",
      evaluationInputHash: "eval_hash_old_only",
      contextFingerprint: oldContextFingerprint,
      engineVerdict: "CONSIDER",
      qualityScore: 60,
      dossierPresentation: {
        schemaVersion: "v1",
        evaluationInputHash: "eval_hash_old_only",
        brief: {
          headline: "Archived Brief Headline",
          pursuitMode: "INVESTIGATE_THEN_DECIDE",
          executiveLabel: "Investigate before investing",
        },
      },
    });
    await db.execute(
      `INSERT INTO materialized_evaluations (
        id, canonical_job_id, opportunity_version, tenant_id, person_id,
        evaluation_context_fingerprint, evaluation_fingerprint,
        decision, quality_score, evaluation_json
      ) VALUES ('eval_archived_row', ?, ?, 'tenant_A', 'person_A', ?, 'eval_hash_old_only', 'CONSIDER', 60, ?)`,
      [oppId, verId, oldContextFingerprint, oldEvalJson]
    );

    // Query dossier under active scope
    const served = await queries.getDossier(scope, "src_archived_only") as UnavailableOpportunity;
    expect(served).not.toBeNull();
    // Must be UNMATERIALIZED under active context, NEVER the archived evaluated dossier
    expect(served.evaluationState).toBe("UNMATERIALIZED");
    expect(JSON.stringify(served)).not.toContain("Archived Brief Headline");
    expect(JSON.stringify(served)).not.toContain("Investigate before investing");
  });

  it("Deterministic candidate ordering: resolves canonical_job_id over source_job_id", async () => {
    const oppId1 = "opp_exact_id";
    const verId1 = "ver_exact_id";
    const oppId2 = "opp_other_id";
    const verId2 = "ver_other_id";

    // opp1 has canonical id 'opp_exact_id' and source_job_id 'src_different'
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source_job_id, company_name, source, canonical_url)
       VALUES (?, 'src_different', 'Corp A', 'LinkedIn', 'https://example.com/a')`,
      [oppId1]
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, content_hash, raw_content, lifecycle_state)
       VALUES (?, ?, 'Role A', 'Remote', 'hash_a', 'Content A', 'ACTIVE')`,
      [verId1, oppId1]
    );
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', ?, ?, 'CANDIDATE')`,
      [oppId1, verId1]
    );

    // opp2 has canonical id 'opp_other_id' and source_job_id 'opp_exact_id' (overlapping with opp1's canonical id!)
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source_job_id, company_name, source, canonical_url)
       VALUES (?, ?, 'Corp B', 'LinkedIn', 'https://example.com/b')`,
      [oppId2, oppId1]
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, content_hash, raw_content, lifecycle_state)
       VALUES (?, ?, 'Role B', 'Remote', 'hash_b', 'Content B', 'ACTIVE')`,
      [verId2, oppId2]
    );
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', ?, ?, 'CANDIDATE')`,
      [oppId2, verId2]
    );

    // Query for 'opp_exact_id': must match opp1 (where canonical_job_id = 'opp_exact_id') first!
    const served = await queries.getDossier(scope, oppId1);
    expect(served).not.toBeNull();
    expect(served?.role).toBe("Role A");
  });

  it("Candidate-proof invariant: isolated ontology labels like 'marketing' are never rendered as candidate proof", () => {
    const oppWithBareMarketing: Partial<Opportunity> = {
      jobHash: "sb_test",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Bengaluru",
      scrapedFrom: "LinkedIn",
      evaluationState: "SPARSE_SPEC",
      dimensions: [
        {
          key: "marketingLeadership",
          label: "Marketing Leadership",
          candidateProof: {
            headline: "Transferable Experience",
            detail: "marketing", // Isolated classifier label
          },
        },
      ],
      fitAssessment: { overallVerdict: "PURSUE" },
      engineRecommendation: { engineVerdict: "PURSUE", qualityScore: 72 },
    };

    const brief = BriefCompositionEngine.compose(oppWithBareMarketing as Opportunity);

    // Explicit candidate-proof policy assertions
    expect(substantiveCandidateEvidence("marketing")).toBeNull();
    expect(substantiveCandidateEvidence("Marketing Strategy")).toBeNull();
    expect(
      substantiveCandidateEvidence(
        "Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority"
      )
    ).toBeNull();
    expect(
      substantiveCandidateEvidence(
        "Led global commercial transformation across 12 business units."
      )
    ).toBe("Led global commercial transformation across 12 business units.");

    // "marketing" must not appear as a proof point or fit proof
    expect(brief.fitProofs).toEqual([]);
    for (const point of brief.proofPoints || []) {
      expect(point.detail).not.toBe("marketing");
      expect(point.headline).not.toBe("Transferable Experience");
    }
  });

  it("PURSUE invariant: keyUncertainty does not demote PURSUE to INVESTIGATE_THEN_DECIDE", () => {
    const opp: Opportunity = {
      id: "pinkerton_opp",
      jobHash: "pinkerton_test",
      role: "Operations Director",
      company: "Pinkerton",
      location: "Delhi",
      scrapedFrom: "LinkedIn",
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 70,
        triggeredRuleIds: ["R-PURSUE-HIGH-ALIGNMENT"],
      },
      dimensions: [
        { key: "operationsLeadership", label: "Operations Leadership", jdEvidence: { status: "Explicit" } },
      ],
    } as Opportunity;

    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    // Force a keyUncertainty onto the explanation
    const expWithUncertainty = {
      ...exp,
      verdict: "PURSUE" as const,
      keyUncertainty: "Reporting line structure not fully documented in public JD.",
    };

    const strategy = PursuitStrategyResolver.resolve(expWithUncertainty, ctx);

    // Invariant: PURSUE must not be demoted to INVESTIGATE_THEN_DECIDE or "Investigate before investing"
    expect(strategy.pursuitMode).not.toBe("INVESTIGATE_THEN_DECIDE");
    expect(strategy.executiveLabel).not.toBe("Investigate before investing");
    expect(strategy.engineVerdict).toBe("PURSUE");
    expect(["CLARIFY_SCOPE", "TAILOR_THEN_APPLY", "CONVERT_NETWORK"]).toContain(strategy.pursuitMode);
  });

  it("OAuth test invariant: /api/auth/callback?error=access_denied reaches handleGoogleOAuthCallback and never returns route 404", async () => {
    const server = (await import("../../src/server")).default;
    const req = new Request("http://localhost:3000/api/auth/callback?error=access_denied", {
      headers: { host: "localhost:3000" },
    });
    const res = await server.fetch(req, {}, {});
    expect(res.status).not.toBe(404);
    const body = await res.json();
    expect(body).not.toEqual({ error: "Not Found", path: "/api/auth/callback" });
    expect(body).toMatchObject({ error: "OAuth authentication failed" });
  });
});

