import { createClient } from "@libsql/client";
import { computeCanonicalJobId, computeContentHash, computeOpportunityVersionId } from "../src/lib/domain/canonical_identity";
import { computeSearchPlanSnapshotHash, computeEvaluationContextFingerprint } from "../src/lib/domain/evaluation_fingerprint";
import { computeDeterministicHash } from "../src/lib/ontology/compiler/OntologyCompiler";
import { evaluateAttentionGate } from "../src/lib/intelligence/AttentionGate";

import { getDatabaseAdapter } from "../src/data/database";

// Helper to get raw db client to use batch()
function getRawClient() {
  getDatabaseAdapter(); // Initializes process.env from .env.local
  const url = process.env.TURSO_CONNECTION_URL || process.env.TURSO_DATABASE_URL || "";
  const authToken = process.env.TURSO_AUTH_TOKEN || "";
  return createClient({ url, authToken });
}

export async function runM7TenantMigrationFast() {
  const client = getRawClient();

  console.log("==================================================");
  console.log("STARTING MILESTONE M7 PRODUCTION TENANT MIGRATION (FAST BATCH MODE)");
  console.log("==================================================");

  // 1. PHASE M7.2: Tenant & Identity Seeding
  console.log("\n[M7.2] Seeding Tenants, Users, and Memberships...");
  const tenantId = "tenant_default";
  const primaryUserId = "ms6i7e3y-4x0chy5fy";
  const primaryEmail = "swapnilshuk@gmail.com";

  let batchStmts: any[] = [];

  batchStmts.push({
    sql: `
      INSERT INTO tenants (id, status, created_at, updated_at)
      VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET status = 'active', updated_at = CURRENT_TIMESTAMP
    `,
    args: [tenantId]
  });

  const allUsers = [
    { id: primaryUserId, email: primaryEmail, role: "owner", permissions: ["read:evaluation", "write:evaluation", "manage:search_plan", "manage:credentials", "read:credentials", "read:person", "write:person", "read", "manage"] },
    { id: "guest-user", email: "guest@radar.advisory", role: "viewer", permissions: ["read:evaluation", "read:person", "read"] },
    { id: "swapnil-shukla", email: "swapnil@radar.io", role: "owner", permissions: ["read:evaluation", "write:evaluation", "manage:search_plan", "manage:credentials", "read:credentials", "read:person", "write:person", "read", "manage"] },
  ];

  for (const u of allUsers) {
    batchStmts.push({
      sql: `
        INSERT INTO users (id, email, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET email = excluded.email
      `,
      args: [u.id, u.email]
    });

    batchStmts.push({
      sql: `
        INSERT INTO memberships (user_id, tenant_id, role, permissions, status, created_at)
        VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, tenant_id) DO UPDATE SET
          role = excluded.role,
          permissions = excluded.permissions,
          status = 'active'
      `,
      args: [u.id, tenantId, u.role, JSON.stringify(u.permissions)]
    });
  }

  // Assign tenant_id to people
  batchStmts.push({
    sql: `UPDATE people SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id != ?`,
    args: [tenantId, tenantId]
  });

  await client.batch(batchStmts, "write");
  console.log("✓ Identity and memberships provisioned.");
  batchStmts = [];

  // 2. PHASE M7.3: Canonical Search Plan & Evaluation Context Seeding
  console.log("\n[M7.3] Seeding Canonical Search Plan & Evaluation Context...");
  const searchPlanId = "sp_canonical_swapnil";
  const searchCriteria = {
    targetSeniority: ["VP", "Director", "Head", "Chief", "CXO", "Lead", "President", "Executive", "Senior", "Manager", "Principal"],
    targetRoles: [],
    targetLocations: [],
  };

  batchStmts.push({
    sql: `
      INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
      VALUES (?, ?, ?, 'Executive Career Search Plan', 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        status = 'active',
        criteria_json = excluded.criteria_json,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [searchPlanId, tenantId, primaryUserId, JSON.stringify(searchCriteria)]
  });

  const snapshotHash = computeSearchPlanSnapshotHash(searchCriteria);
  const snapshotId = `sps_${snapshotHash.slice(0, 16)}`;

  batchStmts.push({
    sql: `
      INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(search_plan_id, snapshot_hash) DO NOTHING
    `,
    args: [snapshotId, searchPlanId, tenantId, primaryUserId, snapshotHash, JSON.stringify(searchCriteria)]
  });

  const ontologyVersion = "3.0.0";
  const ontologyFingerprint = computeDeterministicHash({ version: "3.0.0", definitions: "canonical-ontology-v3" });
  const policyVersion = "v4.1";
  const profileVersion = "p_v1";

  const contextFingerprint = computeEvaluationContextFingerprint({
    tenantId,
    personId: primaryUserId,
    searchPlanSnapshotId: snapshotId,
    ontologyVersion,
    ontologyFingerprint,
    policyVersion,
    profileVersion,
  });

  batchStmts.push({
    sql: `
      INSERT INTO evaluation_contexts (
        context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
        ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(context_fingerprint) DO NOTHING
    `,
    args: [
      contextFingerprint,
      tenantId,
      primaryUserId,
      snapshotId,
      ontologyVersion,
      ontologyFingerprint,
      policyVersion,
      profileVersion,
    ]
  });

  await client.batch(batchStmts, "write");
  console.log(`✓ Search Plan (${searchPlanId}) and Context Fingerprint (${contextFingerprint.slice(0, 16)}...) seeded.`);
  batchStmts = [];

  // 3. PHASE M7.4: Canonical Opportunity & Projection Backfill
  console.log("\n[M7.4] Backfilling Canonical Opportunities & Projections...");

  const oppRowsRes = await client.execute(`
    SELECT 
      o.id as opp_id,
      o.canonical_title as title,
      o.location as location,
      o.employment_type as employment_type,
      c.name as company_name,
      d.content as doc_content,
      disc.source_name as disc_source
    FROM opportunities o
    LEFT JOIN companies c ON o.company_id = c.id
    LEFT JOIN documents d ON d.opportunity_id = o.id
    LEFT JOIN opportunity_discoveries disc ON disc.opportunity_id = o.id
  `);

  const oppRows = oppRowsRes.rows;
  console.log(`Processing ${oppRows.length} opportunities in large batches...`);

  const BATCH_SIZE = 500;
  let canonicalOppsCount = 0;
  let candidateCount = 0;

  for (let i = 0; i < oppRows.length; i += BATCH_SIZE) {
    const batch = oppRows.slice(i, i + BATCH_SIZE);
    let stmts: any[] = [];

    for (const r of batch) {
      let parsedDoc: any = {};
      if (r.doc_content) {
        try {
          parsedDoc = typeof r.doc_content === "string" ? JSON.parse(r.doc_content) : r.doc_content;
        } catch {}
      }

      const source = r.disc_source || parsedDoc.scrapedFrom || parsedDoc.source || "LinkedIn";
      const sourceJobId = parsedDoc.jobHash || r.opp_id;
      const canonicalUrl = parsedDoc.applyUrl || parsedDoc.url || `https://radar.internal/jobs/${r.opp_id}`;
      const companyName = r.company_name || parsedDoc.company || "Executive Firm";
      const title = r.title || parsedDoc.role || "Executive Role";
      const location = r.location || parsedDoc.location || "Remote";
      const employmentType = r.employment_type || parsedDoc.employmentType || null;
      const rawContent = parsedDoc.normalizedText || parsedDoc.rawText || r.doc_content || title;

      const canonicalJobId = computeCanonicalJobId({ source: source as string, sourceJobId: sourceJobId as string });
      const contentHash = computeContentHash({
        title: title as string,
        companyName: companyName as string,
        location: location as string,
        employmentType: employmentType as string,
        rawContent: rawContent as string,
      });
      const versionId = computeOpportunityVersionId(canonicalJobId, contentHash);

      stmts.push({
        sql: `
          INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(source, source_job_id) DO UPDATE SET
            last_seen_at = CURRENT_TIMESTAMP
        `,
        args: [canonicalJobId, source, sourceJobId, canonicalUrl, companyName]
      });

      stmts.push({
        sql: `
          INSERT INTO opportunity_versions (
            id, canonical_job_id, content_hash, job_title, company_name,
            location, employment_type, raw_content, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(canonical_job_id, content_hash) DO NOTHING
        `,
        args: [versionId, canonicalJobId, contentHash, title, companyName, location, employmentType, rawContent]
      });

      const gateResult = evaluateAttentionGate(
        {
          id: versionId,
          canonicalJobId,
          contentHash,
          jobTitle: title as string,
          companyName: companyName as string,
          location: location as string,
          employmentType: employmentType as string,
          rawContent: rawContent as string,
          createdAt: new Date().toISOString(),
        },
        searchCriteria
      );

      stmts.push({
        sql: `
          INSERT INTO search_plan_candidates (
            tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
          DO UPDATE SET attention_decision = excluded.attention_decision
        `,
        args: [tenantId, primaryUserId, searchPlanId, canonicalJobId, versionId, gateResult.decision]
      });

      canonicalOppsCount++;
      if (gateResult.decision === "CANDIDATE") candidateCount++;
    }

    await client.batch(stmts, "write");
    process.stdout.write(`Processed ${Math.min(i + BATCH_SIZE, oppRows.length)} / ${oppRows.length} opportunities...\r`);
  }

  console.log(`\n✓ Projected ${canonicalOppsCount} opportunities (${candidateCount} marked CANDIDATE).`);

  // 4. PHASE M7.5: Materialized Evaluations Backfill
  console.log("\n[M7.5] Backfilling Materialized Evaluations for primary user...");

  const evalRowsRes = await client.execute({
    sql: `
      SELECT 
        ce.job_hash,
        ce.person_id,
        ce.engine_verdict,
        ce.quality_score,
        ce.evaluation_json,
        ov.canonical_job_id,
        ov.id as opportunity_version
      FROM candidate_evaluations ce
      JOIN canonical_opportunities co ON co.source_job_id = ce.job_hash
      JOIN opportunity_versions ov ON ov.canonical_job_id = co.id
      WHERE ce.person_id = ?
    `,
    args: [primaryUserId]
  });

  const evalRows = evalRowsRes.rows;
  console.log(`Found ${evalRows.length} candidate_evaluations matching canonical opportunities.`);

  let matEvalCount = 0;
  for (let i = 0; i < evalRows.length; i += BATCH_SIZE) {
    const batch = evalRows.slice(i, i + BATCH_SIZE);
    let stmts: any[] = [];

    for (const ev of batch) {
      const decision = ev.engine_verdict === "PURSUE" ? "PURSUE" : (ev.engine_verdict === "CONSIDER" ? "CONSIDER" : "PASS");
      const qualityScore = typeof ev.quality_score === "number" ? ev.quality_score : 50;
      const evalId = `me_${(ev.canonical_job_id as string).slice(0, 8)}_${(ev.opportunity_version as string).slice(0, 8)}_${contextFingerprint.slice(0, 8)}`;

      stmts.push({
        sql: `
          INSERT INTO materialized_evaluations (
            id, tenant_id, person_id, canonical_job_id, opportunity_version,
            evaluation_context_fingerprint, decision, quality_score, rationale,
            evidence_ids, evaluation_json, materialized_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, CURRENT_TIMESTAMP)
          ON CONFLICT(canonical_job_id, opportunity_version, evaluation_context_fingerprint)
          DO UPDATE SET
            decision = excluded.decision,
            quality_score = excluded.quality_score,
            evaluation_json = excluded.evaluation_json
        `,
        args: [
          evalId,
          tenantId,
          primaryUserId,
          ev.canonical_job_id,
          ev.opportunity_version,
          contextFingerprint,
          decision,
          qualityScore,
          `Materialized evaluation for ${ev.canonical_job_id}`,
          ev.evaluation_json || "{}",
        ]
      });
    }

    await client.batch(stmts, "write");
    matEvalCount += batch.length;
    process.stdout.write(`Materialized ${Math.min(i + BATCH_SIZE, evalRows.length)} / ${evalRows.length} evaluations...\r`);
  }

  console.log(`\n✓ Materialized ${matEvalCount} evaluations under context ${contextFingerprint.slice(0, 16)}...`);

  console.log("\n==================================================");
  console.log("MILESTONE M7 MIGRATION COMPLETED SUCCESSFULLY");
  console.log("==================================================");
}

runM7TenantMigrationFast()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("MIGRATION FAILED:", err);
    process.exit(1);
  });
