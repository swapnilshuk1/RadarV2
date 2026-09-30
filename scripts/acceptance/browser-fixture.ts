import { createHash } from "node:crypto";
import { createClient, type Client } from "@libsql/client";
import { stagedEvaluation } from "../../tests/fixtures/staged-rich-dossier";
import { createStagedEvaluationFingerprint } from "../../src/dossier/staged-decision-integrity";
import { PREPARING_DOSSIER_VERSION } from "../../src/data/sqlite/repositories/SqliteDossierCompositionQueue";

export const fixture = {
  tenantId: "acceptance-tenant",
  candidateId: "acceptance-candidate",
  adminId: "acceptance-admin",
  candidateToken: "acceptance-candidate-session-token",
  adminToken: "acceptance-admin-session-token",
  profileA: "acceptance-profile-a",
  profileB: "acceptance-profile-b",
  planA: "acceptance-plan-a",
  contextA: "acceptance-context-a",
  jobHash: "acceptance-job-1",
  canonicalJobId: "acceptance-canonical-job-1",
  opportunityVersion: "acceptance-opportunity-v1",
  pursuitId: "acceptance-pursuit-1",
  thesisId: "acceptance-thesis-1",
  resumeArtifactId: "acceptance-resume-1",
  claimA: "acceptance-claim-a",
  claimB: "acceptance-claim-b",
} as const;

const now = "2026-09-30T06:30:00.000Z";
const projection = (version: string, title: string, capabilities: string[]) => ({
  profileVersion: version,
  attainedTitle: title,
  operatingLevel: { value: "STRATEGIC", confidence: 1, evidenceIds: ["fixture"] },
  workNature: { value: "STRATEGIC_WORK", confidence: 1, evidenceIds: ["fixture"] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 1, evidenceIds: ["fixture"] },
  commercialScope: { value: "ENTERPRISE", confidence: 1, evidenceIds: ["fixture"] },
  yearsOfExperience: 20,
  coreCapabilities: capabilities,
  preferredLocations: ["India"],
  preferredWorkModel: "ANY",
  executiveThemes: ["growth", "transformation"],
});

async function exec(client: Client, sql: string, args: unknown[] = []) {
  await client.execute({ sql, args: args as any[] });
}

