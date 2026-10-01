import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { SqliteStagedEvaluationStore } from "../../src/data/sqlite/repositories/SqliteStagedEvaluationStore";
import { SqliteRichDossierStore } from "../../src/data/sqlite/repositories/SqliteRichDossierStore";
import { StagedServingPublisher } from "@/dossier/runtime/serving-publisher";
import { readScrapedJobDetail } from "@/acquisition/detail-read-model";
import { stagedEvaluation, evaluationFingerprint, dossier } from "../fixtures/staged-rich-dossier";

describe("Scraped Job Detail & Decision Log Read Model", () => {
  let db: SqliteAdapter;
  const identity = {
    tenantId: "tenant_A",
    personId: "person_A",
    canonicalJobId: "job",
    opportunityVersion: "version",
    evaluationContextFingerprint: "e0afa52de510dfec864e3bd3bc0007e09b33cb6e708160d693ae136361a16e65",
    profileVersion: "profile",
  };
  const activeContext = {
    contextFingerprint: "e0afa52de510dfec864e3bd3bc0007e09b33cb6e708160d693ae136361a16e65",
    searchPlanId: "plan_A",
  };

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    await db.execute(`INSERT INTO users(id,email) VALUES('person_A','a@a.com')`);
    await db.execute(
      `INSERT INTO memberships(user_id,tenant_id,role,permissions,status) VALUES('person_A','tenant_A','admin','["*"]','active')`
    );
    await db.execute(
      `INSERT INTO evaluation_contexts(context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES('e0afa52de510dfec864e3bd3bc0007e09b33cb6e708160d693ae136361a16e65','tenant_A','person_A','sps_A','v1','hash_ontology','staged-v8','profile')`
    );
    await db.execute(
      `INSERT INTO evaluation_context_scopes(context_fingerprint,tenant_id,person_id,search_plan_id) VALUES('e0afa52de510dfec864e3bd3bc0007e09b33cb6e708160d693ae136361a16e65','tenant_A','person_A','plan_A')`
    );
    await db.execute(
      `INSERT INTO active_evaluation_contexts(tenant_id,person_id,search_plan_id,context_fingerprint,activated_by) VALUES('tenant_A','person_A','plan_A','e0afa52de510dfec864e3bd3bc0007e09b33cb6e708160d693ae136361a16e65','test-fixture')`
    );

    // Job 1: Admitted, staged, published -> READY
    await db.execute(
      `INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url,company_name) VALUES('job','LinkedIn','hash-101','https://linkedin.com/jobs/view/101','Acme Corp')`
    );
    await db.execute(
      `INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,company_name,location,raw_content,lifecycle_state) VALUES('version','job','hash1','Chief Operating Officer','Acme Corp','Bengaluru','Responsible for all operations.','ACTIVE')`
    );
    await db.execute(
      `INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision,eligibility,eligibility_reason_codes_json) VALUES('tenant_A','person_A','plan_A','job','version','CANDIDATE','ELIGIBLE','["ROLE_FAMILY_MATCH"]')`
    );
    await new SqliteStagedEvaluationStore(db).save({
      ...identity,
      jobHash: "job",
      policyVersion: "staged-v8",
      ontologyVersion: "v1",
      ontologyFingerprint: "hash_ontology",
      inputFingerprint: "input",
      sourceFingerprints: ["jd_1"],
      modelId: "model-gemini",
      modelVersion: "1.5",
      contractVersion: "staged-decision-v8",
      evaluationState: "COMPLETED",
      decision: "PURSUE",
      screeningViability: "PLAUSIBLE",
      evaluation: stagedEvaluation,
      evaluatedAt: "2026-10-01T12:00:00Z",
    });
    const store = new SqliteRichDossierStore(db);
    await store.save(identity, evaluationFingerprint, dossier());
    await new StagedServingPublisher(db).publish(identity);

    // Job 2: Excluded by Attention Gate -> OUTSIDE_SEARCH
    await db.execute(
      `INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url,company_name) VALUES('job_2','Naukri','hash-202','https://naukri.com/job/202','Beta Inc')`
    );
    await db.execute(
      `INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,company_name,location,raw_content,lifecycle_state) VALUES('version_2','job_2','hash2','Junior Associate','Beta Inc','Delhi','Entry level role.','ACTIVE')`
    );
    await db.execute(
      `INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision,eligibility,eligibility_reason_codes_json) VALUES('tenant_A','person_A','plan_A','job_2','version_2','NOT_CANDIDATE','INELIGIBLE','["SENIORITY_CONTRADICTION"]')`
    );

    // Job 3: Evaluated PASS with screening drivers -> NOT_PURSUED
    await db.execute(
      `INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url,company_name) VALUES('job_3','Indeed','hash-303','https://indeed.com/viewjob?jk=303','Gamma Ltd')`
    );
    await db.execute(
      `INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,company_name,location,raw_content,lifecycle_state) VALUES('version_3','job_3','hash3','VP Engineering','Gamma Ltd','Mumbai','Lead engineering teams.','ACTIVE')`
    );
    await db.execute(
      `INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision,eligibility,eligibility_reason_codes_json) VALUES('tenant_A','person_A','plan_A','job_3','version_3','CANDIDATE','REVIEW','["ROLE_UNKNOWN"]')`
    );
    await db.execute(
      `INSERT INTO staged_evaluations(
        id, tenant_id, person_id, canonical_job_id, opportunity_version,
        evaluation_context_fingerprint, profile_version, job_hash,
        policy_version, ontology_version, ontology_fingerprint,
        input_fingerprint, source_fingerprints_json, model_id, model_version,
        contract_version, evaluation_state, decision, screening_viability,
        blocked_reason, evaluation_json, evaluated_at
      ) VALUES (
        'staged_3', 'tenant_A', 'person_A', 'job_3', 'version_3',
        ?, 'profile', 'hash-303',
        'staged-v8', 'v1', 'hash_ontology',
        'input_3', '["jd_3"]', 'model-claude', '3.5',
        'staged-decision-v8', 'COMPLETED', 'PASS', 'BLOCKED',
        'Candidate lacks required domain licensing.',
        ?, '2026-10-01T15:00:00Z'
      )`,
      [
        activeContext.contextFingerprint,
        JSON.stringify({
          trace: {
            eligibleScreeningDrivers: [
              {
                id: "REQ-101",
                requirement: "10+ years executive leadership",
                strength: "REQUIRED",
                status: "DIRECT",
                reasoning: "JD states mandatory requirement.",
                screeningReasoning: "Senior leadership requirement.",
                mappingReasoning: "Candidate demonstrates 15+ years experience.",
              },
              {
                id: "REQ-102",
                requirement: "Specific regulatory banking license",
                strength: "REQUIRED",
                status: "NOT_EVIDENCED",
                reasoning: "Strict statutory prerequisite.",
                screeningReasoning: "Regulatory requirement.",
                mappingReasoning: "Candidate has no banking sector license.",
                gapNature: "MISSING_EXPERIENCE",
                gapReasoning: "Candidate does not possess RBI Category-1 license.",
              },
            ],
          },
        }),
      ]
    );
  });

  it("loads complete decision log and details for READY opportunity", async () => {
    const detail = await readScrapedJobDetail(
      db,
      { tenantId: "tenant_A", personId: "person_A" },
      activeContext,
      "hash-101"
    );

    expect(detail).not.toBeNull();
    expect(detail?.jobHash).toBe("hash-101");
    expect(detail?.role).toBe("Chief Operating Officer");
    expect(detail?.company).toBe("Acme Corp");
    expect(detail?.state).toBe("READY");
    expect(detail?.decision).toBe("PURSUE");
    expect(detail?.canonicalUrl).toBe("https://linkedin.com/jobs/view/101");
    expect(detail?.description).toBe("Responsible for all operations.");
    expect(detail?.attentionGate.decision).toBe("CANDIDATE");
    expect(detail?.attentionGate.eligibility).toBe("ELIGIBLE");
    expect(detail?.attentionGate.reasonCodes).toContain("ROLE_FAMILY_MATCH");
    expect(detail?.attentionGate.explanations[0].title).toBe("Target Role Family Match");
    expect(detail?.evaluation?.verdict).toBe("PURSUE");
    expect(detail?.diagnostics.stage).toBe("Dossier Delivery");
  });

  it("loads complete gate rejection details for OUTSIDE_SEARCH opportunity", async () => {
    const detail = await readScrapedJobDetail(
      db,
      { tenantId: "tenant_A", personId: "person_A" },
      activeContext,
      "hash-202"
    );

    expect(detail).not.toBeNull();
    expect(detail?.role).toBe("Junior Associate");
    expect(detail?.state).toBe("OUTSIDE_SEARCH");
    expect(detail?.decision).toBeNull();
    expect(detail?.attentionGate.decision).toBe("NOT_CANDIDATE");
    expect(detail?.attentionGate.eligibility).toBe("INELIGIBLE");
    expect(detail?.attentionGate.reasonCodes).toContain("SENIORITY_CONTRADICTION");
    expect(detail?.attentionGate.explanations[0].title).toBe("Seniority Level Contradiction");
    expect(detail?.attentionGate.explanations[0].impact).toBe("exclude");
    expect(detail?.diagnostics.stage).toBe("Attention Gate");
    expect(detail?.diagnostics.status).toBe("Outside Target Search Criteria");
  });

  it("loads structured screening drivers for NOT_PURSUED opportunity", async () => {
    const detail = await readScrapedJobDetail(
      db,
      { tenantId: "tenant_A", personId: "person_A" },
      activeContext,
      "hash-303"
    );

    expect(detail).not.toBeNull();
    expect(detail?.role).toBe("VP Engineering");
    expect(detail?.state).toBe("NOT_PURSUED");
    expect(detail?.decision).toBe("PASS");
    expect(detail?.evaluation?.verdict).toBe("PASS");
    expect(detail?.evaluation?.screeningViability).toBe("BLOCKED");
    expect(detail?.evaluation?.blockedReason).toBe("Candidate lacks required domain licensing.");

    const drivers = detail?.evaluation?.screeningDrivers || [];
    expect(drivers).toHaveLength(2);

    expect(drivers[0].id).toBe("REQ-101");
    expect(drivers[0].status).toBe("DIRECT");

    expect(drivers[1].id).toBe("REQ-102");
    expect(drivers[1].status).toBe("NOT_EVIDENCED");
    expect(drivers[1].gapNature).toBe("MISSING_EXPERIENCE");
    expect(drivers[1].gapReasoning).toBe("Candidate does not possess RBI Category-1 license.");
  });

  it("enforces tenant and person isolation", async () => {
    const foreignTenant = await readScrapedJobDetail(
      db,
      { tenantId: "tenant_B", personId: "person_A" },
      activeContext,
      "hash-101"
    );
    expect(foreignTenant).toBeNull();

    const foreignPerson = await readScrapedJobDetail(
      db,
      { tenantId: "tenant_A", personId: "person_B" },
      activeContext,
      "hash-101"
    );
    expect(foreignPerson).toBeNull();

    const nonExistent = await readScrapedJobDetail(
      db,
      { tenantId: "tenant_A", personId: "person_A" },
      activeContext,
      "hash-does-not-exist"
    );
    expect(nonExistent).toBeNull();
  });
});
