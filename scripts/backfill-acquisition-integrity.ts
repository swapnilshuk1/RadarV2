/**
 * scripts/backfill-acquisition-integrity.ts
 *
 * RADAR V4 — Canonical Acquisition Integrity, Provenance & Recovery Backfill Engine.
 * 
 * Objectives:
 * 1. Eliminate historical state laundering across all 2,231 opportunities in Turso Cloud.
 * 2. Explicitly classify opportunity_versions into orthogonal state dimensions:
 *    - acquisition_status: 'ACQUIRED' | 'RECOVERY_PENDING' | 'CAPTURE_FAILED'
 *    - acquisition_quality: 'COMPLETE' | 'PARTIAL' | 'MINIMAL' | 'INVALID'
 *    - failure_class: 'PARTIAL_CONTENT' | 'EMPTY_CONTENT' | NULL
 *    - lifecycle_state: 'ACTIVE'
 *    - evidence_state: 'SUFFICIENT' | 'UNVERIFIED'
 * 3. Update materialized_evaluations:
 *    - evaluation_state: 'EVALUATED' vs 'SPARSE_SPEC'
 *    - Nullifies decision and quality_score for SPARSE_SPEC (No evidence -> no decision).
 * 4. Populate durable recovery_queue for all corrupted/sparse captures (266-record forensic cohort).
 */

