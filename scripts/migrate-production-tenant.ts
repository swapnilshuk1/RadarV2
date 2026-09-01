import { getDatabaseAdapter } from "../src/data/database";
import { computeCanonicalJobId, computeContentHash, computeOpportunityVersionId } from "../src/lib/domain/canonical_identity";
import { computeSearchPlanSnapshotHash, computeEvaluationContextFingerprint } from "../src/lib/domain/evaluation_fingerprint";
import { computeDeterministicHash } from "../src/lib/ontology/compiler/OntologyCompiler";
import { evaluateAttentionGate } from "../src/lib/intelligence/AttentionGate";
import { isExternalPostingUrl } from "../src/lib/acquisition/external-posting-url";

export async function runM7TenantMigration() {
  const db = getDatabaseAdapter();

  console.log("==================================================");
  console.log("STARTING MILESTONE M7 PRODUCTION TENANT MIGRATION");
  console.log("==================================================");

  // 1. PHASE M7.2: Tenant & Identity Seeding
  console.log("\n[M7.2] Seeding Tenants, Users, and Memberships...");
  const tenantId = "tenant_default";
  const primaryUserId = "ms6i7e3y-4x0chy5fy";
  const primaryEmail = "swapnilshuk@gmail.com";

  await db.execute(`
    INSERT INTO tenants (id, status, created_at, updated_at)
    VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET status = 'active', updated_at = CURRENT_TIMESTAMP
  `, [tenantId]);

  const allUsers = [
    { id: primaryUserId, email: primaryEmail, role: "owner", permissions: ["read:evaluation", "write:evaluation", "manage:search_plan", "manage:credentials", "read:credentials", "read:person", "write:person", "read", "manage"] },
    { id: "guest-user", email: "guest@radar.advisory", role: "viewer", permissions: ["read:evaluation", "read:person", "read"] },
    { id: "swapnil-shukla", email: "swapnil@radar.io", role: "owner", permissions: ["read:evaluation", "write:evaluation", "manage:search_plan", "manage:credentials", "read:credentials", "read:person", "write:person", "read", "manage"] },
  ];

  for (const u of allUsers) {
    await db.execute(`
      INSERT INTO users (id, email, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET email = EXCLUDED.email
    `, [u.id, u.email]);

    await db.execute(`
      INSERT INTO memberships (user_id, tenant_id, role, permissions, status, created_at)
      VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, tenant_id) DO UPDATE SET
        role = EXCLUDED.role,
        permissions = EXCLUDED.permissions,
        status = 'active'
    `, [u.id, tenantId, u.role, JSON.stringify(u.permissions)]);
  }

  // Assign tenant_id to people
  await db.execute(`
    UPDATE people SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id != ?
  `, [tenantId, tenantId]);

  console.log("✓ Identity and memberships provisioned.");

  // 2. PHASE M7.3: Canonical Search Plan & Evaluation Context Seeding
  console.log("\n[M7.3] Seeding Canonical Search Plan & Evaluation Context...");
  const searchPlanId = "sp_canonical_swapnil";
  const searchCriteria = {
    targetSeniority: ["VP", "Director", "Head", "Chief", "CXO", "Lead", "President", "Executive", "Senior", "Manager", "Principal"],
    targetRoles: [],
    targetLocations: [],
  };

  await db.execute(`
    INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
    VALUES (?, ?, ?, 'Executive Career Search Plan', 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      status = 'active',
      criteria_json = EXCLUDED.criteria_json,
      updated_at = CURRENT_TIMESTAMP
  `, [searchPlanId, tenantId, primaryUserId, JSON.stringify(searchCriteria)]);

  const snapshotHash = computeSearchPlanSnapshotHash(searchCriteria);
  const snapshotId = `sps_${snapshotHash.slice(0, 16)}`;

  await db.execute(`
    INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(search_plan_id, snapshot_hash) DO NOTHING
  `, [snapshotId, searchPlanId, tenantId, primaryUserId, snapshotHash, JSON.stringify(searchCriteria)]);

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

  await db.execute(`
    INSERT INTO evaluation_contexts (
      context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
      ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(context_fingerprint) DO NOTHING
  `, [
    contextFingerprint,
    tenantId,
    primaryUserId,
    snapshotId,
    ontologyVersion,
    ontologyFingerprint,
    policyVersion,
    profileVersion,
  ]);

  console.log(`✓ Search Plan (${searchPlanId}) and Context Fingerprint (${contextFingerprint.slice(0, 16)}...) seeded.`);

  // 3. PHASE M7.4: Canonical Opportunity & Projection Backfill
  console.log("\n[M7.4] Backfilling Canonical Opportunities & Projections...");

  const oppRows = await db.many<any>(`
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

  console.log(`Processing ${oppRows.length} opportunities in batches...`);

  const BATCH_SIZE = 100;
  let canonicalOppsCount = 0;
  let candidateCount = 0;

  for (let i = 0; i < oppRows.length; i += BATCH_SIZE) {
    const batch = oppRows.slice(i, i + BATCH_SIZE);

    for (const r of batch) {
      let parsedDoc: any = {};
      if (r.doc_content) {
        try {
          parsedDoc = typeof r.doc_content === "string" ? JSON.parse(r.doc_content) : r.doc_content;
        } catch {}
      }

      const source = r.disc_source || parsedDoc.scrapedFrom || parsedDoc.source || "LinkedIn";
      const sourceJobId = parsedDoc.jobHash || r.opp_id;
      const canonicalUrl = parsedDoc.applyUrl || parsedDoc.url;
      if (!isExternalPostingUrl(canonicalUrl)) {
        console.warn(`[M7_SKIP_NO_EXTERNAL_URL] ${r.opp_id}`);
        continue;
      }
      const companyName = r.company_name || parsedDoc.company || "Executive Firm";
      const title = r.title || parsedDoc.role || "Executive Role";
      const location = r.location || parsedDoc.location || "Remote";
      const employmentType = r.employment_type || parsedDoc.employmentType || null;
      const rawContent = parsedDoc.normalizedText || parsedDoc.rawText || r.doc_content || title;

      const canonicalJobId = computeCanonicalJobId({ source, sourceJobId });
      const contentHash = computeContentHash({
        title,
        companyName,
        location,
        employmentType,
        rawContent,
      });
      const versionId = computeOpportunityVersionId(canonicalJobId, contentHash);

      // Upsert canonical_opportunities
      await db.execute(`
        INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(source, source_job_id) DO UPDATE SET
          last_seen_at = CURRENT_TIMESTAMP
      `, [canonicalJobId, source, sourceJobId, canonicalUrl, companyName]);

      // Upsert opportunity_versions
      await db.execute(`
        INSERT INTO opportunity_versions (
          id, canonical_job_id, content_hash, job_title, company_name,
          location, employment_type, raw_content, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(canonical_job_id, content_hash) DO NOTHING
      `, [versionId, canonicalJobId, contentHash, title, companyName, location, employmentType, rawContent]);

      // Attention Gate Evaluation
      const gateResult = evaluateAttentionGate(
        {
          id: versionId,
          canonicalJobId,
          contentHash,
          jobTitle: title,
          companyName,
          location,
          employmentType,
          rawContent,
          createdAt: new Date().toISOString(),
        },
        searchCriteria
      );

      await db.execute(`
        INSERT INTO search_plan_candidates (
          tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
        DO UPDATE SET attention_decision = EXCLUDED.attention_decision
      `, [tenantId, primaryUserId, searchPlanId, canonicalJobId, versionId, gateResult.decision]);

      canonicalOppsCount++;
      if (gateResult.decision === "CANDIDATE") candidateCount++;
    }

    process.stdout.write(`Processed ${Math.min(i + BATCH_SIZE, oppRows.length)} / ${oppRows.length} opportunities...\r`);
  }

  console.log(`\n✓ Projected ${canonicalOppsCount} opportunities (${candidateCount} marked CANDIDATE).`);

  // 4. PHASE M7.5: Materialized Evaluations Backfill
  console.log("\n[M7.5] Backfilling Materialized Evaluations for primary user...");

  const evalRows = await db.many<any>(`
    SELECT 
      ce.job_hash,
      ce.person_id,
      ce.engine_verdict,
      ce.quality_score,
      ce.evaluation_json,
      ce.created_at,
      ov.canonical_job_id,
      ov.id as opportunity_version
    FROM candidate_evaluations ce
    JOIN canonical_opportunities co ON co.source_job_id = ce.job_hash
    JOIN opportunity_versions ov ON ov.canonical_job_id = co.id
    WHERE ce.person_id = ?
  `, [primaryUserId]);

  console.log(`Found ${evalRows.length} candidate_evaluations matching canonical opportunities.`);

  let matEvalCount = 0;
  for (const ev of evalRows) {
    const decision = ev.engine_verdict === "PURSUE" ? "PURSUE" : (ev.engine_verdict === "CONSIDER" ? "CONSIDER" : "PASS");
    const qualityScore = typeof ev.quality_score === "number" ? ev.quality_score : 50;
    const evalId = `me_${ev.canonical_job_id.slice(0, 8)}_${ev.opportunity_version.slice(0, 8)}_${contextFingerprint.slice(0, 8)}`;

    await db.execute(`
      INSERT INTO materialized_evaluations (
        id, tenant_id, person_id, canonical_job_id, opportunity_version,
        evaluation_context_fingerprint, decision, quality_score, rationale,
        evidence_ids, evaluation_json, materialized_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(canonical_job_id, opportunity_version, evaluation_context_fingerprint)
      DO UPDATE SET
        decision = EXCLUDED.decision,
        quality_score = EXCLUDED.quality_score,
        evaluation_json = EXCLUDED.evaluation_json
    `, [
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
    ]);

    matEvalCount++;
  }

  console.log(`✓ Materialized ${matEvalCount} evaluations under context ${contextFingerprint.slice(0, 16)}...`);

  console.log("\n==================================================");
  console.log("MILESTONE M7 MIGRATION COMPLETED SUCCESSFULLY");
  console.log("==================================================");
}

if (process.argv[1]?.includes("migrate-production-tenant")) {
  runM7TenantMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("MIGRATION FAILED:", err);
      process.exit(1);
    });
}