export async function seedBrowserFixture(url: string, authToken: string): Promise<void> {
  const client = createClient({ url, authToken });
  try {
    await exec(client, "PRAGMA foreign_keys = ON");
    await exec(client, "INSERT INTO tenants(id,status) VALUES (?, 'active')", [fixture.tenantId]);
    await exec(client, `INSERT INTO people(id,email,name,onboarded,role,email_verified,tenant_id)
      VALUES (?,?,?,?,?,?,?),(?,?,?,?,?,?,?)`, [
      fixture.candidateId, "candidate@acceptance.local", "Acceptance Candidate", 1, "user", 1, fixture.tenantId,
      fixture.adminId, "admin@acceptance.local", "Acceptance Admin", 1, "admin", 1, fixture.tenantId,
    ]);
    await exec(client, "INSERT INTO users(id,email) VALUES (?,?),(?,?)", [
      fixture.candidateId, "candidate@acceptance.local", fixture.adminId, "admin@acceptance.local",
    ]);
    const allPermissions = JSON.stringify([
      "read:evaluation","write:evaluation","manage:search_plan","run:scraper",
      "manage:credentials","read:credentials","read:person","write:person",
    ]);
    await exec(client, `INSERT INTO memberships(user_id,tenant_id,role,permissions,status)
      VALUES (?,?,'member',?,'active'),(?,?,'admin',?,'active')`, [
      fixture.candidateId, fixture.tenantId, JSON.stringify(["read:person","write:person"]),
      fixture.adminId, fixture.tenantId, allPermissions,
    ]);
    const expiry = Math.floor(Date.now() / 1000) + 86400;
    const sessionId = (token: string) => createHash("sha256").update(token).digest("hex");
    await exec(client, "INSERT INTO auth_sessions(id,user_id,expires_at) VALUES (?,?,?),(?,?,?)", [
      sessionId(fixture.candidateToken), fixture.candidateId, expiry,
      sessionId(fixture.adminToken), fixture.adminId, expiry,
    ]);
    const projectionA = projection(fixture.profileA, "SVP Growth", ["GROWTH", "TRANSFORMATION"]);
    const projectionB = projection(fixture.profileB, "Chief Growth Officer", ["GROWTH", "AI"]);
    await exec(client, `INSERT INTO career_profiles(
      id,person_id,timeline,skills,projection_json,projection_generated_at,current_title,
      years_experience,archetype,preferred_work_model,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?,?)`, [
      "profile-row-a", fixture.candidateId, "[]", "[]", JSON.stringify(projectionA), "2026-09-01T00:00:00Z",
      "SVP Growth", 20, "Growth Leader", "ANY", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z",
      "profile-row-b", fixture.candidateId, "[]", "[]", JSON.stringify(projectionB), "2026-09-30T00:00:00Z",
      "Chief Growth Officer", 20, "Growth Leader", "ANY", "2026-09-30T00:00:00Z", "2026-09-30T00:00:00Z",
    ]);
    await exec(client, `INSERT INTO candidate_documents(
      id,tenant_id,person_id,filename,storage_uri,mime_type,document_hash,status,stage,created_at,updated_at)
      VALUES (?,?,?,?,?,'text/plain',?,'COMPLETED','PROFILE_READY',?,?),
             (?,?,?,?,?,'text/plain',?,'COMPLETED','PROFILE_READY',?,?)`, [
      "doc-a", fixture.tenantId, fixture.candidateId, "profile-a.txt", "fixture://doc-a", "hash-a", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z",
      "doc-b", fixture.tenantId, fixture.candidateId, "profile-b.txt", "fixture://doc-b", "hash-b", "2026-09-30T00:00:00Z", "2026-09-30T00:00:00Z",
    ]);
    await exec(client, `INSERT INTO evidence_graphs(
      id,tenant_id,person_id,document_id,graph_json,extractor_version,prompt_version,model,created_at)
      VALUES (?,?,?,?,?,'fixture','fixture','fixture',?),(?,?,?,?,?,'fixture','fixture','fixture',?)`, [
      "graph-a", fixture.tenantId, fixture.candidateId, "doc-a", "{}", "2026-09-01T00:00:00Z",
      "graph-b", fixture.tenantId, fixture.candidateId, "doc-b", "{}", "2026-09-30T00:00:00Z",
    ]);
    await exec(client, `INSERT INTO profile_projection_source_bindings(
      tenant_id,person_id,profile_version,document_id,evidence_graph_id,document_text_hash)
      VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)`, [
      fixture.tenantId, fixture.candidateId, fixture.profileA, "doc-a", "graph-a", "text-hash-a",
      fixture.tenantId, fixture.candidateId, fixture.profileB, "doc-b", "graph-b", "text-hash-b",
    ]);
    await exec(client, `INSERT INTO career_intents(
      id,tenant_id,person_id,version,currency,target_salary_amount,preferred_locations,target_titles,
      preferred_work_model,travel_tolerance,decision_preferences_json)
      VALUES (?,?,?,1,'INR',8000000,?,?,'ANY','MEDIUM',?)`, [
      "intent-acceptance-v1", fixture.tenantId, fixture.candidateId,
      JSON.stringify(["India"]), JSON.stringify(["Chief Growth Officer"]),
      JSON.stringify({ careerMove: "PROGRESSION", leadershipPreference: "LEADERSHIP" }),
    ]);
    await exec(client, `INSERT INTO search_plans(id,tenant_id,person_id,title,status,criteria_json)
      VALUES (?,?,?,'Acceptance Plan A','active','{}')`, [fixture.planA, fixture.tenantId, fixture.candidateId]);
    await exec(client, `INSERT INTO search_plan_snapshots(
      id,search_plan_id,tenant_id,person_id,snapshot_hash,payload_json)
      VALUES ('acceptance-snapshot-a',?,?,?,'acceptance-snapshot-hash-a','{}')`, [
      fixture.planA, fixture.tenantId, fixture.candidateId,
    ]);
    await exec(client, `INSERT INTO evaluation_contexts(
      context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,
      ontology_fingerprint,policy_version,profile_version)
      VALUES (?,?,?,'acceptance-snapshot-a','v1','acceptance-ontology','staged-v8',?)`, [
      fixture.contextA, fixture.tenantId, fixture.candidateId, fixture.profileA,
    ]);
    await exec(client, `INSERT INTO evaluation_context_scopes(
      context_fingerprint,tenant_id,person_id,search_plan_id)
      VALUES (?,?,?,?)`, [fixture.contextA, fixture.tenantId, fixture.candidateId, fixture.planA]);
    await exec(client, `INSERT INTO active_evaluation_contexts(
      tenant_id,person_id,search_plan_id,context_fingerprint,activated_at,activated_by)
      VALUES (?,?,?,?,?,'acceptance-seed')`, [
      fixture.tenantId, fixture.candidateId, fixture.planA, fixture.contextA, now,
    ]);
    await exec(client, `INSERT INTO canonical_opportunities(
      id,source,source_job_id,canonical_url,company_name)
      VALUES (?,'LinkedIn',?,'https://example.com/acceptance-role','Acme Growth')`, [
      fixture.canonicalJobId, fixture.jobHash,
    ]);
    await exec(client, `INSERT INTO opportunity_versions(
      id,canonical_job_id,content_hash,job_title,company_name,location,employment_type,
      raw_content,acquisition_status,acquisition_quality,lifecycle_state,evidence_state,category_ids)
      VALUES (?,?,'acceptance-content-hash','Chief Growth Officer','Acme Growth','Gurugram',
      'Full-time','Lead enterprise growth.','COMPLETE','HIGH','ACTIVE','VERIFIED','["commercial_growth"]')`, [
      fixture.opportunityVersion, fixture.canonicalJobId,
    ]);
    await exec(client, `INSERT INTO canonical_decisions(
      id,tenant_id,person_id,canonical_job_id,action,reason,created_at,updated_at)
      VALUES ('acceptance-decision',?,?,?,'PURSUE','Acceptance fixture',?,?)`, [
      fixture.tenantId, fixture.candidateId, fixture.canonicalJobId, now, now,
    ]);
    await exec(client, `INSERT INTO candidate_claims(
      id,tenant_id,person_id,statement,claim_type,employer,role_title,metric_result,
      source_document_id,source_evidence_graph_id,source_fact_id,source_locator,provenance,
      verification_state,confidence,metric_locked,created_at,updated_at,current_projection,profile_version)
      VALUES (?,?,?,'Grew revenue 40% across the enterprise.','ACHIEVEMENT','LegacyCo','SVP Growth','40%',
      'doc-a','graph-a','fact-a','page 1','SOURCE_BACKED','VERIFIED',1,1,?,?,0,?)`, [
      fixture.claimA, fixture.tenantId, fixture.candidateId, now, now, fixture.profileA,
    ]);
    await exec(client, `INSERT INTO candidate_claims(
      id,tenant_id,person_id,statement,claim_type,employer,role_title,metric_result,
      source_document_id,source_evidence_graph_id,source_fact_id,source_locator,provenance,
      verification_state,confidence,metric_locked,created_at,updated_at,current_projection,profile_version)
      VALUES (?,?,?,'Built an AI growth engine for the new profile.','ACHIEVEMENT','FutureCo',
      'Chief Growth Officer',NULL,'doc-b','graph-b','fact-b','page 1','SOURCE_BACKED','VERIFIED',
      1,1,?,?,1,?)`, [
      fixture.claimB, fixture.tenantId, fixture.candidateId, now, now, fixture.profileB,
    ]);
    await exec(client, `INSERT INTO candidate_claims(
      id,tenant_id,person_id,statement,claim_type,employer,role_title,metric_result,
      source_document_id,source_evidence_graph_id,source_fact_id,source_locator,provenance,
      verification_state,confidence,metric_locked,created_at,updated_at,current_projection,profile_version)
      VALUES ('acceptance-claim-a-currency',?,?,'Managed ₹80 crore transformation portfolio.',
      'ACHIEVEMENT','LegacyCo','SVP Growth','₹80 crore','doc-a','graph-a','fact-a-currency',
      'page 2','SOURCE_BACKED','VERIFIED',1,1,?,?,0,?)`, [
      fixture.tenantId, fixture.candidateId, now, now, fixture.profileA,
    ]);
    await exec(client, `INSERT INTO opportunity_pursuits(
      id,tenant_id,person_id,job_hash,company,role_title,status,preparation_state,next_action,next_action_due,
      created_at,updated_at,canonical_job_id,opportunity_version,evaluation_context_fingerprint,
      evaluation_fingerprint,profile_version)
      VALUES (?,?,?,?,?,?,'INTERVIEWING','READY','Follow up with search partner','2026-10-03',
      ?,?,?,?,?,?,?)`, [
      fixture.pursuitId, fixture.tenantId, fixture.candidateId, fixture.jobHash,
      "Acme Growth", "Chief Growth Officer", now, now, fixture.canonicalJobId,
      fixture.opportunityVersion, fixture.contextA, "acceptance-eval-fingerprint", fixture.profileA,
    ]);
    await exec(client, `INSERT INTO pursuit_theses(
      id,pursuit_id,version,target_mandate,win_theme,recommended_positioning,created_at,
      canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,
      profile_version,ledger_binding_fingerprint,anchor_document_id)
      VALUES (?,?,1,'Scale enterprise growth','Proven growth at scale',
      'Lead with enterprise growth evidence',?,?,?,?,?,?,'acceptance-ledger-a','doc-a')`, [
      fixture.thesisId, fixture.pursuitId, now, fixture.canonicalJobId,
      fixture.opportunityVersion, fixture.contextA, "acceptance-eval-fingerprint", fixture.profileA,
    ]);
    await exec(
      client,
      "UPDATE opportunity_pursuits SET active_thesis_id=? WHERE id=?",
      [fixture.thesisId, fixture.pursuitId],
    );
    const resume = {
      kind: "RESUME",
      resume: {
        fullName: "Acceptance Candidate",
        contactLine: "candidate@acceptance.local · Gurugram",
        headline: "Enterprise growth leader",
        executiveSummary:
          "Executive growth leader who scaled complex businesses and managed a ₹80 crore transformation portfolio.",
        impactAnchors: [{
          claimId: fixture.claimA,
          text: "Grew revenue 40% across the enterprise.",
          edited: false,
          provenance: "SOURCE_BACKED",
        }],
        roles: [{
          employer: "LegacyCo",
          roleTitle: "SVP Growth",
          period: "2020–2026",
          bullets: [{
            claimId: fixture.claimA,
            text: "Grew revenue 40% across the enterprise.",
            edited: false,
            provenance: "SOURCE_BACKED",
          }],
        }],
        capabilities: ["Growth", "Transformation"],
        anchorDocumentId: "doc-a",
      },
    };
    await exec(client, `INSERT INTO pursuit_artifacts(
      id,pursuit_id,thesis_id,artifact_type,version,content_json,rendered_text,status,
      provenance_flags_json,created_at,updated_at)
      VALUES (?,?,?,'RESUME',1,?,NULL,'DRAFT','[]',?,?)`, [
      fixture.resumeArtifactId,
      fixture.pursuitId,
      fixture.thesisId,
      JSON.stringify(resume),
      now,
      now,
    ]);
  } finally {
    client.close();
  }
}