import { getDatabaseAdapter } from "../src/data/database";

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      const delay = 500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function runBackfill() {
  console.log("════════════════════════════════════════════════════════════════════════════");
  console.log("      RADAR V4 — Canonical Acquisition Integrity & Recovery Backfill        ");
  console.log("════════════════════════════════════════════════════════════════════════════\n");

  const db = getDatabaseAdapter();

  // 1. Fetch default tenant
  const tenantRow = await db.one<{ id: string }>("SELECT id FROM tenants LIMIT 1");
  const tenantId = tenantRow?.id || "default";

  // 2. Fetch all opportunity_versions
  console.log("[1/4] Inspecting opportunity_versions in Turso Cloud...");
  const versions = await db.many<{
    id: string;
    canonical_job_id: string;
    job_title: string;
    company_name: string | null;
    raw_content: string | null;
    acquisition_status: string;
    acquisition_quality: string;
    lifecycle_state: string;
  }>(`
    SELECT id, canonical_job_id, job_title, company_name, raw_content, 
           acquisition_status, acquisition_quality, lifecycle_state
    FROM opportunity_versions
  `);

  console.log(`✓ Found ${versions.length} opportunity_versions.`);

  // 3. Classify each version
  console.log("\n[2/4] Classifying orthogonal provenance states...");
  let unverifiedCount = 0;
  let minimalCount = 0;
  let invalidCount = 0;

  const versionUpdates: Array<{
    id: string;
    acquisition_status: string;
    acquisition_quality: string;
    failure_class: string | null;
    lifecycle_state: string;
    evidence_state: string;
  }> = [];

  for (const v of versions) {
    const rawContent = (v.raw_content || "").trim();
    const descLen = rawContent.length;

    let quality: "UNKNOWN" | "COMPLETE" | "PARTIAL" | "MINIMAL" | "INVALID";
    let status: "UNKNOWN" | "ACQUIRED" | "RECOVERY_PENDING" | "CAPTURE_FAILED";
    let failureClass: string | null = null;
    let evidenceState: "SUFFICIENT" | "GENUINELY_SPARSE" | "UNVERIFIED";
    let lifecycle: "UNKNOWN" | "ACTIVE" | "EXPIRED" | "REMOVED_404";

    if (descLen === 0) {
      // Deterministically empty / failed capture
      quality = "INVALID";
      status = "CAPTURE_FAILED";
      failureClass = "EMPTY_CONTENT";
      evidenceState = "UNVERIFIED";
      lifecycle = "UNKNOWN";
      invalidCount++;
    } else if (descLen < 200) {
      // Deterministically sparse / corrupted capture -> routes to recovery
      quality = "MINIMAL";
      status = "RECOVERY_PENDING";
      failureClass = "PARTIAL_CONTENT";
      evidenceState = "UNVERIFIED";
      lifecycle = "UNKNOWN";
      minimalCount++;
    } else {
      // Historical capture with text: do NOT launder into COMPLETE/ACTIVE/SUFFICIENT
      // Strictly classify as UNKNOWN provenance until verified by reacquisition or provenance audit
      quality = "UNKNOWN";
      status = "UNKNOWN";
      failureClass = null;
      evidenceState = "UNVERIFIED";
      lifecycle = "UNKNOWN";
      unverifiedCount++;
    }

    versionUpdates.push({
      id: v.id,
      acquisition_status: status,
      acquisition_quality: quality,
      failure_class: failureClass,
      lifecycle_state: lifecycle,
      evidence_state: evidenceState,
    });
  }

  console.log(`  - UNKNOWN Provenance (>= 200 chars, uncertified): ${unverifiedCount}`);
  console.log(`  - MINIMAL (1 - 199 chars, enqueued for recovery): ${minimalCount}`);
  console.log(`  - INVALID (0 chars / empty):                      ${invalidCount}`);

  // Batch update versions in transaction batches of 100
  const batchSize = 100;
  for (let i = 0; i < versionUpdates.length; i += batchSize) {
    const chunk = versionUpdates.slice(i, i + batchSize);
    await withRetry(async () => {
      await db.transaction(async (tx) => {
        for (const item of chunk) {
          await tx.execute(
            `UPDATE opportunity_versions
             SET acquisition_status = ?,
                 acquisition_quality = ?,
                 failure_class = ?,
                 lifecycle_state = ?,
                 evidence_state = ?
             WHERE id = ?`,
            [
              item.acquisition_status,
              item.acquisition_quality,
              item.failure_class,
              item.lifecycle_state,
              item.evidence_state,
              item.id,
            ]
          );
        }
      });
    });
    process.stdout.write(`\r  ✓ Updated opportunity_versions: ${Math.min(i + batchSize, versionUpdates.length)} / ${versionUpdates.length}`);
  }
  console.log("\n✓ All opportunity_versions updated with explicit provenance.");

  // 4. Update materialized_evaluations
  console.log("\n[3/4] Harmonizing materialized_evaluations...");
  const versionStateMap = new Map<string, { status: string; quality: string; evidence: string }>();
  for (const v of versionUpdates) {
    versionStateMap.set(v.id, {
      status: v.acquisition_status,
      quality: v.acquisition_quality,
      evidence: v.evidence_state,
    });
  }

  const evals = await withRetry(async () => {
    return await db.many<{
      id: string;
      opportunity_version: string;
      decision: string | null;
    }>("SELECT id, opportunity_version, decision FROM materialized_evaluations");
  });

  let acqPendingCount = 0;
  let acqFailedCount = 0;
  let sparseEvalCount = 0;
  let evaluatedCount = 0;

  for (let i = 0; i < evals.length; i += batchSize) {
    const chunk = evals.slice(i, i + batchSize);
    await withRetry(async () => {
      await db.transaction(async (tx) => {
        for (const e of chunk) {
          const vState = versionStateMap.get(e.opportunity_version);
          let targetEvalState = "EVALUATED";
          let nullifyDecision = false;

          if (vState?.status === "RECOVERY_PENDING" || vState?.quality === "MINIMAL") {
            targetEvalState = "ACQUISITION_PENDING";
            nullifyDecision = true;
            acqPendingCount++;
          } else if (vState?.status === "CAPTURE_FAILED" || vState?.quality === "INVALID") {
            targetEvalState = "ACQUISITION_FAILED";
            nullifyDecision = true;
            acqFailedCount++;
          } else if (vState?.evidence === "GENUINELY_SPARSE" && vState?.status === "ACQUIRED") {
            targetEvalState = "SPARSE_SPEC";
            nullifyDecision = true;
            sparseEvalCount++;
          } else {
            targetEvalState = "EVALUATED";
            evaluatedCount++;
          }

          if (nullifyDecision) {
            await tx.execute(
              `UPDATE materialized_evaluations
               SET evaluation_state = ?,
                   decision = NULL,
                   quality_score = NULL
               WHERE id = ?`,
              [targetEvalState, e.id]
            );
          } else {
            await tx.execute(
              `UPDATE materialized_evaluations
               SET evaluation_state = ?
               WHERE id = ?`,
              [targetEvalState, e.id]
            );
          }
        }
      });
    });
    process.stdout.write(`\r  ✓ Updated materialized_evaluations: ${Math.min(i + batchSize, evals.length)} / ${evals.length}`);
  }
  console.log(`\n✓ Materialized evaluations harmonized: ${evaluatedCount} EVALUATED, ${acqPendingCount} ACQUISITION_PENDING, ${acqFailedCount} ACQUISITION_FAILED, ${sparseEvalCount} SPARSE_SPEC.`);

  // 5. Populate recovery_queue for defective captures
  console.log("\n[4/4] Populating durable recovery_queue for corrupted / sparse captures...");
  const recoveryCandidates = await withRetry(async () => {
    return await db.many<{
      version_id: string;
      canonical_job_id: string;
      source: string;
      canonical_url: string;
      failure_class: string | null;
      raw_content: string | null;
    }>(`
      SELECT ov.id as version_id, ov.canonical_job_id, co.source, co.canonical_url,
             ov.failure_class, ov.raw_content
      FROM opportunity_versions ov
      JOIN canonical_opportunities co ON co.id = ov.canonical_job_id
      WHERE ov.acquisition_status IN ('RECOVERY_PENDING', 'CAPTURE_FAILED')
         OR ov.acquisition_quality IN ('MINIMAL', 'INVALID')
    `);
  });

  console.log(`✓ Found ${recoveryCandidates.length} recovery candidates across forensic cohort.`);

  let enqueuedCount = 0;
  for (let i = 0; i < recoveryCandidates.length; i += batchSize) {
    const chunk = recoveryCandidates.slice(i, i + batchSize);
    await withRetry(async () => {
      await db.transaction(async (tx) => {
        for (const c of chunk) {
          const recoveryId = `rec_${c.version_id.slice(0, 16)}`;
          const descLen = (c.raw_content || "").trim().length;
          const reason = `Historical sparse or corrupted capture (${descLen} chars)`;
          const failureClass = c.failure_class || (descLen === 0 ? "EMPTY_CONTENT" : "PARTIAL_CONTENT");

          await tx.execute(
            `INSERT INTO recovery_queue (
               id, tenant_id, canonical_job_id, opportunity_version_id, source, canonical_url,
               reason, failure_class, attempt_count, status, next_attempt_at, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(opportunity_version_id) WHERE status IN ('PENDING', 'PROCESSING') DO NOTHING`,
            [
              recoveryId,
              tenantId,
              c.canonical_job_id,
              c.version_id,
              c.source,
              c.canonical_url,
              reason,
              failureClass,
            ]
          );
          enqueuedCount++;
        }
      });
    });
    process.stdout.write(`\r  ✓ Enqueued recovery items: ${Math.min(i + batchSize, recoveryCandidates.length)} / ${recoveryCandidates.length}`);
  }

  const queueTotal = await withRetry(async () => {
    return await db.one<{ count: number }>("SELECT COUNT(*) as count FROM recovery_queue WHERE status = 'PENDING'");
  });

  console.log(`\n════════════════════════════════════════════════════════════════════════════`);
  console.log(`                  BACKFILL AUDIT & VERIFICATION REPORT                      `);
  console.log(`════════════════════════════════════════════════════════════════════════════`);
  console.log(`Total Versions Processed:       ${versions.length}`);
  console.log(`  - UNKNOWN (legacy unverified):${unverifiedCount} (${((unverifiedCount / versions.length) * 100).toFixed(1)}%)`);
  console.log(`  - MINIMAL (corrupted):        ${minimalCount} (${((minimalCount / versions.length) * 100).toFixed(1)}%)`);
  console.log(`  - INVALID (empty):            ${invalidCount} (${((invalidCount / versions.length) * 100).toFixed(1)}%)`);
  console.log(`----------------------------------------------------------------------------`);
  console.log(`Materialized Evaluations State:`);
  console.log(`  - EVALUATED:                  ${evaluatedCount}`);
  console.log(`  - SPARSE_SPEC:                ${sparseEvalCount} (Scoring nullified, no decisions)`);
  console.log(`----------------------------------------------------------------------------`);
  console.log(`Durable Recovery Queue Items:   ${queueTotal?.count ?? enqueuedCount} PENDING`);
  console.log(`════════════════════════════════════════════════════════════════════════════\n`);
}

runBackfill()
  .then(() => {
    console.log("✓ Backfill completed successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Backfill failed:", err);
    process.exit(1);
  });
