/**
 * scripts/benchmarks/verify_phase6_live_pagination.ts
 *
 * RADAR v2 — Phase 6 Keyset Pagination Live Parity & Completeness Certification.
 *
 * Traverses all 3,002 opportunities in Turso Cloud exclusively through 24-item keyset pages.
 * Validates:
 * 1. Full-corpus completeness: Exactly 3,002 / 3,002 items retrieved.
 * 2. Zero duplicates: unique(pagedHashes).size === 3,002.
 * 3. Zero omissions: All raw feed items retrieved.
 * 4. Deterministic sequence match: concat(pagedItems) matches full query sequence 100.00%.
 * 5. SHA-256 fingerprint validation.
 * 6. Page latency & payload size benchmark for 24-item pages.
 */

import crypto from "node:crypto";
import { getDatabaseAdapter } from "../../src/data/database/index";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import type { OpaqueCursor, FeedSummary } from "../../src/lib/intelligence/opportunity-queries";

async function runLivePaginationVerification() {
  const db = getDatabaseAdapter();
  const queries = new SqliteOpportunityQueries(db);

  const userId = "ms6i7e3y-4x0chy5fy";
  const tenantId = "tenant_default";

  console.log("Resolving serving scope for live pagination benchmark...");
  const { scope, activeContext } = await resolveServingScope(userId, tenantId, db);
  if (!activeContext) {
    throw new Error("Failed to resolve active context for test user.");
  }
  console.log(`Resolved Scope: ${scope.tenantId} / ${scope.personId}, Context: ${activeContext.contextFingerprint}`);

  console.log("\n1. Fetching Ground Truth via Full-Corpus Raw Projection...");
  const rawStart = performance.now();
  const rawItems = await queries.getFeedRaw(scope, activeContext);
  const rawDuration = performance.now() - rawStart;
  console.log(`Raw Feed: ${rawItems.length} items retrieved in ${rawDuration.toFixed(2)} ms`);

  // Sort raw items with canonical ordering to establish golden truth:
  // (tier ASC, quality_score DESC NULLS LAST, job_hash ASC)
  const canonicalSorted = [...rawItems].sort((a, b) => {
    if (a.populationTier !== b.populationTier) {
      return a.populationTier - b.populationTier;
    }
    const scoreA = a.qualityScore;
    const scoreB = b.qualityScore;
    if (scoreA !== null && scoreB !== null) {
      const diff = scoreB - scoreA;
      if (diff !== 0) return diff;
    } else if (scoreA !== null && scoreB === null) {
      return -1;
    } else if (scoreA === null && scoreB !== null) {
      return 1;
    }
    return a.jobHash.localeCompare(b.jobHash);
  });

  const canonicalHashes = canonicalSorted.map((i) => i.jobHash);
  const canonicalOrderHash = crypto.createHash("sha256").update(canonicalHashes.join(",")).digest("hex");
  console.log(`Canonical Ordering SHA-256: ${canonicalOrderHash}`);

  console.log("\n2. Traversing entire dataset via 24-item Keyset Pagination Pages...");
  const PAGE_SIZE = 24;
  let cursor: OpaqueCursor | undefined = undefined;
  const pagedItems: FeedSummary[] = [];
  const pageLatencies: number[] = [];
  const pagePayloadSizes: number[] = [];
  let pageCount = 0;

  const traverseStart = performance.now();
  while (true) {
    const pageStart = performance.now();
    const page = await queries.getFeed(scope, cursor, undefined, PAGE_SIZE);
    const pageTime = performance.now() - pageStart;

    pageLatencies.push(pageTime);
    const payloadBytes = Buffer.byteLength(JSON.stringify(page.items), "utf-8");
    pagePayloadSizes.push(payloadBytes);

    pagedItems.push(...page.items);
    pageCount++;

    if (!page.hasMore || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  const totalTraverseTime = performance.now() - traverseStart;

  const pagedHashes = pagedItems.map((i) => i.jobHash);
  const pagedOrderHash = crypto.createHash("sha256").update(pagedHashes.join(",")).digest("hex");
  const uniquePagedHashes = new Set(pagedHashes);

  // Check for duplicates
  const duplicates = pagedHashes.filter((h, idx) => pagedHashes.indexOf(h) !== idx);

  // Check for omissions
  const missingFromRaw = canonicalHashes.filter((h) => !uniquePagedHashes.has(h));

  // Sequence match
  let sequenceMismatches = 0;
  for (let i = 0; i < canonicalHashes.length; i++) {
    if (canonicalHashes[i] !== pagedHashes[i]) {
      sequenceMismatches++;
    }
  }

  // 24-Item First Page Benchmark
  const firstPagePayloadBytes = pagePayloadSizes[0] || 0;
  const avgPageLatency = pageLatencies.reduce((a, b) => a + b, 0) / pageLatencies.length;
  const avgPagePayload = pagePayloadSizes.reduce((a, b) => a + b, 0) / pagePayloadSizes.length;

  console.log("\n============================================================");
  console.log("PHASE 6 KEYSET PAGINATION CERTIFICATION RESULTS");
  console.log("============================================================");
  console.log(`Total Records Expected:      ${canonicalItemsCount(rawItems.length)}`);
  console.log(`Total Records Paged:         ${pagedItems.length}`);
  console.log(`Page Size:                   ${PAGE_SIZE}`);
  console.log(`Total Pages Retrieved:       ${pageCount}`);
  console.log(`Unique Hashes:               ${uniquePagedHashes.size}`);
  console.log(`Duplicate Hashes:            ${duplicates.length}`);
  console.log(`Missing Hashes:              ${missingFromRaw.length}`);
  console.log(`Sequence Parity Mismatches:  ${sequenceMismatches}`);
  console.log(`Canonical SHA-256:           ${canonicalOrderHash}`);
  console.log(`Paged Concatenation SHA-256: ${pagedOrderHash}`);
  console.log(`SHA-256 Hash Match:          ${canonicalOrderHash === pagedOrderHash ? "EXACT MATCH (100.00%)" : "MISMATCH"}`);
  console.log("------------------------------------------------------------");
  console.log(`Single Page (24 items) Payload: ${(firstPagePayloadBytes / 1024).toFixed(2)} KB`);
  console.log(`Average Page Payload:           ${(avgPagePayload / 1024).toFixed(2)} KB`);
  console.log(`Average Page Query Latency:     ${avgPageLatency.toFixed(2)} ms`);
  console.log(`Total Traversal Duration:       ${totalTraverseTime.toFixed(2)} ms for ${pageCount} pages`);
  console.log("============================================================\n");

  if (
    pagedItems.length !== rawItems.length ||
    duplicates.length > 0 ||
    missingFromRaw.length > 0 ||
    sequenceMismatches > 0 ||
    canonicalOrderHash !== pagedOrderHash
  ) {
    throw new Error("Phase 6 Certification Failed: Invariants violated.");
  }

  console.log("SUCCESS: Phase 6 Keyset Pagination is certified 100.00% complete and deterministic!");
}

function canonicalItemsCount(count: number): number {
  return count;
}

runLivePaginationVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});