export async function attachDecisionsFixtureToActivePlan(
  url: string,
  authToken: string,
): Promise<string> {
  const client = createClient({ url, authToken });
  try {
    const active = await client.execute({
      sql: `SELECT search_plan_id, context_fingerprint FROM active_evaluation_contexts
        WHERE tenant_id=? AND person_id=? ORDER BY activated_at DESC LIMIT 1`,
      args: [fixture.tenantId, fixture.candidateId],
    });
    const planId = String(active.rows[0]?.search_plan_id ?? "");
    const contextFingerprint = String(active.rows[0]?.context_fingerprint ?? "");
    if (!planId) throw new Error("ACCEPTANCE_ACTIVE_PLAN_MISSING");
    const inputFingerprint = "acceptance-evaluation-input";
    const evaluationFingerprint = createStagedEvaluationFingerprint({
      evaluationContextFingerprint: contextFingerprint,
      inputFingerprint,
      evaluation: stagedEvaluation,
    });
    const context = await client.execute({
      sql: "SELECT ontology_version, ontology_fingerprint, policy_version FROM evaluation_contexts WHERE context_fingerprint=?",
      args: [contextFingerprint],
    });
    await exec(client, `INSERT INTO search_plan_candidates(
      tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision,
      eligibility,eligibility_reason_codes_json,location_policy,location_evidence)
      VALUES (?,?,?,?,?,'CANDIDATE','ELIGIBLE','[]','NATIONWIDE','fixture')
      ON CONFLICT(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version)
      DO UPDATE SET attention_decision='CANDIDATE'`, [
      fixture.tenantId,
      fixture.candidateId,
      planId,
      fixture.canonicalJobId,
      fixture.opportunityVersion,
    ]);
    await exec(client, `INSERT INTO materialized_evaluations(
      id,tenant_id,person_id,canonical_job_id,opportunity_version,
      evaluation_context_fingerprint,evaluation_fingerprint,evaluation_state,decision,
      quality_score,vetoed,evaluation_json)
      VALUES ('acceptance-evaluation-b',?,?,?,?,?,?,'STAGED_EVALUATED','PURSUE',NULL,0,?)`, [
      fixture.tenantId, fixture.candidateId, fixture.canonicalJobId,
      fixture.opportunityVersion, contextFingerprint, evaluationFingerprint,
      JSON.stringify({ schemaVersion: "staged-serving-v1", evaluationFingerprint,
        verdict: "PURSUE", screeningViability: "PLAUSIBLE",
        presentationVersion: PREPARING_DOSSIER_VERSION }),
    ]);
    await exec(client, `INSERT INTO staged_evaluations(
      id,tenant_id,person_id,canonical_job_id,opportunity_version,job_hash,
      evaluation_context_fingerprint,profile_version,policy_version,ontology_version,
      ontology_fingerprint,input_fingerprint,source_fingerprints_json,model_id,model_version,
      contract_version,evaluation_state,decision,screening_viability,evaluation_json,evaluated_at)
      VALUES ('acceptance-staged-b',?,?,?,?,?,?,?,?,?,?,?,'[]','fixture','fixture',
      'staged-decision-v8','COMPLETED','PURSUE','PLAUSIBLE',?,?)`, [
      fixture.tenantId, fixture.candidateId, fixture.canonicalJobId,
      fixture.opportunityVersion, fixture.jobHash, contextFingerprint, fixture.profileB,
      String(context.rows[0]?.policy_version), String(context.rows[0]?.ontology_version),
      String(context.rows[0]?.ontology_fingerprint), inputFingerprint,
      JSON.stringify(stagedEvaluation), new Date().toISOString(),
    ]);
    return planId;
  } finally {
    client.close();
  }
}
